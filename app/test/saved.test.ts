// Saved routes: IndexedDB store (in memory with fake-indexeddb), compatibility with the old planner's records, the
// desktop server store against the real desktop server, and the Saved sheet logic.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { IDBFactory } from 'fake-indexeddb';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { BrowserRouteStore, DB_NAME, DB_STORE, DEFAULT_FOLDER, ServerRouteStore, type SavedRoute } from '../src/lib/saved/stores.ts';
import { SavedState } from '../src/lib/stores/saved.svelte.ts';
import { RouteState } from '../src/lib/stores/route.svelte.ts';
import type { RouteSummary } from '@core/routing/index.ts';

const GPX = '<?xml version="1.0" encoding="UTF-8"?>\n<gpx></gpx>\n';
const summary: RouteSummary = { distance: 8400, runDistance: 5100, liftCount: 2, duration: 2520, descent: 1210, ascent: 290 };

function newRoute(name: string, folder = 'Oberstdorf'): Omit<SavedRoute, 'id' | 'createdAt' | 'updatedAt'> {
  return {
    name,
    folder,
    resort: 'oberstdorf',
    resortName: 'Oberstdorf',
    points: [[10.27, 47.4], [10.29, 47.38]],
    options: { difficulties: ['novice'] },
    summary: { ...summary, legs: 1 },
    gpx: GPX,
  };
}

/** Writes a record exactly as the old planner's route-stores.js did (same database, store and fields). */
async function writeLegacy(idb: IDBFactory, record: object): Promise<void> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const req = idb.open('ski-planner', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('routes', { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  await new Promise<void>((resolve, reject) => {
    const t = db.transaction('routes', 'readwrite');
    t.objectStore('routes').put(record);
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
  db.close();
}

async function zipNames(blob: Blob): Promise<string[]> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const names: string[] = [];
  const view = new DataView(bytes.buffer);
  for (let i = 0; i + 30 < bytes.length; ) {
    if (view.getUint32(i, true) !== 0x04034b50) break;
    const size = view.getUint32(i + 18, true);
    const nameLen = view.getUint16(i + 26, true);
    const extra = view.getUint16(i + 28, true);
    names.push(new TextDecoder().decode(bytes.subarray(i + 30, i + 30 + nameLen)));
    i += 30 + nameLen + extra + size;
  }
  return names;
}

describe('browser store (IndexedDB)', () => {
  test('same database and store names as the old planner', () => {
    expect([DB_NAME, DB_STORE, DEFAULT_FOLDER]).toEqual(['ski-planner', 'routes', 'My routes']);
  });

  test('routes saved by the old planner show up and can be opened', async () => {
    const idb = new IDBFactory();
    await writeLegacy(idb, {
      id: 'a1b2c3d4e5f6',
      name: 'Family day',
      folder: 'Oberstdorf',
      resort: 'oberstdorf',
      resortName: 'Oberstdorf',
      points: [[10.27, 47.4], [10.28, 47.39], [10.29, 47.38]],
      options: { difficulties: ['novice', 'easy'], speeds: { easy: 14 } },
      summary: { ...summary, legs: 2 },
      gpx: GPX,
      createdAt: '2026-11-02T10:00:00.000Z',
      updatedAt: '2026-11-02T10:00:00.000Z',
    });
    await writeLegacy(idb, { id: 'broken', name: 'no points' }); // unusable records are skipped
    const store = new BrowserRouteStore(idb);
    const folders = await store.list();
    expect(folders).toHaveLength(1);
    expect(folders[0].routes[0]).toMatchObject({ id: 'a1b2c3d4e5f6', name: 'Family day', points: 3 });
    expect(folders[0].routes[0]).not.toHaveProperty('gpx');
    expect((await store.get('a1b2c3d4e5f6')).points).toHaveLength(3);
    await expect(store.get('broken')).rejects.toThrow('Route not found');
  });

  test('save, update (keeps createdAt), list by folder, GPX, ZIP, delete', async () => {
    const store = new BrowserRouteStore(new IDBFactory());
    const a = await store.save(newRoute('Gipfel to Seealpe'));
    expect(a.id).toMatch(/^[a-f0-9]{12}$/);
    const b = await store.save(newRoute('Gipfel to Seealpe')); // same name in the same folder
    await store.save({ ...newRoute('  Bad/\\name\u0001 ', '  '), folder: '' });
    const first = await store.get(a.id);
    await new Promise((r) => setTimeout(r, 5));
    const updated = await store.save({ ...newRoute('Renamed'), id: a.id });
    expect(updated.id).toBe(a.id);
    expect(updated.createdAt).toBe(first.createdAt);
    expect(updated.updatedAt > first.updatedAt).toBe(true);
    const folders = await store.list();
    expect(folders.map((f) => f.name)).toEqual(['My routes', 'Oberstdorf']);
    expect(folders[0].routes[0].name).toBe('Bad name');
    expect(folders[1].routes.map((r) => r.name)).toEqual(['Renamed', 'Gipfel to Seealpe']); // newest first
    const gpx = await store.gpxBlob(b.id);
    expect(gpx.filename).toBe('gipfel-to-seealpe.gpx');
    expect(await gpx.blob.text()).toBe(GPX);
    await store.save(newRoute('Renamed'));
    const zip = await store.zipBlob('Oberstdorf');
    expect(zip.filename).toBe('oberstdorf.zip');
    expect(await zipNames(zip.blob)).toEqual(expect.arrayContaining(['renamed.gpx', 'renamed-2.gpx', 'gipfel-to-seealpe.gpx']));
    await expect(store.zipBlob('Nope')).rejects.toThrow('has no routes');
    await store.delete(b.id);
    expect((await store.list())[1].routes).toHaveLength(2);
  });

  test('backup export and import (same format as the old planner)', async () => {
    const from = new BrowserRouteStore(new IDBFactory());
    await from.save(newRoute('One'));
    await from.save(newRoute('Two', 'Other'));
    const backup = await from.exportBackup();
    expect(backup.count).toBe(2);
    const data = JSON.parse(await backup.blob.text());
    expect(data).toMatchObject({ app: 'ski-route-planner', version: 1 });
    const to = new BrowserRouteStore(new IDBFactory());
    expect(await to.importBackup(await backup.blob.text())).toBe(2);
    expect(await to.importBackup(await backup.blob.text())).toBe(2); // same ids replace
    expect((await to.list()).flatMap((f) => f.routes)).toHaveLength(2);
    expect(await to.importBackup('{"routes":[{"name":"no gpx"}]}')).toBe(0);
  });
});

describe('project folder store (desktop server)', () => {
  let server: { close(cb: () => void): void; listen(port: number, host: string, cb: () => void): void; address(): AddressInfo };
  let base = '';
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'saved-routes-'));

  beforeAll(async () => {
    const mod = (await import(/* @vite-ignore */ path.resolve(import.meta.dirname, '../../server/server.mjs'))) as {
      createServer(o: object): typeof server;
    };
    server = mod.createServer({ routesDir: dir, serverRoutes: true, log: { error() {} } });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${server.address().port}`;
  });
  afterAll(async () => {
    await new Promise<void>((r) => server.close(r));
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('save, list, get, GPX, ZIP, delete through /api/routes', async () => {
    const store = new ServerRouteStore({ base });
    const saved = await store.save({ ...newRoute('Gipfel'), id: null });
    expect(saved.points).toBe(2);
    expect(fs.existsSync(path.join(dir, `${saved.id}.json`))).toBe(true);
    const folders = await store.list();
    expect(folders[0]).toMatchObject({ name: 'Oberstdorf', routes: [{ id: saved.id, name: 'Gipfel' }] });
    const full = await store.getWithGpx(saved.id);
    expect(full.gpx).toBe(GPX);
    expect(full.options).toEqual({ difficulties: ['novice'] });
    expect((await store.gpxBlob(saved.id)).filename).toBe('gipfel.gpx');
    expect(await zipNames((await store.zipBlob('Oberstdorf')).blob)).toEqual(['gipfel.gpx']);
    await store.delete(saved.id);
    expect(await store.list()).toEqual([]);
    await expect(store.get(saved.id)).rejects.toThrow('Route not found');
  });
});

describe('saved sheet logic', () => {
  function setup() {
    const route = new RouteState();
    const toasts: { text: string; action?: { label: string; run: () => void } }[] = [];
    const opened: string[] = [];
    const browser = new BrowserRouteStore(new IDBFactory());
    const names: string[] = [];
    const saved = new SavedState(
      {
        route,
        resort: () => ({ id: 'oberstdorf', name: 'Oberstdorf' }),
        hasResort: (id) => id === 'oberstdorf',
        makeRoute: async (name) => {
          names.push(name);
          return { gpx: GPX, summary, legs: route.points.length - 1 };
        },
        afterOpen: (r) => void opened.push(r.id),
        toast: (text, action) => void toasts.push({ text, action }),
      },
      { browser, server: null },
      'server', // not available: falls back to the browser
    );
    return { route, saved, toasts, opened, names, browser };
  }

  test('save needs two points; saves with the default name and folder; then "Save changes" and "Save as new"', async () => {
    const { route, saved, names } = setup();
    expect(saved.storage).toBe('browser');
    route.addPoint([10.27, 47.4]);
    expect(await saved.save()).toBeNull();
    route.addPoint([10.29, 47.38]);
    const a = (await saved.save())!;
    expect(names).toEqual(['Oberstdorf route']); // the GPX gets the route name
    expect(a).toMatchObject({ name: 'Oberstdorf route', folder: 'My routes' });
    expect(route.savedId).toBe(a.id);
    expect(route.changedSinceSaved).toBe(false);
    expect(saved.status?.text).toBe('Saved in "My routes".');
    expect(saved.folders[0].routes).toHaveLength(1);

    route.addPoint([10.3, 47.37]);
    expect(route.changedSinceSaved).toBe(true);
    route.routeFolder = 'Oberstdorf';
    const same = (await saved.save())!;
    expect(same.id).toBe(a.id);
    expect(saved.folderNames).toEqual(['My routes', 'Oberstdorf']);
    const copy = (await saved.save(true))!;
    expect(copy.id).not.toBe(a.id);
    expect(route.savedId).toBe(copy.id);
    expect(saved.count).toBe(2);
  });

  test('open restores points and settings; unknown resorts are refused', async () => {
    const { route, saved, opened, toasts, browser } = setup();
    const r = await browser.save({ ...newRoute('Family'), points: [[10.27, 47.4], [10.28, 47.39], [10.29, 47.38]], options: { difficulties: ['easy'], liftWait: 0 } });
    await saved.load();
    expect(await saved.open(r.id)).toBe(true);
    expect(route.points).toHaveLength(3);
    expect(route.options.difficulties).toEqual(['easy']);
    expect(route.routeName).toBe('Family');
    expect(route.savedId).toBe(r.id);
    expect(opened).toEqual([r.id]);
    const other = await browser.save({ ...newRoute('Elsewhere'), resort: 'zermatt', resortName: 'Zermatt' });
    expect(await saved.open(other.id)).toBe(false);
    expect(toasts.at(-1)?.text).toMatch(/Zermatt/);
  });

  test('delete shows "Route deleted" with Undo, which puts the route back', async () => {
    const { route, saved, toasts, browser } = setup();
    route.addPoint([10.27, 47.4]);
    route.addPoint([10.29, 47.38]);
    const a = (await saved.save())!;
    const before = await browser.get(a.id);
    await saved.delete(a);
    expect(saved.count).toBe(0);
    expect(route.savedId).toBeNull();
    const toast = toasts.at(-1)!;
    expect(toast.text).toBe('Route deleted');
    toast.action!.run();
    await new Promise((r) => setTimeout(r, 20));
    expect(saved.count).toBe(1);
    expect(await browser.get(a.id)).toEqual(before);
    expect(route.savedId).toBe(a.id);
  });
});
