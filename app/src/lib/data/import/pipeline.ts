// Import of a data ZIP into the storage (docs/pwa-plan.md §5). Runs in the import worker; pure enough to be
// unit-tested in Node with MemoryDir. Each "stored" ZIP entry is copied in chunks straight from the picked file
// (Blob.slice), and its SHA-256 is computed on the same chunks, so the file is read once and never held in memory.
import { DataPackageError, openDataPackage, type Manifest } from '@core/data-package.ts';
import { createSha256, type Sha256Factory } from '@core/sha256.ts';
import { COMPLETE_MARKER, newPackageName, removeIncomplete, removePackagesExcept } from '../package-store.ts';
import { writeSmallFile, writerForPath, type FileWriter, type StorageDir } from '../storage.ts';

export type ImportPhase = 'checking' | 'copying' | 'finishing';

export interface ImportProgress {
  phase: ImportPhase;
  /** file being copied */
  file?: string;
  /** bytes copied so far, over all files */
  bytesDone: number;
  bytesTotal: number;
}

export interface ImportResult {
  packageName: string;
  manifest: Manifest;
  bytes: number;
  ms: number;
}

export interface ImportOptions {
  createHasher?: Sha256Factory;
  onProgress?: (p: ImportProgress) => void;
  signal?: AbortSignal;
  chunkSize?: number;
  /** free space check; in the browser: navigator.storage.estimate */
  estimate?: () => Promise<{ quota?: number; usage?: number }>;
  now?: () => number;
}

export class ImportCancelled extends Error {
  override name = 'ImportCancelled';
  constructor() {
    super('Import cancelled');
  }
}

/** Errors the user can act on keep their message; the UI shows them as they are. */
export class ImportError extends Error {
  override name = 'ImportError';
}

const MB = 1024 * 1024;

export async function importPackage(blob: Blob, root: StorageDir, options: ImportOptions = {}): Promise<ImportResult> {
  const t0 = (options.now ?? Date.now)();
  const chunkSize = options.chunkSize ?? 4 * MB;
  const createHasher = options.createHasher ?? createSha256;
  const checkCancel = () => {
    if (options.signal?.aborted) throw new ImportCancelled();
  };
  const read = async (offset: number, length: number) => new Uint8Array(await blob.slice(offset, offset + length).arrayBuffer());

  options.onProgress?.({ phase: 'checking', bytesDone: 0, bytesTotal: 0 });
  let pkg;
  try {
    pkg = await openDataPackage(read, blob.size);
  } catch (err) {
    if (err instanceof DataPackageError) {
      // "not a ZIP" / "manifest.json is missing" → the copy from the design spec; other messages are specific
      const notOurs = /not a ZIP|manifest\.json is missing|not an OpenSkiMap/i.test(err.message);
      throw new ImportError(notOurs ? 'This is not a data file for this app.' : err.message);
    }
    throw err;
  }
  const bytesTotal = pkg.files.reduce((s, f) => s + f.size, 0);

  if (options.estimate) {
    const { quota, usage } = await options.estimate();
    if (quota != null && usage != null) {
      const free = quota - usage;
      // the old data stays until the new data is complete, so the new package needs its full size
      if (bytesTotal > free) {
        throw new ImportError(`Not enough space. Free ${Math.ceil((bytesTotal - free) / MB)} MB and try again.`);
      }
    }
  }
  checkCancel();

  await removeIncomplete(root);
  const packageName = await newPackageName(root, (options.now ?? Date.now)());
  const dir = (await root.dir(packageName, true))!;
  let writer: FileWriter | null = null;
  let bytesDone = 0;
  let lastReport = 0;
  const report = (file: string, force = false) => {
    const now = Date.now();
    if (!force && now - lastReport < 100) return;
    lastReport = now;
    options.onProgress?.({ phase: 'copying', file, bytesDone, bytesTotal });
  };

  try {
    for (const f of pkg.files) {
      checkCancel();
      writer = await writerForPath(dir, f.path);
      const hasher = createHasher();
      report(f.path, true);
      for (let done = 0; done < f.size; ) {
        checkCancel();
        const n = Math.min(chunkSize, f.size - done);
        const bytes = await read(f.dataOffset + done, n);
        if (bytes.length !== n) throw new ImportError(`The file is damaged (${f.path}). Build it again and try again.`);
        hasher.update(bytes);
        await writer.write(bytes);
        done += n;
        bytesDone += n;
        report(f.path);
      }
      await writer.close();
      writer = null;
      if (hasher.digestHex() !== f.sha256) {
        throw new ImportError(`The file is damaged (${f.path}). Build it again and try again.`);
      }
    }
    options.onProgress?.({ phase: 'finishing', bytesDone, bytesTotal });
    await writeSmallFile(dir, 'manifest.json', JSON.stringify(pkg.manifest));
    // the switch: from here on the new package is the one in use
    await writeSmallFile(dir, COMPLETE_MARKER, '');
  } catch (err) {
    if (writer) await writer.abort().catch(() => {});
    await root.remove(packageName).catch(() => {});
    if (err instanceof ImportError || err instanceof ImportCancelled) throw err;
    if (err instanceof DOMException && err.name === 'QuotaExceededError') {
      throw new ImportError('Not enough space. Free some space and try again.');
    }
    throw err;
  }
  await removePackagesExcept(root, packageName);
  return { packageName, manifest: pkg.manifest, bytes: bytesTotal, ms: (options.now ?? Date.now)() - t0 };
}
