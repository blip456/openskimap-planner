// "Build region" endpoints with a fake build script (no real downloads): search, estimate, saved regions, a build
// with streamed output, a failed build, cancel, and the ZIP list/download.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { createServer } from '../server.mjs';
import { RegionBuilds } from '../region-builds.mjs';

let tmp;
let server;
let base;
let regions;

// Behaves like build-pwa-data.mjs: prints log lines, a "\r" progress bar, and "Done: <zip>" at the end.
const FAKE_BUILD = `
import fs from 'node:fs';
import path from 'node:path';
const arg = (k) => process.argv.find((a) => a.startsWith('--' + k + '='))?.slice(k.length + 3);
const region = JSON.parse(fs.readFileSync(arg('region'), 'utf8'));
const pwa = path.join(process.env.FAKE_BUILD_DIR, 'pwa');
console.log('[   0.0s] Region "' + region.name + '" args ' + process.argv.slice(2).join(' '));
process.stderr.write('extract 10%\\rextract 50%\\rextract 100%\\r');
if (region.name.includes('fail')) {
  console.error('\\nBuild failed: there are no runs or lifts in this box.');
  console.error('\\nbuild:pwa-data failed: the data build failed (exit code 1)');
  process.exit(1);
}
if (region.name.includes('slow')) {
  console.log('waiting');
  setInterval(() => {}, 1000);
} else {
  fs.mkdirSync(pwa, { recursive: true });
  const file = path.join(pwa, region.id + '-2026-11-21-z14.zip');
  fs.writeFileSync(file, 'PK fake zip');
  console.log('[   1.0s] Done: ' + file + '  (terrain z14, basemap z15, ski z16)');
}
`;

const area = (id, name, coords) => ({
  type: 'Feature',
  geometry: { type: 'Polygon', coordinates: [coords] },
  properties: { id, name, activities: ['downhill'], places: [{ localized: { en: { country: 'Austria' } } }] },
});

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'region-builds-'));
  const build = path.join(tmp, 'build');
  fs.mkdirSync(path.join(build, 'downloads'), { recursive: true });
  fs.writeFileSync(
    path.join(build, 'downloads/ski_areas.geojson'),
    JSON.stringify({ type: 'FeatureCollection', features: [area('abc', 'Skigebiet Ifen', [[10.1, 47.3], [10.15, 47.3], [10.15, 47.35], [10.1, 47.35], [10.1, 47.3]])] }),
  );
  fs.writeFileSync(path.join(tmp, 'resorts.json'), JSON.stringify({ settings: { terrainMaxZoom: 13, basemapMaxZoom: 14, skiMaxZoom: 16 }, resorts: [] }));
  const fake = path.join(tmp, 'fake-build.mjs');
  fs.writeFileSync(fake, FAKE_BUILD);
  process.env.FAKE_BUILD_DIR = build;
  regions = new RegionBuilds({ root: tmp, buildDir: build, regionsFile: path.join(tmp, 'regions.json'), command: [process.execPath, fake], log: {} });
  server = createServer({ appDir: path.join(tmp, 'app'), buildDir: build, routesDir: path.join(tmp, 'routes'), regions, log: { error() {} } });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server?.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const post = (p, body) => fetch(`${base}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

async function waitForEnd() {
  for (let i = 0; i < 200; i++) {
    const { build } = await (await fetch(`${base}/api/builds/current`)).json();
    if (build && build.state !== 'running') return build;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error('build did not end');
}

describe('region builds', () => {
  test('capabilities report region builds; defaults come from resorts.json', async () => {
    const caps = await (await fetch(`${base}/api/capabilities`)).json();
    assert.equal(caps.regionBuilds, true);
    const d = await (await fetch(`${base}/api/regions/defaults`)).json();
    assert.deepEqual(d.zoom, { terrain: 13, basemap: 14, ski: 16 });
    assert.equal(d.skiAreasAvailable, true);
  });

  test('ski area search', async () => {
    const { results } = await (await fetch(`${base}/api/skiareas?q=ifen`)).json();
    assert.equal(results.length, 1);
    assert.equal(results[0].id, 'abc');
    assert.deepEqual(results[0].bbox, [10.1, 47.3, 10.15, 47.35]);
    assert.deepEqual((await (await fetch(`${base}/api/skiareas?q=i`)).json()).results, [], 'one letter finds nothing');
  });

  test('estimate for a box and for ski areas', async () => {
    const a = await (await post('/api/regions/estimate', { bbox: [10.07804, 47.29991, 10.37744, 47.43978], zoom: { terrain: 14 } })).json();
    assert.equal(a.terrainTiles, 231);
    assert.equal(a.zoom.basemap, 14, 'missing zoom levels come from resorts.json');
    assert.equal(a.big, false);
    const b = await (await post('/api/regions/estimate', { skiAreas: [{ id: 'abc' }], marginKm: 0 })).json();
    assert.deepEqual(b.bbox, [10.1, 47.3, 10.15, 47.35]);
    const bad = await post('/api/regions/estimate', { bbox: [1, 1, 9, 9] });
    assert.equal(bad.status, 400);
    assert.match((await bad.json()).error, /too big/);
  });

  test('a build without saving: output is streamed, the ZIP is reported, regions.json is not written', async () => {
    const events = [];
    const ctrl = new AbortController();
    const es = fetch(`${base}/api/builds/current/events`, { signal: ctrl.signal }).then(async (res) => {
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += dec.decode(value);
          let i;
          while ((i = buf.indexOf('\n\n')) >= 0) {
            const block = buf.slice(0, i);
            buf = buf.slice(i + 2);
            const type = /^event: (.+)$/m.exec(block)?.[1];
            const data = /^data: (.+)$/m.exec(block)?.[1];
            if (type) events.push({ type, data: JSON.parse(data) });
          }
        }
      } catch {}
    });
    await new Promise((r) => setTimeout(r, 50));

    const res = await post('/api/builds', { region: { name: 'Lech', bbox: [10.1, 47.1, 10.3, 47.25], zoom: { terrain: 14 } }, save: false });
    assert.equal(res.status, 200);
    const started = await res.json();
    assert.equal(started.state, 'running');
    assert.equal(started.region.id, 'lech');

    const done = await waitForEnd();
    assert.equal(done.state, 'done', done.error);
    assert.equal(done.zip, 'lech-2026-11-21-z14.zip');
    assert.equal(fs.existsSync(path.join(tmp, 'regions.json')), false, 'not saved');
    const regionFile = path.join(tmp, 'build/regions/lech/region.json');
    assert.deepEqual(JSON.parse(fs.readFileSync(regionFile, 'utf8')).bbox, [10.1, 47.1, 10.3, 47.25]);

    const { lines } = await (await fetch(`${base}/api/builds/current`)).json();
    assert.match(lines[0], /--region=.*region\.json --out=.*regions\/lech --yes --terrain-zoom=14/);
    assert.ok(!lines.some((l) => l.includes('extract')), 'progress bars are not kept as lines');

    await new Promise((r) => setTimeout(r, 50));
    ctrl.abort();
    await es;
    const types = events.map((e) => e.type);
    assert.equal(types[0], 'hello');
    assert.ok(types.includes('line'));
    assert.ok(events.some((e) => e.type === 'progress' && e.data.text === 'extract 100%'));
    assert.equal(events.filter((e) => e.type === 'status').at(-1).data.state, 'done');
  });

  test('ZIP list and download', async () => {
    const { zips } = await (await fetch(`${base}/api/zips`)).json();
    assert.deepEqual(zips.map((z) => z.name), ['lech-2026-11-21-z14.zip']);
    const res = await fetch(`${base}/api/zips/lech-2026-11-21-z14.zip`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-disposition'), /attachment; filename="lech-2026-11-21-z14.zip"/);
    assert.equal(await res.text(), 'PK fake zip');
    assert.equal((await fetch(`${base}/api/zips/..%2Fresorts.json`)).status, 404);
    assert.equal((await fetch(`${base}/api/zips/nope.zip`)).status, 404);
  });

  test('a build with saving writes regions.json; delete removes it again', async () => {
    await post('/api/builds', { region: { id: 'ifen', name: 'Ifen', skiAreas: [{ id: 'abc', name: 'Skigebiet Ifen' }] }, save: true });
    assert.equal((await waitForEnd()).state, 'done');
    const saved = JSON.parse(fs.readFileSync(path.join(tmp, 'regions.json'), 'utf8')).regions;
    assert.deepEqual(saved, [{ id: 'ifen', name: 'Ifen', skiAreas: [{ id: 'abc', name: 'Skigebiet Ifen' }], marginKm: 2 }]);
    assert.equal((await (await fetch(`${base}/api/regions`)).json()).regions.length, 1);
    assert.equal((await fetch(`${base}/api/regions/ifen`, { method: 'DELETE' })).status, 200);
    assert.deepEqual((await (await fetch(`${base}/api/regions`)).json()).regions, []);
    assert.equal((await fetch(`${base}/api/regions/ifen`, { method: 'DELETE' })).status, 404);
  });

  test('a failed build reports the reason of the data build', async () => {
    await post('/api/builds', { region: { name: 'will fail', bbox: [10, 47, 10.1, 47.1] } });
    const b = await waitForEnd();
    assert.equal(b.state, 'failed');
    assert.equal(b.error, 'there are no runs or lifts in this box.');
  });

  test('invalid regions are refused before anything runs', async () => {
    const res = await post('/api/builds', { region: { name: 'x', bbox: [3, 3, 1, 1] } });
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /empty/);
  });

  test('only one build at a time; cancel stops it', async () => {
    const res = await post('/api/builds', { region: { name: 'slow one', bbox: [10, 47, 10.1, 47.1] } });
    assert.equal(res.status, 200);
    const second = await post('/api/builds', { region: { name: 'other', bbox: [10, 47, 10.1, 47.1] } });
    assert.equal(second.status, 409);
    await new Promise((r) => setTimeout(r, 200));
    assert.equal((await fetch(`${base}/api/builds/current`, { method: 'DELETE' })).status, 200);
    const b = await waitForEnd();
    assert.equal(b.state, 'cancelled');
    assert.equal((await fetch(`${base}/api/builds/current`, { method: 'DELETE' })).status, 409, 'nothing to cancel');
  });

  test('turned off: 403', async () => {
    const off = createServer({ appDir: tmp, buildDir: tmp, routesDir: path.join(tmp, 'r2'), log: { error() {} } });
    await new Promise((r) => off.listen(0, '127.0.0.1', r));
    const url = `http://127.0.0.1:${off.address().port}`;
    assert.equal((await fetch(`${url}/api/regions`)).status, 403);
    assert.equal((await (await fetch(`${url}/api/capabilities`)).json()).regionBuilds, false);
    off.close();
  });
});
