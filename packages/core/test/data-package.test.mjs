import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  DataPackageError,
  MANIFEST_FORMAT_VERSION,
  checkManifestFiles,
  createSha256,
  crc32,
  dosDateTime,
  openDataPackage,
  parseManifest,
  readZipEntries,
  sha256OfEntry,
  verifyEntrySha256,
  zipCentralHeader,
  zipEndRecords,
  zipLocalHeader,
} from '../src/index.ts';

const enc = new TextEncoder();
const sha = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const { dosTime, dosDate } = dosDateTime(new Date(2026, 10, 20, 12, 0, 0));
const concat = (parts) => {
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let o = 0;
  for (const p of parts) (out.set(p, o), (o += p.length));
  return out;
};

// Builds a small stored ZIP from { name: Uint8Array | string } with the core record builders.
function makeStoredZip(files, { zip64 = false } = {}) {
  const parts = [];
  const central = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const data = typeof content === 'string' ? enc.encode(content) : content;
    const rec = { name, size: data.length, crc: crc32(data), dosTime, dosDate, zip64 };
    const lh = zipLocalHeader(rec);
    central.push(zipCentralHeader({ ...rec, offset }));
    parts.push(lh, data);
    offset += lh.length + data.length;
  }
  const cd = concat(central);
  return concat([...parts, cd, zipEndRecords(central.length, offset, cd.length, zip64)]);
}
const readerOf = (bytes) => async (offset, length) => bytes.subarray(offset, Math.min(bytes.length, offset + length));

function makeManifest(files, extra = {}) {
  return {
    formatVersion: MANIFEST_FORMAT_VERSION,
    buildDate: '2026-11-20',
    source: {},
    zoom: { terrain: 14, basemap: 15, ski: 16 },
    resorts: [{ id: 'r', name: 'R', bbox: [1, 2, 3, 4], center: [2, 3], planner: 'planner/r.json' }],
    files: Object.entries(files).map(([path, c]) => {
      const d = typeof c === 'string' ? enc.encode(c) : c;
      return { path, size: d.length, sha256: sha(d) };
    }),
    ...extra,
  };
}
const GOOD_FILES = {
  'planner/resorts.json': '[]',
  'planner/r.json': '{}',
  'tiles/ski.pmtiles': 'ski',
  'tiles/basemap.pmtiles': 'base',
  'fonts/Stack/0-255.pbf': 'font',
  'sprites/light.json': '{}',
  'sprites/light.png': 'png',
};

test('sha256: matches node:crypto for many sizes and chunkings', () => {
  for (const n of [0, 1, 55, 56, 57, 63, 64, 65, 119, 120, 128, 1000, 100_000]) {
    const data = crypto.randomBytes(n);
    const expected = sha(data);
    const h = createSha256();
    for (let i = 0; i < n; ) {
      const step = Math.min(n - i, 1 + ((i * 7) % 97));
      h.update(data.subarray(i, i + step));
      i += step;
    }
    assert.equal(h.digestHex(), expected, `size ${n}`);
  }
  const h = createSha256();
  h.digestHex();
  assert.throws(() => h.update(new Uint8Array(1)));
});

test('zip records: ZIP64 fields appear only when needed', () => {
  const small = zipLocalHeader({ name: 'a', size: 10, crc: 1, dosTime, dosDate });
  assert.equal(small.length, 31);
  const big = zipLocalHeader({ name: 'a', size: 5_000_000_000, crc: 1, dosTime, dosDate });
  assert.equal(big.length, 31 + 20);
  const dv = new DataView(big.buffer);
  assert.equal(dv.getUint32(18, true), 0xffffffff);
  assert.equal(dv.getBigUint64(31 + 4, true), 5_000_000_000n);

  const c1 = zipCentralHeader({ name: 'a', size: 10, crc: 1, dosTime, dosDate, offset: 100 });
  assert.equal(c1.length, 47);
  const c2 = zipCentralHeader({ name: 'a', size: 10, crc: 1, dosTime, dosDate, offset: 5_000_000_000 });
  assert.equal(c2.length, 47 + 12); // only the offset in the extra field
  const c3 = zipCentralHeader({ name: 'a', size: 5_000_000_000, crc: 1, dosTime, dosDate, offset: 5_000_000_000 });
  assert.equal(c3.length, 47 + 28);
  // boundary: 0xFFFFFFFF itself is the marker value, so it needs ZIP64 too
  assert.equal(zipLocalHeader({ name: 'a', size: 0xfffffffe, crc: 0, dosTime, dosDate }).length, 31);
  assert.equal(zipLocalHeader({ name: 'a', size: 0xffffffff, crc: 0, dosTime, dosDate }).length, 51);

  assert.equal(zipEndRecords(5, 100, 100).length, 22);
  assert.equal(zipEndRecords(65535, 100, 100).length, 22 + 76);
  assert.equal(zipEndRecords(5, 0xffffffff, 100).length, 22 + 76);
  assert.equal(zipEndRecords(5, 100, 0xffffffff).length, 22 + 76);
  assert.equal(zipEndRecords(5, 100, 100, true).length, 22 + 76);
});

test('reader: plain and forced-ZIP64 archives give the same entries', async () => {
  const files = { 'a.txt': 'hello', 'dir/b.bin': new Uint8Array([1, 2, 3, 4]), 'empty': '' };
  for (const zip64 of [false, true]) {
    const zip = makeStoredZip(files, { zip64 });
    const entries = await readZipEntries(readerOf(zip), zip.length);
    assert.deepEqual(entries.map((e) => e.name), ['a.txt', 'dir/b.bin', 'empty']);
    for (const e of entries) {
      const expected = typeof files[e.name] === 'string' ? enc.encode(files[e.name]) : files[e.name];
      assert.equal(e.size, expected.length);
      assert.deepEqual(zip.subarray(e.dataOffset, e.dataOffset + e.size), expected);
      assert.equal(e.crc32, crc32(expected));
    }
  }
});

test('reader: a virtual archive bigger than 4 GB (entry sizes and offsets above 32 bits)', async () => {
  const GB = 1024 ** 3;
  const bigSize = 4.5 * GB;
  const a = { name: 'big.pmtiles', size: bigSize, crc: 0, dosTime, dosDate };
  const b = { name: 'small.txt', size: 5, crc: crc32(enc.encode('hello')), dosTime, dosDate };
  const lhA = zipLocalHeader(a);
  const offB = lhA.length + bigSize;
  const lhB = zipLocalHeader(b);
  const cd = concat([zipCentralHeader({ ...a, offset: 0 }), zipCentralHeader({ ...b, offset: offB })]);
  const cdOffset = offB + lhB.length + 5;
  const tail = concat([cd, zipEndRecords(2, cdOffset, cd.length)]);
  const total = cdOffset + tail.length;
  // segments with real bytes; everything else reads as zeros
  const segments = [
    [0, lhA],
    [offB, concat([lhB, enc.encode('hello')])],
    [cdOffset, tail],
  ];
  const read = async (offset, length) => {
    const out = new Uint8Array(length);
    for (const [start, bytes] of segments) {
      const s = Math.max(start, offset);
      const e = Math.min(start + bytes.length, offset + length);
      if (s < e) out.set(bytes.subarray(s - start, e - start), s - offset);
    }
    return out;
  };
  const entries = await readZipEntries(read, total);
  assert.equal(entries[0].size, bigSize);
  assert.equal(entries[0].dataOffset, lhA.length);
  assert.equal(entries[1].dataOffset, offB + lhB.length);
  assert.ok(entries[1].dataOffset > 4 * GB);
  assert.deepEqual(await read(entries[1].dataOffset, 5), enc.encode('hello'));
});

test('reader: clear errors for damaged, cut-off and compressed files', async () => {
  const zip = makeStoredZip({ 'a.txt': 'hello' });
  await assert.rejects(readZipEntries(readerOf(new Uint8Array(10)), 10), /not a ZIP/);
  await assert.rejects(readZipEntries(readerOf(enc.encode('x'.repeat(100))), 100), /not a ZIP/);
  const cut = zip.subarray(0, zip.length - 30);
  await assert.rejects(readZipEntries(readerOf(cut), cut.length), DataPackageError);
  const deflated = zip.slice();
  const cdPos = zip.length - 22 - zipCentralHeader({ name: 'a.txt', size: 5, crc: 0, dosTime, dosDate, offset: 0 }).length;
  new DataView(deflated.buffer).setUint16(cdPos + 10, 8, true);
  await assert.rejects(readZipEntries(readerOf(deflated), deflated.length), /compressed/);
  // data cut off: central directory intact but the file is declared bigger than the archive
  const truncated = makeStoredZip({ 'a.txt': 'hello' }).slice();
  new DataView(truncated.buffer).setUint32(cdPos + 20, 5000, true);
  new DataView(truncated.buffer).setUint32(cdPos + 24, 5000, true);
  await assert.rejects(readZipEntries(readerOf(truncated), truncated.length), /cut off/);
});

test('manifest: validation', () => {
  const ok = makeManifest(GOOD_FILES);
  assert.equal(parseManifest(ok).formatVersion, 1);
  assert.throws(() => parseManifest(null), DataPackageError);
  assert.throws(() => parseManifest({ ...ok, formatVersion: 2 }), /Update the app/);
  assert.throws(() => parseManifest({ ...ok, formatVersion: undefined }), /format version/);
  assert.throws(() => parseManifest({ ...ok, buildDate: 'yesterday' }), /build date/);
  assert.throws(() => parseManifest({ ...ok, zoom: undefined }), /zoom/);
  assert.throws(() => parseManifest({ ...ok, resorts: [] }), /no resorts/);
  assert.throws(() => parseManifest({ ...ok, files: [{ path: 'a', size: 1, sha256: 'xyz' }] }), /file entry/);
  assert.throws(() => parseManifest({ ...ok, files: [{ path: '../evil', size: 1, sha256: 'a'.repeat(64) }] }), /unsafe/);
  assert.throws(() => parseManifest({ ...ok, files: [{ path: '/abs', size: 1, sha256: 'a'.repeat(64) }] }), /unsafe/);
  const dup = { path: 'a', size: 1, sha256: 'a'.repeat(64) };
  assert.throws(() => parseManifest({ ...ok, files: [dup, dup] }), /duplicate/);
});

test('openDataPackage: reads the manifest and checks the files', async () => {
  const manifest = makeManifest(GOOD_FILES);
  const zip = makeStoredZip({ 'manifest.json': JSON.stringify(manifest), ...GOOD_FILES });
  const pkg = await openDataPackage(readerOf(zip), zip.length);
  assert.equal(pkg.files.length, 7);
  assert.equal(pkg.manifest.zoom.terrain, 14);
  const font = pkg.files.find((f) => f.path === 'fonts/Stack/0-255.pbf');
  assert.equal(await sha256OfEntry(readerOf(zip), font, createSha256, { chunkSize: 3 }), font.sha256);
  await verifyEntrySha256(readerOf(zip), font, createSha256);
  await assert.rejects(verifyEntrySha256(readerOf(zip), { ...font, sha256: 'a'.repeat(64) }, createSha256), /damaged/);

  // missing manifest, missing file, wrong size, missing required file
  const noManifest = makeStoredZip(GOOD_FILES);
  await assert.rejects(openDataPackage(readerOf(noManifest), noManifest.length), /manifest.json is missing/);
  const missing = makeStoredZip({ 'manifest.json': JSON.stringify(manifest), ...{ ...GOOD_FILES, 'tiles/ski.pmtiles': undefined } && Object.fromEntries(Object.entries(GOOD_FILES).filter(([k]) => k !== 'tiles/ski.pmtiles')) });
  await assert.rejects(openDataPackage(readerOf(missing), missing.length), /"tiles\/ski.pmtiles" is missing/);
  const wrongSize = makeStoredZip({ 'manifest.json': JSON.stringify(manifest), ...GOOD_FILES, 'tiles/ski.pmtiles': 'skiX' });
  await assert.rejects(openDataPackage(readerOf(wrongSize), wrongSize.length), /wrong size/);
  const noBase = makeManifest(Object.fromEntries(Object.entries(GOOD_FILES).filter(([k]) => k !== 'tiles/basemap.pmtiles')));
  const entries = await readZipEntries(readerOf(zip), zip.length);
  assert.throws(() => checkManifestFiles(parseManifest(noBase), entries), /basemap/);
});

// The real archive from `npm run build:pwa-data` (not in git).
const PWA_DIR = path.resolve(import.meta.dirname, '../../../build/pwa');
const realZip = fs.existsSync(PWA_DIR) ? fs.readdirSync(PWA_DIR).filter((n) => n.endsWith('.zip')).sort().at(-1) : null;
test('real data ZIP: opens, every file matches its SHA-256', { skip: realZip ? false : 'no build/pwa/*.zip; run npm run build:pwa-data' }, async () => {
  const file = path.join(PWA_DIR, realZip);
  const fh = await fs.promises.open(file, 'r');
  try {
    const { size } = await fh.stat();
    const read = async (offset, length) => {
      const buf = new Uint8Array(length);
      const { bytesRead } = await fh.read(buf, 0, length, offset);
      return buf.subarray(0, bytesRead);
    };
    const pkg = await openDataPackage(read, size);
    assert.ok(pkg.files.some((f) => f.path === 'tiles/terrain.pmtiles'));
    assert.ok(pkg.manifest.zoom.terrain >= 1);
    assert.match(realZip, new RegExp(`-z${pkg.manifest.zoom.terrain}\\.zip$`));
    // planner file holds the precomputed index and ski areas
    const planner = pkg.files.find((f) => f.path === pkg.manifest.resorts[0].planner);
    const data = JSON.parse(new TextDecoder().decode(await read(planner.dataOffset, planner.size)));
    assert.ok(Array.isArray(data.searchIndex) && data.searchIndex.length > 0);
    assert.ok(data.skiAreas?.areas);
    const nodeHasher = () => {
      const h = crypto.createHash('sha256');
      return { update: (c) => void h.update(c), digestHex: () => h.digest('hex') };
    };
    for (const f of pkg.files) await verifyEntrySha256(read, f, nodeHasher);
  } finally {
    await fh.close();
  }
});
