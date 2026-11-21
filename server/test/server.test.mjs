// Desktop server: Range requests, path traversal protection, capabilities, saved routes.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { parseRange, safeJoin } from '../files.mjs';
import { createServer, dataFile } from '../server.mjs';
import { defaultMapId } from '../../scripts/lib/map-folder.mjs';

describe('parseRange', () => {
  test('normal, open and suffix ranges', () => {
    assert.deepEqual(parseRange('bytes=0-9', 100), { start: 0, end: 9 });
    assert.deepEqual(parseRange('bytes=90-', 100), { start: 90, end: 99 });
    assert.deepEqual(parseRange('bytes=-10', 100), { start: 90, end: 99 });
    assert.deepEqual(parseRange('bytes=-500', 100), { start: 0, end: 99 });
    assert.deepEqual(parseRange('bytes=95-200', 100), { start: 95, end: 99 }, 'end is clamped');
  });
  test('unsatisfiable ranges give 416', () => {
    assert.equal(parseRange('bytes=100-', 100), 'invalid');
    assert.equal(parseRange('bytes=200-300', 100), 'invalid');
    assert.equal(parseRange('bytes=-0', 100), 'invalid');
    assert.equal(parseRange('bytes=0-0', 0), 'invalid');
  });
  test('ignored: no header, other units, bad syntax, several ranges', () => {
    for (const h of [undefined, '', 'items=0-5', 'bytes=abc', 'bytes=5-2', 'bytes=0-1,5-6', 'bytes=-']) assert.equal(parseRange(h, 100), null, String(h));
  });
});

describe('safeJoin', () => {
  const root = path.resolve('/srv/data');
  test('normal paths stay inside', () => {
    assert.equal(safeJoin(root, '/a/b.json'), path.join(root, 'a/b.json'));
    assert.equal(safeJoin(root, 'Noto%20Sans%20Regular/0-255.pbf'), path.join(root, 'Noto Sans Regular/0-255.pbf'));
  });
  test('traversal is refused', () => {
    for (const p of ['../etc/passwd', '/../x', 'a/../../x', '%2e%2e/x', '%2E%2E%2Fx', '..%2fx', 'a%5c..%5cx', 'a\\..\\x', 'x%00.json', '%E0%A4%A', './x']) {
      assert.equal(safeJoin(root, p), null, p);
    }
  });
});

/** The desktop server's folder of the resorts.json map: build/regions/<resort id> (read from resorts.json). */
const MAP = defaultMapId(path.resolve(import.meta.dirname, '../..'));
/** The desktop server's paths: the map in build/regions/<resort id>, fonts and sprites in build/. */
const paths = (build) => ({ buildDir: build, mapDir: path.join(build, 'regions', MAP) });

describe('dataFile', () => {
  const build = path.resolve('/b');
  test('maps the four kinds of data files', () => {
    assert.equal(dataFile(paths(build), '/data/planner/oberstdorf.json'), path.join(build, `regions/${MAP}/planner/oberstdorf.json`));
    assert.equal(dataFile(paths(build), '/data/tiles/basemap.pmtiles'), path.join(build, `regions/${MAP}/tileserver/data/basemap.pmtiles`));
    assert.equal(dataFile(paths(build), '/data/fonts/Noto%20Sans%20Medium/0-255.pbf'), path.join(build, 'tileserver/fonts/Noto Sans Medium/0-255.pbf'));
    assert.equal(dataFile(paths(build), '/data/sprites/light@2x.png'), path.join(build, 'tileserver/sprites/light@2x.png'));
  });
  test('refuses everything else', () => {
    for (const p of [
      '/data/planner/../build-info.json',
      '/data/planner/%2e%2e%2fbuild-info.json',
      '/data/tiles/../../package.json',
      '/data/tiles/x.mbtiles',
      '/data/fonts/../../../etc/passwd',
      '/data/fonts/..%2f..%2fx/0-255.pbf',
      '/data/fonts/a/b/0-255.pbf',
      '/data/work/x.json',
      '/data/sprites/light.svg',
    ]) {
      assert.equal(dataFile(paths(build), p), null, p);
    }
  });
});

// --- integration: a real server on a free port with a temporary build/ folder ---------------------

let tmp;
let server;
let base;
const tileBytes = Buffer.from(Array.from({ length: 1000 }, (_, i) => i % 256));

function raw(pathname, headers = {}) {
  // fetch() normalizes "../" in URLs; a raw socket sends the path as is (like an attacker would)
  return new Promise((resolve, reject) => {
    const { port } = new URL(base);
    const sock = net.connect(Number(port), '127.0.0.1', () => {
      sock.write(`GET ${pathname} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n${Object.entries(headers).map(([k, v]) => `${k}: ${v}\r\n`).join('')}\r\n`);
    });
    let data = '';
    sock.on('data', (d) => (data += d));
    sock.on('end', () => resolve(Number(data.slice(9, 12))));
    sock.on('error', reject);
  });
}

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-server-'));
  const build = path.join(tmp, 'build');
  fs.mkdirSync(path.join(build, `regions/${MAP}/planner`), { recursive: true });
  fs.mkdirSync(path.join(build, `regions/${MAP}/tileserver/data`), { recursive: true });
  fs.mkdirSync(path.join(build, 'tileserver/fonts/Noto Sans Regular'), { recursive: true });
  fs.writeFileSync(path.join(build, `regions/${MAP}/planner/resorts.json`), JSON.stringify([{ id: 'r', name: 'R', bbox: [1, 2, 3, 4], center: [2, 3] }]));
  fs.writeFileSync(path.join(build, `regions/${MAP}/planner/r.json`), '{"name":"R","runs":[],"lifts":[]}');
  fs.writeFileSync(path.join(build, `regions/${MAP}/tileserver/data/ski.pmtiles`), tileBytes);
  fs.writeFileSync(path.join(build, `regions/${MAP}/tileserver/data/basemap.pmtiles`), tileBytes);
  fs.writeFileSync(path.join(build, 'tileserver/fonts/Noto Sans Regular/0-255.pbf'), 'glyphs');
  fs.writeFileSync(path.join(build, 'secret.txt'), 'secret');
  fs.mkdirSync(path.join(tmp, 'app/assets'), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'app/index.html'), '<!doctype html><title>app</title>');
  fs.writeFileSync(path.join(tmp, 'app/assets/a.js'), 'console.log(1)');
  server = createServer({
    appDir: path.join(tmp, 'app'),
    buildDir: build,
    routesDir: path.join(tmp, 'routes'),
    tileServerUrl: 'http://tiles.test',
    resolveLink: async (u) => ({ lat: 1, lon: 2, url: u }),
    log: { error() {} },
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server?.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('desktop server', () => {
  test('whole PMTiles file with Accept-Ranges and ETag', async () => {
    const res = await fetch(`${base}/data/tiles/ski.pmtiles`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('accept-ranges'), 'bytes');
    assert.equal(res.headers.get('content-length'), '1000');
    assert.ok(res.headers.get('etag'));
    assert.deepEqual(Buffer.from(await res.arrayBuffer()), tileBytes);
  });

  test('byte range → 206 with the right bytes and Content-Range', async () => {
    const res = await fetch(`${base}/data/tiles/ski.pmtiles`, { headers: { Range: 'bytes=100-199' } });
    assert.equal(res.status, 206);
    assert.equal(res.headers.get('content-range'), 'bytes 100-199/1000');
    assert.equal(res.headers.get('content-length'), '100');
    assert.deepEqual(Buffer.from(await res.arrayBuffer()), tileBytes.subarray(100, 200));
  });

  test('suffix range and open range', async () => {
    let res = await fetch(`${base}/data/tiles/ski.pmtiles`, { headers: { Range: 'bytes=-10' } });
    assert.equal(res.status, 206);
    assert.deepEqual(Buffer.from(await res.arrayBuffer()), tileBytes.subarray(990));
    res = await fetch(`${base}/data/tiles/ski.pmtiles`, { headers: { Range: 'bytes=995-' } });
    assert.equal(res.headers.get('content-range'), 'bytes 995-999/1000');
    assert.equal((await res.arrayBuffer()).byteLength, 5);
  });

  test('unsatisfiable range → 416', async () => {
    const res = await fetch(`${base}/data/tiles/ski.pmtiles`, { headers: { Range: 'bytes=5000-6000' } });
    assert.equal(res.status, 416);
    assert.equal(res.headers.get('content-range'), 'bytes */1000');
  });

  test('If-Range with an old ETag sends the whole file', async () => {
    const res = await fetch(`${base}/data/tiles/ski.pmtiles`, { headers: { Range: 'bytes=0-9', 'If-Range': '"old"' } });
    assert.equal(res.status, 200);
    assert.equal((await res.arrayBuffer()).byteLength, 1000);
  });

  test('HEAD and If-None-Match', async () => {
    const head = await fetch(`${base}/data/tiles/ski.pmtiles`, { method: 'HEAD' });
    assert.equal(head.status, 200);
    assert.equal(head.headers.get('content-length'), '1000');
    const again = await fetch(`${base}/data/tiles/ski.pmtiles`, { headers: { 'If-None-Match': head.headers.get('etag') } });
    assert.equal(again.status, 304);
  });

  test('planner JSON and fonts with spaces in the path', async () => {
    assert.equal(await (await fetch(`${base}/data/planner/r.json`)).text(), '{"name":"R","runs":[],"lifts":[]}');
    assert.equal(await (await fetch(`${base}/data/fonts/Noto%20Sans%20Regular/0-255.pbf`)).text(), 'glyphs');
    assert.equal((await fetch(`${base}/data/fonts/Noto%20Sans%20Regular/256-511.pbf`)).status, 404);
  });

  test('path traversal is refused (raw requests)', async () => {
    for (const p of [
      '/data/planner/../secret.txt',
      '/data/planner/%2e%2e/secret.txt',
      '/data/planner/..%2fsecret.txt',
      '/data/tiles/..%2f..%2fsecret.txt',
      '/data/fonts/..%2f..%2f..%2fsecret.txt/0-255.pbf',
      '/../build/secret.txt',
      '/%2e%2e/build/secret.txt',
      '/assets/..%2f..%2fbuild%2fsecret.txt',
    ]) {
      const status = await raw(p);
      assert.ok(status === 404 || status === 400, `${p} → ${status}`);
    }
  });

  test('capabilities', async () => {
    const c = await (await fetch(`${base}/api/capabilities`)).json();
    assert.equal(c.tileServerUrl, 'http://tiles.test');
    assert.equal(c.projectFolderRoutes, true);
    assert.equal(c.googleShortLinks, true);
    assert.deepEqual(c.data.tiles, ['ski', 'basemap']);
    assert.equal(c.data.resorts[0].id, 'r');
  });

  test('app files, immutable assets, index.html fallback', async () => {
    const index = await fetch(`${base}/`);
    assert.match(await index.text(), /<title>app<\/title>/);
    const asset = await fetch(`${base}/assets/a.js`);
    assert.match(asset.headers.get('cache-control'), /immutable/);
    assert.match(await (await fetch(`${base}/some/app/url`)).text(), /<title>app<\/title>/);
    assert.equal((await fetch(`${base}/missing.js`)).status, 404);
    assert.equal((await fetch(`${base}/api/nope`)).status, 404);
  });

  test('resolve uses the resort bbox', async () => {
    const r = await (await fetch(`${base}/api/resolve?url=${encodeURIComponent('https://maps.app.goo.gl/x')}&resort=r`)).json();
    assert.equal(r.lat, 1);
  });

  test('saved routes: save, list, GPX, delete', async () => {
    const body = {
      name: 'Test run',
      folder: 'Tests',
      resort: 'r',
      resortName: 'R',
      points: [[10.1, 47.1], [10.2, 47.2]],
      options: {},
      summary: { distance: 1000 },
      gpx: '<?xml version="1.0"?><gpx></gpx>',
    };
    const saved = await (await fetch(`${base}/api/routes`, { method: 'POST', body: JSON.stringify(body) })).json();
    assert.match(saved.id, /^[a-f0-9]{12}$/);
    assert.equal(saved.gpx, undefined);
    const list = await (await fetch(`${base}/api/routes`)).json();
    assert.equal(list.folders[0].name, 'Tests');
    assert.equal(await (await fetch(`${base}/api/routes/${saved.id}.gpx`)).text(), body.gpx);
    assert.equal((await fetch(`${base}/api/routes/${saved.id}`, { method: 'DELETE' })).status, 200);
    assert.equal((await fetch(`${base}/api/routes`, { method: 'POST', body: JSON.stringify({ ...body, points: [[1, 2]] }) })).status, 400);
    assert.equal((await fetch(`${base}/api/routes`, { method: 'POST', body: '{bad' })).status, 400);
  });
});
