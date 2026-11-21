// Static file serving for the desktop server: safe path joining and HTTP Range requests (PMTiles reads byte
// ranges). No framework; small and tested (server/test/files.test.mjs).
import fs from 'node:fs';
import path from 'node:path';

export const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
  '.pbf': 'application/x-protobuf',
  '.pmtiles': 'application/octet-stream',
  '.woff2': 'font/woff2',
};

/**
 * Joins a URL path (still percent-encoded) to a root folder. Returns null for anything that could leave the
 * folder: "..", encoded "%2e%2e", backslashes, NUL bytes, absolute paths, bad encoding.
 */
export function safeJoin(root, urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  if (decoded.includes('\0') || decoded.includes('\\')) return null;
  const parts = decoded.split('/').filter((p) => p !== '');
  if (parts.some((p) => p === '..' || p === '.')) return null;
  const base = path.resolve(root);
  const full = path.resolve(base, ...parts);
  if (full !== base && !full.startsWith(base + path.sep)) return null;
  return full;
}

/**
 * Parses a Range header for a file of `size` bytes.
 * Returns null (no range, or one we ignore: send the whole file), 'invalid' (unsatisfiable: 416), or
 * { start, end } (inclusive). Unknown units, bad syntax and multiple ranges are ignored, as RFC 9110 allows.
 */
export function parseRange(header, size) {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(header).trim());
  if (!m) return null;
  const [, a, b] = m;
  if (a === '' && b === '') return null;
  let start;
  let end;
  if (a === '') {
    // suffix range: the last N bytes
    const n = Number(b);
    if (n === 0) return 'invalid';
    start = Math.max(0, size - n);
    end = size - 1;
  } else {
    start = Number(a);
    if (b !== '' && Number(b) < start) return null;
    end = b === '' ? size - 1 : Math.min(Number(b), size - 1);
  }
  if (start >= size) return 'invalid';
  return { start, end };
}

const etagOf = (stat) => `"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`;

/**
 * Sends a file with Range, HEAD, ETag/If-None-Match support. Returns false when the file does not exist
 * (the caller sends 404).
 */
export function sendFile(req, res, file, { cacheControl = 'no-cache', type, headers: extra = {} } = {}) {
  let stat;
  try {
    stat = fs.statSync(file);
  } catch {
    return false;
  }
  if (!stat.isFile()) return false;
  const etag = etagOf(stat);
  const headers = {
    'Content-Type': type ?? MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
    'Accept-Ranges': 'bytes',
    'Cache-Control': cacheControl,
    ETag: etag,
    'Last-Modified': stat.mtime.toUTCString(),
    ...extra,
  };

  // a Range is only honoured when If-Range (if sent) still matches the file
  const ifRange = req.headers['if-range'];
  const range = ifRange && ifRange !== etag ? null : parseRange(req.headers.range, stat.size);
  if (range === 'invalid') {
    res.writeHead(416, { ...headers, 'Content-Range': `bytes */${stat.size}` });
    res.end();
    return true;
  }
  if (!range && req.headers['if-none-match'] === etag) {
    res.writeHead(304, headers);
    res.end();
    return true;
  }
  const start = range ? range.start : 0;
  const end = range ? range.end : stat.size - 1;
  const length = stat.size === 0 ? 0 : end - start + 1;
  res.writeHead(range ? 206 : 200, {
    ...headers,
    'Content-Length': String(length),
    ...(range ? { 'Content-Range': `bytes ${start}-${end}/${stat.size}` } : {}),
  });
  if (req.method === 'HEAD' || length === 0) {
    res.end();
    return true;
  }
  const stream = fs.createReadStream(file, { start, end });
  stream.on('error', () => res.destroy());
  stream.pipe(res);
  return true;
}
