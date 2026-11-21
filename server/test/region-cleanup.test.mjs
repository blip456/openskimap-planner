// "Clean up" of the Build region page: what is listed, what is deleted, and what is never touched.
// Uses its own temporary project folder, so the other region tests are not affected.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { createServer } from '../server.mjs';
import { RegionBuilds } from '../region-builds.mjs';

let tmp;
let build;
let regionsFile;
let regions;
let server;
let base;

const write = (rel, content = 'x'.repeat(100)) => {
  const file = path.join(build, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
};

/** A fresh build folder with a desktop map, a main ZIP, two region ZIPs, two region folders and two caches. */
function seed() {
  fs.rmSync(build, { recursive: true, force: true });
  write('planner/resorts.json', '[]');
  write('tileserver/data/ski.pmtiles');
  write('pwa-map-data/openskimap-data-2026-11-21-z14.zip');
  write('pwa-map-data/lech-zurs-2026-11-21-z14.zip');
  write('pwa-map-data/winterberg-2026-11-21-z12.zip');
  write('regions/lech-zurs/planner/a.json');
  write('regions/lech-zurs/tileserver/data/ski.pmtiles');
  write('regions/winterberg/planner/b.json');
  write('work/basemap/x.bin');
  write('downloads/ski_areas.geojson');
  fs.writeFileSync(regionsFile, JSON.stringify({ regions: [{ id: 'lech-zurs', name: 'Lech', bbox: [10, 47, 10.1, 47.1] }] }));
}

const exists = (rel) => fs.existsSync(path.join(build, rel));
const byKey = (items) => Object.fromEntries(items.map((i) => [i.key, i]));

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'region-cleanup-'));
  build = path.join(tmp, 'build');
  regionsFile = path.join(tmp, 'regions.json');
  regions = new RegionBuilds({ root: tmp, buildDir: build, regionsFile, command: [process.execPath, '-e', ''], log: {} });
  server = createServer({ appDir: path.join(tmp, 'app'), buildDir: build, routesDir: path.join(tmp, 'routes'), regions, log: { error() {} } });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server?.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('clean up region files', () => {
  test('lists region folders, region ZIPs and the optional caches, with counts and sizes', () => {
    seed();
    const items = byKey(regions.cleanupItems());
    assert.equal(items['region-folders'].count, 2);
    assert.equal(items['region-zips'].count, 2, 'the main openskimap-data ZIP is not a region ZIP');
    assert.equal(items.work.count, 1);
    assert.equal(items.downloads.count, 1);
    assert.equal(items['region-folders'].optional, false);
    assert.equal(items.downloads.optional, true);
    assert.ok(items['region-folders'].bytes >= 300, 'sizes add up files in sub folders');
  });

  test('deleting region ZIPs removes only region ZIPs', () => {
    seed();
    const { removed } = regions.cleanup(['region-zips']);
    assert.deepEqual(removed.map((r) => [r.key, r.count]), [['region-zips', 2]]);
    assert.equal(exists('pwa-map-data/lech-zurs-2026-11-21-z14.zip'), false);
    assert.equal(exists('pwa-map-data/winterberg-2026-11-21-z12.zip'), false);
    assert.equal(exists('pwa-map-data/openskimap-data-2026-11-21-z14.zip'), true, 'main ZIP stays');
    assert.equal(exists('regions/lech-zurs/planner/a.json'), true, 'region folders stay');
  });

  test('deleting region folders keeps saved regions and the desktop map', () => {
    seed();
    regions.cleanup(['region-folders']);
    assert.deepEqual(fs.readdirSync(path.join(build, 'regions')), [], 'every region folder is gone');
    assert.equal(exists('planner/resorts.json'), true);
    assert.equal(exists('tileserver/data/ski.pmtiles'), true);
    assert.equal(fs.existsSync(regionsFile), true, 'regions.json is not touched');
    assert.equal(JSON.parse(fs.readFileSync(regionsFile, 'utf8')).regions.length, 1);
  });

  test('the optional caches are only deleted when asked', () => {
    seed();
    regions.cleanup(['region-folders', 'region-zips']);
    assert.equal(exists('work/basemap/x.bin'), true);
    assert.equal(exists('downloads/ski_areas.geojson'), true);
    regions.cleanup(['work', 'downloads']);
    assert.equal(exists('work'), false);
    assert.equal(exists('downloads'), false);
  });

  test('only fixed keys are accepted: no paths, no unknown names, nothing empty', () => {
    seed();
    for (const bad of [[], undefined, ['../planner'], ['planner'], ['region-zips', 'nope'], [1]]) {
      assert.throws(() => regions.cleanup(bad), (err) => err.status === 400, JSON.stringify(bad));
    }
    assert.equal(exists('planner/resorts.json'), true);
    assert.equal(exists('pwa-map-data/lech-zurs-2026-11-21-z14.zip'), true);
  });

  test('refused while a build runs', () => {
    seed();
    regions.job = { state: 'running' };
    try {
      assert.throws(() => regions.cleanup(['region-zips']), (err) => err.status === 409);
      assert.equal(exists('pwa-map-data/lech-zurs-2026-11-21-z14.zip'), true);
    } finally {
      regions.job = null;
    }
  });

  test('HTTP: GET lists the items, POST deletes the chosen ones', async () => {
    seed();
    const list = await (await fetch(`${base}/api/cleanup`)).json();
    assert.equal(byKey(list.items)['region-zips'].count, 2);

    const res = await fetch(`${base}/api/cleanup`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ keys: ['region-zips'] }) });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).removed[0].key, 'region-zips');
    assert.equal(exists('pwa-map-data/lech-zurs-2026-11-21-z14.zip'), false);

    const bad = await fetch(`${base}/api/cleanup`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ keys: ['../x'] }) });
    assert.equal(bad.status, 400);
  });
});

describe('delete one region (its ZIP and build folder)', () => {
  test('deletes the ZIP and the region folder, nothing else', () => {
    seed();
    const r = regions.deleteRegionZip('lech-zurs-2026-11-21-z14.zip');
    assert.equal(r.folderRemoved, true);
    assert.ok(r.bytes > 0);
    assert.equal(exists('pwa-map-data/lech-zurs-2026-11-21-z14.zip'), false);
    assert.equal(exists('regions/lech-zurs'), false);
    assert.equal(exists('pwa-map-data/winterberg-2026-11-21-z12.zip'), true, 'other region stays');
    assert.equal(exists('regions/winterberg/planner/b.json'), true, 'other region folder stays');
    assert.equal(exists('pwa-map-data/openskimap-data-2026-11-21-z14.zip'), true, 'main ZIP stays');
    assert.equal(exists('planner/resorts.json'), true);
    assert.equal(fs.existsSync(regionsFile), true, 'saved region stays in regions.json');
  });

  test('the region folder stays while another ZIP of the same region is left', () => {
    seed();
    write('pwa-map-data/lech-zurs-2026-11-20-z12.zip');
    const first = regions.deleteRegionZip('lech-zurs-2026-11-21-z14.zip');
    assert.equal(first.folderRemoved, false);
    assert.equal(exists('regions/lech-zurs/planner/a.json'), true);
    const second = regions.deleteRegionZip('lech-zurs-2026-11-20-z12.zip');
    assert.equal(second.folderRemoved, true);
    assert.equal(exists('regions/lech-zurs'), false);
  });

  test('only region ZIPs of this kind: the main ZIP, paths and unknown names are refused', () => {
    seed();
    for (const bad of ['openskimap-data-2026-11-21-z14.zip', '../planner/resorts.json', 'nope-2026-11-21-z14.zip', undefined]) {
      assert.throws(() => regions.deleteRegionZip(bad), (err) => [400, 404].includes(err.status), String(bad));
    }
    assert.equal(exists('pwa-map-data/openskimap-data-2026-11-21-z14.zip'), true);
    assert.equal(exists('planner/resorts.json'), true);
  });

  test('refused while a build runs', () => {
    seed();
    regions.job = { state: 'running' };
    try {
      assert.throws(() => regions.deleteRegionZip('lech-zurs-2026-11-21-z14.zip'), (err) => err.status === 409);
    } finally {
      regions.job = null;
    }
    assert.equal(exists('pwa-map-data/lech-zurs-2026-11-21-z14.zip'), true);
  });

  test('HTTP: DELETE /api/zips/<name>', async () => {
    seed();
    const res = await fetch(`${base}/api/zips/${encodeURIComponent('winterberg-2026-11-21-z12.zip')}`, { method: 'DELETE' });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).folderRemoved, true);
    assert.equal(exists('regions/winterberg'), false);
    const main = await fetch(`${base}/api/zips/${encodeURIComponent('openskimap-data-2026-11-21-z14.zip')}`, { method: 'DELETE' });
    assert.equal(main.status, 400);
  });
});
