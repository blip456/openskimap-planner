// Streaming "stored" ZIP writer for Node (ZIP64 when needed). Files are read in chunks, never loaded whole.
// Two passes: `describeSources` reads every source once for size, CRC-32 and SHA-256 (the manifest needs the hashes);
// `writeZip` then writes the archive with correct headers, so no data descriptors are needed.
import fs from 'node:fs';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import {
  dosDateTime,
  zipCentralHeader,
  zipEndRecords,
  zipLocalHeader,
} from '../../packages/core/src/zip-records.ts';

const CHUNK = 4 * 1024 * 1024;

// source: { name, file } (path on disk) or { name, data } (Buffer)
async function* chunksOf(source) {
  if (source.data) {
    for (let i = 0; i < source.data.length; i += CHUNK) yield source.data.subarray(i, i + CHUNK);
    return;
  }
  const fh = await fs.promises.open(source.file, 'r');
  try {
    const buf = Buffer.allocUnsafe(CHUNK);
    for (;;) {
      const { bytesRead } = await fh.read(buf, 0, CHUNK, null);
      if (bytesRead === 0) break;
      yield buf.subarray(0, bytesRead);
    }
  } finally {
    await fh.close();
  }
}

/** Reads each source once: { name, size, crc, sha256, source }. */
export async function describeSources(sources, onFile = () => {}) {
  const out = [];
  for (const source of sources) {
    const sha = crypto.createHash('sha256');
    let crc = 0;
    let size = 0;
    for await (const chunk of chunksOf(source)) {
      sha.update(chunk);
      crc = zlib.crc32(chunk, crc);
      size += chunk.length;
    }
    const entry = { name: source.name, size, crc: crc >>> 0, sha256: sha.digest('hex'), source };
    out.push(entry);
    onFile(entry);
  }
  return out;
}

/**
 * Writes entries (from describeSources) to `outFile`. `date` sets the file times.
 * Returns { size, zip64 } where zip64 tells if any ZIP64 record was needed.
 */
export async function writeZip(outFile, entries, { date = new Date(), onProgress = () => {} } = {}) {
  const { dosTime, dosDate } = dosDateTime(date);
  const tmp = `${outFile}.tmp`;
  const fh = await fs.promises.open(tmp, 'w');
  let offset = 0;
  const central = [];
  const put = async (buf) => {
    let off = 0;
    while (off < buf.length) {
      const { bytesWritten } = await fh.write(buf, off, buf.length - off);
      off += bytesWritten;
    }
    offset += buf.length;
  };
  try {
    for (const e of entries) {
      const rec = { name: e.name, size: e.size, crc: e.crc, dosTime, dosDate };
      central.push({ ...rec, offset });
      await put(zipLocalHeader(rec));
      let written = 0;
      for await (const chunk of chunksOf(e.source)) {
        await put(chunk);
        written += chunk.length;
      }
      if (written !== e.size) throw new Error(`"${e.name}" changed while it was being packed (${written} bytes, expected ${e.size})`);
      onProgress(e);
    }
    const centralOffset = offset;
    for (const c of central) await put(zipCentralHeader(c));
    const centralSize = offset - centralOffset;
    const end = zipEndRecords(central.length, centralOffset, centralSize);
    await put(end);
    await fh.close();
    fs.renameSync(tmp, outFile);
    return { size: offset, zip64: end.length > 22 || entries.some((e) => e.size >= 0xffffffff) };
  } catch (err) {
    await fh.close().catch(() => {});
    fs.rmSync(tmp, { force: true });
    throw err;
  }
}
