// Reader for the data ZIP that `npm run build:pwa-data` writes (see docs/pwa-plan.md §5).
// Pure functions: the caller gives a random-access reader (File.slice in the browser, a file handle in Node),
// so nothing big is loaded into memory. Only "stored" (uncompressed) entries are supported.
import {
  ZIP_MAX16,
  ZIP_MAX32,
  ZIP_SIG_CENTRAL,
  ZIP_SIG_END,
  ZIP_SIG_END64,
  ZIP_SIG_LOCAL,
  ZIP_SIG_LOCATOR64,
} from './zip-records.ts';
import type { Sha256Factory } from './sha256.ts';

/** Reads `length` bytes starting at `offset`. Must return exactly `length` bytes (or fewer only at the end). */
export type ByteReader = (offset: number, length: number) => Promise<Uint8Array>;

export class DataPackageError extends Error {}

export interface ZipEntryInfo {
  name: string;
  size: number;
  crc32: number;
  /** absolute offset of the first data byte in the archive */
  dataOffset: number;
}

export const MANIFEST_FORMAT_VERSION = 1;

export interface ManifestFile {
  path: string;
  size: number;
  sha256: string;
}

export interface ManifestResort {
  id: string;
  name: string;
  bbox: [number, number, number, number];
  center: [number, number];
  /** path of the planner data file (runs, lifts, places, search index, ski areas) */
  planner: string;
}

export interface Manifest {
  formatVersion: number;
  /** YYYY-MM-DD */
  buildDate: string;
  builtAt?: string;
  source: {
    openSkiData?: { date?: string; [k: string]: unknown } | null;
    protomaps?: { build?: string } | null;
    [k: string]: unknown;
  };
  zoom: { terrain: number | null; basemap: number | null; ski: number | null };
  /** label language of the basemap (added after format 1 was introduced; default 'en') */
  language?: string;
  resorts: ManifestResort[];
  files: ManifestFile[];
}

const u16 = (v: DataView, o: number) => v.getUint16(o, true);
const u32 = (v: DataView, o: number) => v.getUint32(o, true);
function u64(v: DataView, o: number): number {
  const n = v.getBigUint64(o, true);
  if (n > BigInt(Number.MAX_SAFE_INTEGER)) throw new DataPackageError('ZIP value too large');
  return Number(n);
}

async function readExact(read: ByteReader, offset: number, length: number, what: string): Promise<Uint8Array> {
  const bytes = await read(offset, length);
  if (bytes.length !== length) throw new DataPackageError(`Could not read ${what} (file too short or damaged)`);
  return bytes;
}

const view = (b: Uint8Array) => new DataView(b.buffer, b.byteOffset, b.byteLength);

interface CentralLocation {
  count: number;
  offset: number;
  size: number;
}

async function findCentralDirectory(read: ByteReader, totalSize: number): Promise<CentralLocation> {
  if (totalSize < 22) throw new DataPackageError('This is not a ZIP file (too small)');
  const tailLen = Math.min(totalSize, 22 + ZIP_MAX16);
  const tailStart = totalSize - tailLen;
  const tail = await readExact(read, tailStart, tailLen, 'the end of the ZIP');
  const tv = view(tail);
  let pos = -1;
  for (let i = tailLen - 22; i >= 0; i--) {
    if (u32(tv, i) === ZIP_SIG_END && i + 22 + u16(tv, i + 20) === tailLen) {
      pos = i;
      break;
    }
  }
  if (pos < 0) throw new DataPackageError('This is not a ZIP file (end record not found)');
  let count = u16(tv, pos + 10);
  let size = u32(tv, pos + 12);
  let offset = u32(tv, pos + 16);

  if (count === ZIP_MAX16 || size === ZIP_MAX32 || offset === ZIP_MAX32) {
    // ZIP64: the locator sits right before the end record
    const locAbs = tailStart + pos - 20;
    if (locAbs < 0) throw new DataPackageError('ZIP64 locator not found');
    const loc = await readExact(read, locAbs, 20, 'the ZIP64 locator');
    if (u32(view(loc), 0) !== ZIP_SIG_LOCATOR64) throw new DataPackageError('ZIP64 locator not found');
    const end64Offset = u64(view(loc), 8);
    const rec = await readExact(read, end64Offset, 56, 'the ZIP64 end record');
    const rv = view(rec);
    if (u32(rv, 0) !== ZIP_SIG_END64) throw new DataPackageError('ZIP64 end record not found');
    count = u64(rv, 32);
    size = u64(rv, 40);
    offset = u64(rv, 48);
  }
  if (offset + size > totalSize) throw new DataPackageError('ZIP central directory is outside the file (damaged or cut off)');
  return { count, offset, size };
}

/** Parses the central directory (also ZIP64) and finds the data offset of every entry. STORE only. */
export async function readZipEntries(read: ByteReader, totalSize: number): Promise<ZipEntryInfo[]> {
  const loc = await findCentralDirectory(read, totalSize);
  const cd = await readExact(read, loc.offset, loc.size, 'the ZIP directory');
  const cv = view(cd);
  const dec = new TextDecoder();
  const raw: { name: string; size: number; crc32: number; localOffset: number }[] = [];
  let p = 0;
  for (let i = 0; i < loc.count; i++) {
    if (p + 46 > cd.length || u32(cv, p) !== ZIP_SIG_CENTRAL) throw new DataPackageError('ZIP directory is damaged');
    const method = u16(cv, p + 10);
    const crc32 = u32(cv, p + 16);
    let size = u32(cv, p + 24);
    let uncompressed = u32(cv, p + 20);
    const nameLen = u16(cv, p + 28);
    const extraLen = u16(cv, p + 30);
    const commentLen = u16(cv, p + 32);
    let localOffset = u32(cv, p + 42);
    const name = dec.decode(cd.subarray(p + 46, p + 46 + nameLen));
    if (method !== 0) {
      throw new DataPackageError(`"${name}" is compressed (method ${method}). Only uncompressed (stored) ZIP files are supported.`);
    }
    let e = p + 46 + nameLen;
    const extraEnd = e + extraLen;
    while (e + 4 <= extraEnd) {
      const id = u16(cv, e);
      const len = u16(cv, e + 2);
      if (id === 1) {
        let q = e + 4;
        if (uncompressed === ZIP_MAX32) { uncompressed = u64(cv, q); q += 8; }
        if (size === ZIP_MAX32) { size = u64(cv, q); q += 8; }
        if (localOffset === ZIP_MAX32) { localOffset = u64(cv, q); q += 8; }
      }
      e += 4 + len;
    }
    if (uncompressed !== size) throw new DataPackageError(`"${name}" is compressed. Only uncompressed (stored) ZIP files are supported.`);
    raw.push({ name, size, crc32, localOffset });
    p += 46 + nameLen + extraLen + commentLen;
  }

  const entries: ZipEntryInfo[] = [];
  for (const r of raw) {
    const lh = await readExact(read, r.localOffset, 30, `the header of "${r.name}"`);
    const lv = view(lh);
    if (u32(lv, 0) !== ZIP_SIG_LOCAL) throw new DataPackageError(`ZIP entry "${r.name}" is damaged`);
    entries.push({
      name: r.name,
      size: r.size,
      crc32: r.crc32,
      dataOffset: r.localOffset + 30 + u16(lv, 26) + u16(lv, 28),
    });
  }
  for (const en of entries) {
    if (en.dataOffset + en.size > totalSize) throw new DataPackageError(`"${en.name}" is cut off (the file is incomplete)`);
  }
  return entries;
}

// ---------------------------------------------------------------------------
// manifest

const SAFE_PATH = /^(?!\/)(?!.*\.\.)(?!.*\\)[^\0]+$/;
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isBbox = (v: unknown): boolean => Array.isArray(v) && v.length === 4 && v.every((n) => typeof n === 'number' && Number.isFinite(n));

/** Files the app cannot work without. Terrain and contours are optional (a smaller package can leave them out). */
export const REQUIRED_FILES = ['planner/resorts.json', 'tiles/ski.pmtiles', 'tiles/basemap.pmtiles', 'sprites/light.json', 'sprites/light.png'];

/** Validates the manifest structure and returns it typed. Throws DataPackageError with a clear message. */
export function parseManifest(raw: unknown): Manifest {
  if (!isObj(raw)) throw new DataPackageError('manifest.json is not valid');
  const version = raw.formatVersion;
  if (typeof version !== 'number' || !Number.isInteger(version)) throw new DataPackageError('manifest.json has no format version');
  if (version > MANIFEST_FORMAT_VERSION) {
    throw new DataPackageError(`This data file uses format ${version}, but this app only supports format ${MANIFEST_FORMAT_VERSION}. Update the app.`);
  }
  if (version < 1) throw new DataPackageError(`Unknown data format ${version}`);
  if (typeof raw.buildDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(raw.buildDate)) throw new DataPackageError('manifest.json: build date is missing');
  const zoom = raw.zoom;
  if (!isObj(zoom)) throw new DataPackageError('manifest.json: zoom levels are missing');
  for (const k of ['terrain', 'basemap', 'ski']) {
    if (zoom[k] !== null && typeof zoom[k] !== 'number') throw new DataPackageError(`manifest.json: zoom.${k} is not a number`);
  }
  if (!Array.isArray(raw.resorts) || raw.resorts.length === 0) throw new DataPackageError('manifest.json: no resorts');
  for (const r of raw.resorts) {
    if (!isObj(r) || typeof r.id !== 'string' || typeof r.name !== 'string' || typeof r.planner !== 'string' || !isBbox(r.bbox)) {
      throw new DataPackageError('manifest.json: a resort entry is not valid');
    }
  }
  if (!Array.isArray(raw.files) || raw.files.length === 0) throw new DataPackageError('manifest.json: file list is missing');
  const seen = new Set<string>();
  for (const f of raw.files) {
    if (!isObj(f) || typeof f.path !== 'string' || typeof f.size !== 'number' || f.size < 0 || !Number.isInteger(f.size) || typeof f.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(f.sha256)) {
      throw new DataPackageError('manifest.json: a file entry is not valid');
    }
    if (!SAFE_PATH.test(f.path)) throw new DataPackageError(`manifest.json: unsafe file path "${f.path}"`);
    if (seen.has(f.path)) throw new DataPackageError(`manifest.json: duplicate file "${f.path}"`);
    seen.add(f.path);
  }
  const source = isObj(raw.source) ? raw.source : {};
  return { ...(raw as object), source, zoom: zoom as Manifest['zoom'] } as Manifest;
}

/** Checks that the ZIP holds every file of the manifest with the right size, and the files the app needs. */
export function checkManifestFiles(manifest: Manifest, entries: readonly ZipEntryInfo[]): void {
  const byName = new Map(entries.map((e) => [e.name, e]));
  const listed = new Map(manifest.files.map((f) => [f.path, f]));
  for (const f of manifest.files) {
    const e = byName.get(f.path);
    if (!e) throw new DataPackageError(`The data file is incomplete: "${f.path}" is missing`);
    if (e.size !== f.size) throw new DataPackageError(`"${f.path}" has the wrong size (${e.size}, expected ${f.size}). The file may be damaged.`);
  }
  for (const need of REQUIRED_FILES) {
    if (!listed.has(need)) throw new DataPackageError(`The data file is incomplete: "${need}" is missing`);
  }
  for (const r of manifest.resorts) {
    if (!listed.has(r.planner)) throw new DataPackageError(`The data file is incomplete: "${r.planner}" is missing`);
  }
  if (![...listed.keys()].some((p) => p.startsWith('fonts/'))) throw new DataPackageError('The data file is incomplete: no fonts');
}

export interface DataPackage {
  manifest: Manifest;
  /** manifest files with their position in the archive (manifest.json itself is not included) */
  files: (ManifestFile & ZipEntryInfo)[];
}

/** Opens a data ZIP: reads the directory and manifest.json, checks both. Does not read the big files. */
export async function openDataPackage(read: ByteReader, totalSize: number): Promise<DataPackage> {
  const entries = await readZipEntries(read, totalSize);
  const mEntry = entries.find((e) => e.name === 'manifest.json');
  if (!mEntry) throw new DataPackageError('This is not an OpenSkiMap data file (manifest.json is missing)');
  if (mEntry.size > 16 * 1024 * 1024) throw new DataPackageError('manifest.json is too big');
  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder().decode(await readExact(read, mEntry.dataOffset, mEntry.size, 'manifest.json')));
  } catch (err) {
    if (err instanceof DataPackageError) throw err;
    throw new DataPackageError('manifest.json is not valid JSON');
  }
  const manifest = parseManifest(json);
  checkManifestFiles(manifest, entries);
  const byName = new Map(entries.map((e) => [e.name, e]));
  return { manifest, files: manifest.files.map((f) => ({ ...f, ...byName.get(f.path)! })) };
}

/** Reads one entry in chunks and returns its SHA-256 (hex). `onChunk` gets the number of bytes done, for progress bars. */
export async function sha256OfEntry(
  read: ByteReader,
  entry: Pick<ZipEntryInfo, 'dataOffset' | 'size'>,
  createHasher: Sha256Factory,
  options: { chunkSize?: number; onProgress?: (bytesDone: number) => void } = {},
): Promise<string> {
  const chunk = options.chunkSize ?? 4 * 1024 * 1024;
  const hasher = createHasher();
  for (let done = 0; done < entry.size; ) {
    const n = Math.min(chunk, entry.size - done);
    hasher.update(await readExact(read, entry.dataOffset + done, n, 'file data'));
    done += n;
    options.onProgress?.(done);
  }
  return hasher.digestHex();
}

/** Verifies the SHA-256 of an entry against the manifest; throws with the file name when it differs. */
export async function verifyEntrySha256(
  read: ByteReader,
  file: ManifestFile & Pick<ZipEntryInfo, 'dataOffset'>,
  createHasher: Sha256Factory,
  options: { chunkSize?: number; onProgress?: (bytesDone: number) => void } = {},
): Promise<void> {
  const hex = await sha256OfEntry(read, file, createHasher, options);
  if (hex !== file.sha256) throw new DataPackageError(`"${file.path}" is damaged (checksum does not match). Copy the data file again.`);
}
