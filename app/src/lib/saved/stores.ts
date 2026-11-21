// Two places to keep saved routes, with the same interface (port of the old planner's route-stores.js):
// - BrowserRouteStore: IndexedDB in this browser. Same database and store as the old planner ("ski-planner" /
//   "routes"), so routes saved there show up here (same origin, e.g. http://localhost:8081).
// - ServerRouteStore: JSON files in saved-routes/ on the desktop server (/api/routes*), desktop build only.
import { makeZip } from '@core/zip.ts';
import type { RouteSummary } from '@core/routing/index.ts';
import { slug } from '../share.ts';

export const DEFAULT_FOLDER = 'My routes';
export const DB_NAME = 'ski-planner';
export const DB_STORE = 'routes';

export interface SavedRoute {
  id: string;
  name: string;
  folder: string;
  resort: string;
  resortName: string;
  points: [number, number][];
  options: Record<string, unknown>;
  summary: Partial<RouteSummary> & { legs?: number };
  gpx: string;
  createdAt: string;
  updatedAt: string;
}

/** What a list shows: no GPX and options, and the number of points. */
export type SavedRouteMeta = Omit<SavedRoute, 'gpx' | 'options' | 'points'> & { points: number };
export interface SavedFolder {
  name: string;
  routes: SavedRouteMeta[];
}

export type NewRoute = Omit<SavedRoute, 'id' | 'createdAt' | 'updatedAt'> & { id?: string | null };

export interface RouteStore {
  readonly id: 'browser' | 'server';
  list(): Promise<SavedFolder[]>;
  get(id: string): Promise<SavedRoute>;
  save(route: NewRoute): Promise<SavedRouteMeta>;
  delete(id: string): Promise<void>;
  gpxBlob(id: string): Promise<{ blob: Blob; filename: string }>;
  zipBlob(folder: string): Promise<{ blob: Blob; filename: string }>;
}

export const cleanText = (s: unknown, max: number): string =>
  String(s ?? '')
    .replace(/[\u0000-\u001f/\\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);

const newId = (): string => Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => b.toString(16).padStart(2, '0')).join('');

export function groupByFolder(routes: SavedRouteMeta[]): SavedFolder[] {
  const folders = new Map<string, SavedRouteMeta[]>();
  for (const r of routes) {
    if (!folders.has(r.folder)) folders.set(r.folder, []);
    folders.get(r.folder)!.push(r);
  }
  return [...folders.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, list]) => ({ name, routes: list.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))) }));
}

export function toMeta(r: SavedRoute): SavedRouteMeta {
  const { gpx: _gpx, options: _options, ...rest } = r;
  return { ...rest, points: Array.isArray(r.points) ? r.points.length : 0 };
}

export function uniqueFiles(routes: readonly Pick<SavedRoute, 'name' | 'gpx'>[]): { name: string; text: string }[] {
  const used = new Set<string>();
  return routes.map((r) => {
    const base = slug(r.name) || 'ski-route';
    let name = base;
    for (let n = 2; used.has(name); n++) name = `${base}-${n}`;
    used.add(name);
    return { name: `${name}.gpx`, text: r.gpx };
  });
}

/** A record read from IndexedDB is only used when it has what is needed to reopen it. */
export function isUsableRoute(r: unknown): r is SavedRoute {
  const x = r as SavedRoute | null;
  return !!x && typeof x.id === 'string' && Array.isArray(x.points) && typeof x.resort === 'string';
}

// ---------------------------------------------------------------------------------------------------------------
// IndexedDB

export class BrowserRouteStore implements RouteStore {
  readonly id = 'browser' as const;
  private dbPromise: Promise<IDBDatabase> | null = null;
  private readonly idb: IDBFactory;

  constructor(idb: IDBFactory = indexedDB) {
    this.idb = idb;
  }

  private db(): Promise<IDBDatabase> {
    this.dbPromise ??= new Promise((resolve, reject) => {
      const req = this.idb.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(DB_STORE, { keyPath: 'id' });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return this.dbPromise;
  }

  private async tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
    const database = await this.db();
    return new Promise((resolve, reject) => {
      const t = database.transaction(DB_STORE, mode);
      const req = fn(t.objectStore(DB_STORE));
      t.oncomplete = () => resolve(req ? req.result : undefined);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error ?? new Error('Storage was aborted (is the browser storage full?)'));
    });
  }

  async all(): Promise<SavedRoute[]> {
    const rows = ((await this.tx('readonly', (s) => s.getAll())) ?? []) as unknown[];
    return rows.filter(isUsableRoute);
  }

  async list(): Promise<SavedFolder[]> {
    return groupByFolder((await this.all()).map(toMeta));
  }

  async get(id: string): Promise<SavedRoute> {
    const r = await this.tx('readonly', (s) => s.get(id));
    if (!isUsableRoute(r)) throw new Error('Route not found');
    return r;
  }

  async save(route: NewRoute): Promise<SavedRouteMeta> {
    return toMeta(await this.put(route));
  }

  /** Writes a full record; keeps createdAt of an existing record with the same id. */
  async put(route: NewRoute & { createdAt?: string; updatedAt?: string }, keepDates = false): Promise<SavedRoute> {
    const now = new Date().toISOString();
    const existing = route.id ? ((await this.tx('readonly', (s) => s.get(route.id!))) as SavedRoute | undefined) : undefined;
    const saved: SavedRoute = {
      ...route,
      id: route.id || newId(),
      name: cleanText(route.name, 120) || 'Ski route',
      folder: cleanText(route.folder, 60) || DEFAULT_FOLDER,
      createdAt: (keepDates && route.createdAt) || existing?.createdAt || now,
      updatedAt: (keepDates && route.updatedAt) || now,
    };
    await this.tx('readwrite', (s) => s.put(saved));
    return saved;
  }

  async delete(id: string): Promise<void> {
    await this.tx('readwrite', (s) => s.delete(id));
  }

  async gpxBlob(id: string): Promise<{ blob: Blob; filename: string }> {
    const r = await this.get(id);
    return { blob: new Blob([r.gpx], { type: 'application/gpx+xml' }), filename: `${slug(r.name) || 'ski-route'}.gpx` };
  }

  async zipBlob(folder: string): Promise<{ blob: Blob; filename: string }> {
    const routes = (await this.all()).filter((r) => r.folder === folder && typeof r.gpx === 'string');
    if (!routes.length) throw new Error(`Folder "${folder}" has no routes`);
    return { blob: makeZip(uniqueFiles(routes)), filename: `${slug(folder) || 'routes'}.zip` };
  }

  /** Backup: all routes (incl. GPX) as one JSON file (same format as the old planner). */
  async exportBackup(): Promise<{ blob: Blob; filename: string; count: number }> {
    const routes = await this.all();
    const data = { app: 'ski-route-planner', version: 1, exportedAt: new Date().toISOString(), routes };
    return {
      blob: new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
      filename: `ski-routes-backup-${new Date().toISOString().slice(0, 10)}.json`,
      count: routes.length,
    };
  }

  /** Imports a backup; the same id replaces the earlier copy. Returns the number of routes. */
  async importBackup(text: string): Promise<number> {
    const data = JSON.parse(text) as { routes?: unknown };
    const routes = Array.isArray(data?.routes) ? data.routes : [];
    let count = 0;
    for (const r of routes as SavedRoute[]) {
      if (!r || !Array.isArray(r.points) || typeof r.gpx !== 'string' || !r.resort) continue;
      const saved: SavedRoute = { ...r, id: /^[a-f0-9]{12}$/.test(String(r.id)) ? r.id : newId() };
      saved.name = cleanText(saved.name, 120) || 'Ski route';
      saved.folder = cleanText(saved.folder, 60) || DEFAULT_FOLDER;
      saved.updatedAt ??= new Date().toISOString();
      saved.createdAt ??= saved.updatedAt;
      await this.tx('readwrite', (s) => s.put(saved));
      count++;
    }
    return count;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// desktop server (saved-routes/ folder)

async function json<T>(res: Response): Promise<T> {
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(body.error ?? res.statusText);
  return body;
}

export class ServerRouteStore implements RouteStore {
  readonly id = 'server' as const;
  private readonly base: string;
  private readonly fetchFn: typeof fetch;

  constructor(options: { base?: string; fetch?: typeof fetch } = {}) {
    this.base = options.base ?? '';
    this.fetchFn = options.fetch ?? ((...a) => fetch(...a));
  }

  async list(): Promise<SavedFolder[]> {
    return (await json<{ folders: SavedFolder[] }>(await this.fetchFn(`${this.base}/api/routes`))).folders;
  }

  async get(id: string): Promise<SavedRoute> {
    return json<SavedRoute>(await this.fetchFn(`${this.base}/api/routes/${encodeURIComponent(id)}`));
  }

  /** The full route including the GPX (used to copy routes into the browser). */
  async getWithGpx(id: string): Promise<SavedRoute> {
    const route = await this.get(id);
    const res = await this.fetchFn(`${this.base}/api/routes/${encodeURIComponent(id)}.gpx`);
    if (!res.ok) throw new Error('Could not read the GPX');
    return { ...route, gpx: await res.text() };
  }

  async save(route: NewRoute): Promise<SavedRouteMeta> {
    const r = await json<SavedRoute>(
      await this.fetchFn(`${this.base}/api/routes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(route),
      }),
    );
    return { ...r, points: Array.isArray(r.points) ? r.points.length : 0 } as SavedRouteMeta;
  }

  async delete(id: string): Promise<void> {
    await json(await this.fetchFn(`${this.base}/api/routes/${encodeURIComponent(id)}`, { method: 'DELETE' }));
  }

  async gpxBlob(id: string): Promise<{ blob: Blob; filename: string }> {
    const res = await this.fetchFn(`${this.base}/api/routes/${encodeURIComponent(id)}.gpx`);
    if (!res.ok) throw new Error('Download failed');
    const r = await this.get(id);
    return { blob: new Blob([await res.text()], { type: 'application/gpx+xml' }), filename: `${slug(r.name) || 'ski-route'}.gpx` };
  }

  async zipBlob(folder: string): Promise<{ blob: Blob; filename: string }> {
    const res = await this.fetchFn(`${this.base}/api/routes/zip?folder=${encodeURIComponent(folder)}`);
    if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? 'Download failed');
    return { blob: new Blob([await res.arrayBuffer()], { type: 'application/zip' }), filename: `${slug(folder) || 'routes'}.zip` };
  }
}
