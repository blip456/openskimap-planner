// Phase 5: storage screen logic, persist(), import error codes, online gating, toast placement, PWA build config.
import 'fake-indexeddb/auto'; // AppState opens the saved-routes store
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { dataParts, freeBytes, importFailureTitle, persistText, readStorageStatus, requestPersist, toImportFailure, usedShare, type StorageApi } from '../src/lib/data/storage-info.ts';
import { importPackage, ImportError, isQuotaError } from '../src/lib/data/import/pipeline.ts';
import { MemoryDir, type FileWriter } from '../src/lib/data/storage.ts';
import { listPackageDirs } from '../src/lib/data/package-store.ts';
import { RpcError } from '../src/lib/rpc/rpc.ts';
import { formatBytes } from '../src/lib/format.ts';
import { toastPlacement } from '../src/lib/stores/ui.svelte.ts';
import { NO_MATCHES, NO_NETWORK_HINT, OFFLINE_HINT, textItems } from '../src/lib/search/items.ts';
import { SearchState, type SearchDeps } from '../src/lib/stores/search.svelte.ts';
import { Settings } from '../src/lib/stores/settings.svelte.ts';
import { AppState } from '../src/lib/app.svelte.ts';
import { testZip } from './helpers.ts';
import { APP_NAME, ONLINE_ONLY_HOSTS, onlineOnlyPattern, pwaOptions } from '../vite.config.ts';

const MB = 1024 * 1024;

describe('storage screen', () => {
  test('size per part from the manifest, big parts first', () => {
    const parts = dataParts([
      { path: 'planner/resorts.json', size: 100 },
      { path: 'planner/oberstdorf.json', size: 4 * MB },
      { path: 'tiles/ski.pmtiles', size: 2 * MB },
      { path: 'tiles/basemap.pmtiles', size: 20 * MB },
      { path: 'tiles/terrain.pmtiles', size: 15 * MB },
      { path: 'fonts/Noto Sans Regular/0-255.pbf', size: 70_000 },
      { path: 'sprites/light.png', size: 30_000 },
    ]);
    expect(parts.map((p) => [p.id, p.bytes])).toEqual([
      ['basemap', 20 * MB],
      ['terrain', 15 * MB],
      ['ski', 2 * MB],
      ['planner', 4 * MB + 100],
      ['assets', 100_000],
    ]);
    expect(parts.find((p) => p.id === 'ski')?.label).toBe('Runs and lifts');
  });

  test('sizes are short and readable', () => {
    expect(formatBytes(500)).toBe('1 KB');
    expect(formatBytes(100_000)).toBe('98 KB');
    expect(formatBytes(45.6 * MB)).toBe('46 MB');
    expect(formatBytes(1.6 * 1024 * MB)).toBe('1.6 GB');
  });

  const fake = (over: Partial<StorageApi> & { granted?: boolean } = {}): StorageApi & { asked: number } => {
    let persisted = false;
    const api = {
      asked: 0,
      estimate: async () => ({ usage: 50 * MB, quota: 1000 * MB }),
      persisted: async () => persisted,
      persist: async () => {
        api.asked++;
        persisted = over.granted ?? true;
        return persisted;
      },
      ...over,
    };
    return api;
  };

  test('estimate and persisted are read; free space and share are computed', async () => {
    const s = await readStorageStatus(fake());
    expect(s).toEqual({ usage: 50 * MB, quota: 1000 * MB, persisted: false });
    expect(freeBytes(s)).toBe(950 * MB);
    expect(usedShare(s)).toBe(0.05);
  });

  test('missing or failing APIs give "unknown", never an error', async () => {
    expect(await readStorageStatus(null)).toEqual({ usage: null, quota: null, persisted: null });
    const broken = await readStorageStatus({
      estimate: async () => Promise.reject(new Error('no')),
      persisted: async () => Promise.reject(new Error('no')),
    });
    expect(broken).toEqual({ usage: null, quota: null, persisted: null });
    expect(freeBytes(broken)).toBeNull();
    expect(usedShare(broken)).toBeNull();
    expect(persistText(null).value).toBe('Unknown');
  });

  test('persist() is asked once, and not again when the data is already kept', async () => {
    const api = fake();
    expect(await requestPersist(api)).toBe(true);
    expect(await requestPersist(api)).toBe(true);
    expect(api.asked).toBe(1);
  });

  test('persist() refused: the screen explains it in plain words', async () => {
    const api = fake({ granted: false });
    expect(await requestPersist(api)).toBe(false);
    expect((await readStorageStatus(api)).persisted).toBe(false);
    const t = persistText(false);
    expect(t.value).toBe('Off');
    expect(t.note).toMatch(/iOS may delete this data/);
    expect(t.note).toMatch(/Home Screen/);
    expect(await requestPersist(null)).toBeNull();
    expect(await requestPersist({ persist: async () => Promise.reject(new Error('x')) })).toBe(false);
  });
});

describe('import errors', () => {
  test('each problem has a code and a clear title', async () => {
    const root = new MemoryDir();
    const codeOf = async (p: Promise<unknown>) => ((await p.catch((e: unknown) => e)) as ImportError).code;
    expect(await codeOf(importPackage(new Blob(['not a zip']), root))).toBe('not-data');
    expect(await codeOf(importPackage(testZip({ corrupt: 'tiles/ski.pmtiles' }), root))).toBe('damaged');
    expect(await codeOf(importPackage(testZip({ omit: 'tiles/ski.pmtiles' }), root))).toBe('damaged');
    expect(await codeOf(importPackage(testZip({ formatVersion: 99 }), root))).toBe('other');
    expect(await codeOf(importPackage(testZip({ tileSize: 3 * MB }), root, { estimate: async () => ({ quota: MB, usage: 0 }) }))).toBe('no-space');
    expect(importFailureTitle('not-data')).toBe('Wrong file');
    expect(importFailureTitle('damaged')).toBe('The file is damaged');
    expect(importFailureTitle('no-space')).toBe('Not enough space');
  });

  test('QuotaExceededError while writing → "not enough space", and nothing is left behind', async () => {
    class FullDir extends MemoryDir {
      override async dir(name: string, create = false) {
        const d = await super.dir(name, create);
        if (!d) return d;
        const full = Object.assign(new FullDir(name), d);
        (this.dirs as Map<string, MemoryDir>).set(name, full);
        return full;
      }
      override async createWriter(): Promise<FileWriter> {
        return {
          write: async () => {
            throw Object.assign(new Error('The quota has been exceeded.'), { name: 'QuotaExceededError' });
          },
          close: async () => {},
          abort: async () => {},
        };
      }
    }
    const root = new FullDir();
    const err = (await importPackage(testZip(), root).catch((e: unknown) => e)) as ImportError;
    expect(err).toBeInstanceOf(ImportError);
    expect(err.code).toBe('no-space');
    expect(await listPackageDirs(root)).toEqual([]);
    expect(isQuotaError({ name: 'QuotaExceededError' })).toBe(true);
    expect(isQuotaError({ code: 22 })).toBe(true);
    expect(isQuotaError(new Error('x'))).toBe(false);
  });

  test('errors from the import worker keep their code', () => {
    const fromWorker = new RpcError({ name: 'ImportError', message: 'This is not a data file for this app.', code: 'not-data' });
    expect(toImportFailure(fromWorker)).toEqual({ code: 'not-data', message: 'This is not a data file for this app.' });
    expect(toImportFailure(Object.assign(new Error('full'), { name: 'QuotaExceededError' })).code).toBe('no-space');
    expect(toImportFailure(new Error('Something else'))).toEqual({ code: 'other', message: 'Something else' });
  });
});

describe('online gating (plan §6): online mode AND a network', () => {
  test('search rows: the online row needs both; the footnote says why', () => {
    expect(textItems('hut', [], true, true).items.at(-1)?.online).toBe('hut');
    expect(textItems('hut', [], true, false)).toEqual({ items: [NO_MATCHES], footnote: NO_NETWORK_HINT });
    expect(textItems('hut', [], false, true)).toEqual({ items: [NO_MATCHES], footnote: OFFLINE_HINT });
  });

  const deps = (over: Partial<SearchDeps>): SearchDeps => ({
    local: async () => [],
    online: () => true,
    network: () => false,
    shortLinks: () => true,
    resolve: async () => Promise.reject(new Error('must not be called')),
    geocode: async () => Promise.reject(new Error('must not be called')),
    pick: () => {},
    ...over,
  });

  test('no network: no Nominatim request and no short-link request', async () => {
    let calls = 0;
    const s = new SearchState(deps({ geocode: async () => (calls++, []), resolve: async () => (calls++, { lat: 1, lon: 1 }) }), 0);
    await s.activate({ key: 'o', title: '', sub: '', icon: 'globe', color: '', online: 'hut' });
    s.query = 'https://maps.app.goo.gl/abc';
    await s.run();
    expect(calls).toBe(0);
    expect(s.items[0].title).toBe('This link needs internet');
  });

  test('the app: online maps and terrain fall back quietly without a network', () => {
    const app = new AppState(null);
    app.settings.setOnline(true);
    app.network = true;
    app.display.basemap = 'openfreemap';
    expect(app.onlineUsable).toBe(true);
    expect(app.basemap).toBe('openfreemap');
    app.networkLost();
    expect(app.onlineUsable).toBe(false);
    expect(app.basemap).toBe('local');
    expect(app.ui.toast?.text).toMatch(/No internet/);
    app.network = true;
    expect(app.basemap).toBe('openfreemap'); // back when the network is back
    app.settings.setOnline(false);
    expect(app.basemap).toBe('local');
  });

  test('the switch is saved', () => {
    const store = new Map<string, string>();
    const kv = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
    new Settings({ online: false }, kv).setOnline(true);
    expect(new Settings({ online: false }, kv).online).toBe(true);
  });
});

describe('toasts', () => {
  test('move above the tab bar while a menu or a large sheet covers the top (phone)', () => {
    const base = { wide: false, menuOpen: false, sheetOpen: false, detent: 'medium' as const };
    expect(toastPlacement(base)).toBe('top');
    expect(toastPlacement({ ...base, sheetOpen: true })).toBe('top');
    expect(toastPlacement({ ...base, sheetOpen: true, detent: 'large' })).toBe('low');
    expect(toastPlacement({ ...base, menuOpen: true })).toBe('low');
    expect(toastPlacement({ ...base, wide: true, menuOpen: true })).toBe('top');
  });
});

describe('PWA build config', () => {
  const opts = pwaOptions();
  test('manifest: name, standalone, icons incl. maskable', () => {
    const m = opts.manifest as { name: string; display: string; icons: { src: string; purpose?: string; sizes: string }[] };
    expect(m.name).toBe(APP_NAME);
    expect(m.display).toBe('standalone');
    expect(m.icons.map((i) => i.sizes)).toEqual(expect.arrayContaining(['192x192', '512x512']));
    expect(m.icons.some((i) => i.purpose === 'maskable')).toBe(true);
    for (const i of m.icons) expect(fs.existsSync(path.join(import.meta.dirname, '../public', i.src))).toBe(true);
  });

  test('the app name in index.html is the same', () => {
    const html = fs.readFileSync(path.join(import.meta.dirname, '../index.html'), 'utf8');
    expect(html).toContain(`<title>${APP_NAME}</title>`);
    expect(html).toContain('viewport-fit=cover');
    expect(html).toContain('apple-mobile-web-app-capable');
    expect(html).toContain('black-translucent');
    expect(html).toMatch(/theme-color[^>]*prefers-color-scheme: dark/);
    expect(html).toContain('rel="apple-touch-icon"');
  });

  test('service worker: prompt for updates, app shell only, online hosts network only', () => {
    expect(opts.registerType).toBe('prompt');
    expect(opts.injectRegister).toBe(false);
    const wb = opts.workbox!;
    expect(wb.skipWaiting).toBe(false);
    expect(wb.globPatterns!.join()).not.toMatch(/pmtiles|zip|pbf|json/); // never the data
    const rule = wb.runtimeCaching![0];
    expect(rule.handler).toBe('NetworkOnly');
    const re = onlineOnlyPattern();
    for (const h of ONLINE_ONLY_HOSTS) expect(re.test(`https://${h}/x`)).toBe(true);
    expect(re.test('https://example.org/x')).toBe(false);
    expect(ONLINE_ONLY_HOSTS).toContain('nominatim.openstreetmap.org');
    expect(opts.devOptions?.enabled).toBe(false);
  });
});
