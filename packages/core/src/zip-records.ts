// ZIP record builders for "stored" archives (no compression) with ZIP64 support.
// Pure functions on Uint8Array, no DOM and no Node APIs. A streaming writer (scripts/lib/zip-writer.mjs) uses
// them to write archives of any size; the reader is in data-package.ts.

export const ZIP_SIG_LOCAL = 0x04034b50;
export const ZIP_SIG_CENTRAL = 0x02014b50;
export const ZIP_SIG_END = 0x06054b50;
export const ZIP_SIG_END64 = 0x06064b50;
export const ZIP_SIG_LOCATOR64 = 0x07064b50;
export const ZIP_MAX32 = 0xffffffff;
export const ZIP_MAX16 = 0xffff;

export interface ZipRecordInput {
  /** UTF-8 file name inside the archive */
  name: string;
  /** size in bytes (stored: compressed size = size) */
  size: number;
  crc: number;
  dosTime: number;
  dosDate: number;
  /** write the ZIP64 fields even if the values fit in 32 bits (for tests) */
  zip64?: boolean;
}

export interface ZipCentralInput extends ZipRecordInput {
  /** offset of the local header from the start of the archive */
  offset: number;
}

const enc = new TextEncoder();

export function dosDateTime(date: Date): { dosTime: number; dosDate: number } {
  const year = Math.max(1980, date.getFullYear());
  return {
    dosTime: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    dosDate: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

const needs64 = (n: number): boolean => n >= ZIP_MAX32;
const entry64 = (e: ZipRecordInput): boolean => e.zip64 === true || needs64(e.size);

/** Length of the local header (header + name + extra) for an entry. The file data follows directly. */
export function zipLocalHeaderLength(name: string, size: number, zip64 = false): number {
  return 30 + enc.encode(name).length + (zip64 || needs64(size) ? 20 : 0);
}

export function zipLocalHeader(e: ZipRecordInput): Uint8Array {
  const name = enc.encode(e.name);
  const big = entry64(e);
  const extraLen = big ? 20 : 0;
  const out = new Uint8Array(30 + name.length + extraLen);
  const v = new DataView(out.buffer);
  v.setUint32(0, ZIP_SIG_LOCAL, true);
  v.setUint16(4, big ? 45 : 20, true);
  v.setUint16(6, 0x0800, true); // UTF-8 names
  v.setUint16(8, 0, true); // stored
  v.setUint16(10, e.dosTime, true);
  v.setUint16(12, e.dosDate, true);
  v.setUint32(14, e.crc >>> 0, true);
  v.setUint32(18, big ? ZIP_MAX32 : e.size, true);
  v.setUint32(22, big ? ZIP_MAX32 : e.size, true);
  v.setUint16(26, name.length, true);
  v.setUint16(28, extraLen, true);
  out.set(name, 30);
  if (big) {
    const p = 30 + name.length;
    v.setUint16(p, 1, true);
    v.setUint16(p + 2, 16, true);
    v.setBigUint64(p + 4, BigInt(e.size), true);
    v.setBigUint64(p + 12, BigInt(e.size), true);
  }
  return out;
}

export function zipCentralHeader(e: ZipCentralInput): Uint8Array {
  const name = enc.encode(e.name);
  const bigSize = entry64(e);
  const bigOffset = e.zip64 === true || needs64(e.offset);
  const extraValues: number[] = [];
  if (bigSize) extraValues.push(e.size, e.size); // uncompressed, compressed
  if (bigOffset) extraValues.push(e.offset);
  const extraLen = extraValues.length ? 4 + extraValues.length * 8 : 0;
  const out = new Uint8Array(46 + name.length + extraLen);
  const v = new DataView(out.buffer);
  v.setUint32(0, ZIP_SIG_CENTRAL, true);
  v.setUint16(4, (3 << 8) | (extraLen ? 45 : 20), true); // made by: Unix
  v.setUint16(6, extraLen ? 45 : 20, true);
  v.setUint16(8, 0x0800, true);
  v.setUint16(10, 0, true);
  v.setUint16(12, e.dosTime, true);
  v.setUint16(14, e.dosDate, true);
  v.setUint32(16, e.crc >>> 0, true);
  v.setUint32(20, bigSize ? ZIP_MAX32 : e.size, true);
  v.setUint32(24, bigSize ? ZIP_MAX32 : e.size, true);
  v.setUint16(28, name.length, true);
  v.setUint16(30, extraLen, true);
  v.setUint32(38, (0o100644 << 16) >>> 0, true); // file mode rw-r--r--
  v.setUint32(42, bigOffset ? ZIP_MAX32 : e.offset, true);
  out.set(name, 46);
  if (extraLen) {
    let p = 46 + name.length;
    v.setUint16(p, 1, true);
    v.setUint16(p + 2, extraValues.length * 8, true);
    p += 4;
    for (const n of extraValues) {
      v.setBigUint64(p, BigInt(n), true);
      p += 8;
    }
  }
  return out;
}

/** End of central directory; adds the ZIP64 end record and locator when a value does not fit. */
export function zipEndRecords(count: number, centralOffset: number, centralSize: number, forceZip64 = false): Uint8Array {
  const zip64 = forceZip64 || count >= ZIP_MAX16 || needs64(centralOffset) || needs64(centralSize);
  const out = new Uint8Array(22 + (zip64 ? 56 + 20 : 0));
  const v = new DataView(out.buffer);
  let p = 0;
  if (zip64) {
    v.setUint32(0, ZIP_SIG_END64, true);
    v.setBigUint64(4, 44n, true); // size of the rest of this record
    v.setUint16(12, 45, true);
    v.setUint16(14, 45, true);
    v.setUint32(16, 0, true);
    v.setUint32(20, 0, true);
    v.setBigUint64(24, BigInt(count), true);
    v.setBigUint64(32, BigInt(count), true);
    v.setBigUint64(40, BigInt(centralSize), true);
    v.setBigUint64(48, BigInt(centralOffset), true);
    v.setUint32(56, ZIP_SIG_LOCATOR64, true);
    v.setUint32(60, 0, true);
    v.setBigUint64(64, BigInt(centralOffset + centralSize), true); // the end64 record follows the central directory
    v.setUint32(72, 1, true);
    p = 76;
  }
  v.setUint32(p, ZIP_SIG_END, true);
  v.setUint16(p + 8, zip64 ? ZIP_MAX16 : count, true);
  v.setUint16(p + 10, zip64 ? ZIP_MAX16 : count, true);
  v.setUint32(p + 12, zip64 ? ZIP_MAX32 : centralSize, true);
  v.setUint32(p + 16, zip64 ? ZIP_MAX32 : centralOffset, true);
  return out;
}
