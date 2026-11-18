// Two places to keep saved routes, with the same interface:
// - browserStore: IndexedDB in this browser (works when the site is hosted; nothing is written on the server)
// - serverStore:  JSON files in saved-routes/ on the planner server (local use; can be turned off on the server)
import { makeZip } from '/zip.js';

export const DEFAULT_FOLDER = 'My routes';

export const slug = (s) =>
  String(s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);

const cleanText = (s, max) => String(s ?? '').replace(/[\u0000-\u001f/\\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const newId = () => Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => b.toString(16).padStart(2, '0')).join('');

function groupByFolder(routes) {
  const folders = new Map();
  for (const r of routes) {
    if (!folders.has(r.folder)) folders.set(r.folder, []);
    folders.get(r.folder).push(r);
  }
  return [...folders.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, list]) => ({ name, routes: list.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)) }));
}

const meta = ({ gpx, options, ...rest }) => ({ ...rest, points: rest.points.length });

function uniqueFiles(routes) {
  const used = new Set();
  return routes.map((r) => {
    const base = slug(r.name) || 'ski-route';
    let name = base;
    for (let n = 2; used.has(name); n++) name = `${base}-${n}`;
    used.add(name);
    return { name: `${name}.gpx`, text: r.gpx };
  });
}

// ---------------------------------------------------------------------------
// IndexedDB

const DB_NAME = 'ski-planner';
const STORE = 'routes';
let dbPromise = null;

function db() {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function tx(mode, fn) {
  const database = await db();
  return new Promise((resolve, reject) => {
    const t = database.transaction(STORE, mode);
    const store = t.objectStore(STORE);
    const req = fn(store);
    t.oncomplete = () => resolve(req?.result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error ?? new Error('Storage was aborted (is the browser storage full?)'));
  });
}

export const browserStore = {
  id: 'browser',
  label: 'This browser',

  async all() {
    return (await tx('readonly', (s) => s.getAll())) ?? [];
  },

  async list() {
    return groupByFolder((await this.all()).map(meta));
  },

  async get(id) {
    const r = await tx('readonly', (s) => s.get(id));
    if (!r) throw new Error('Route not found');
    return r;
  },

  // route: { id?, name, folder, resort, resortName, points, options, summary, gpx }
  async save(route) {
    const now = new Date().toISOString();
    const existing = route.id ? await tx('readonly', (s) => s.get(route.id)) : null;
    const saved = {
      ...route,
      id: route.id || newId(),
      name: cleanText(route.name, 120) || 'Ski route',
      folder: cleanText(route.folder, 60) || DEFAULT_FOLDER,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    await tx('readwrite', (s) => s.put(saved));
    return saved;
  },

  async delete(id) {
    await tx('readwrite', (s) => s.delete(id));
  },

  async gpxBlob(id) {
    const r = await this.get(id);
    return { blob: new Blob([r.gpx], { type: 'application/gpx+xml' }), filename: `${slug(r.name) || 'ski-route'}.gpx` };
  },

  async zipBlob(folder) {
    const routes = (await this.all()).filter((r) => r.folder === folder);
    if (!routes.length) throw new Error(`Folder "${folder}" has no routes`);
    return { blob: makeZip(uniqueFiles(routes)), filename: `${slug(folder) || 'routes'}.zip` };
  },

  // Backup: all routes (incl. GPX) as one JSON file, and import it again (same id = replaced)
  async exportBackup() {
    const routes = await this.all();
    const data = { app: 'ski-route-planner', version: 1, exportedAt: new Date().toISOString(), routes };
    return { blob: new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), filename: `ski-routes-backup-${new Date().toISOString().slice(0, 10)}.json`, count: routes.length };
  },

  async importBackup(text) {
    const data = JSON.parse(text);
    const routes = Array.isArray(data?.routes) ? data.routes : [];
    let count = 0;
    for (const r of routes) {
      if (!r || !Array.isArray(r.points) || typeof r.gpx !== 'string' || !r.resort) continue;
      const saved = { ...r, id: /^[a-f0-9]{12}$/.test(r.id) ? r.id : newId() };
      saved.name = cleanText(saved.name, 120) || 'Ski route';
      saved.folder = cleanText(saved.folder, 60) || DEFAULT_FOLDER;
      saved.updatedAt ??= new Date().toISOString();
      saved.createdAt ??= saved.updatedAt;
      await tx('readwrite', (s) => s.put(saved));
      count++;
    }
    return count;
  },
};

// ---------------------------------------------------------------------------
// planner server (saved-routes/ folder)

async function json(res) {
  const body = await res.json();
  if (!res.ok) throw new Error(body.error ?? res.statusText);
  return body;
}

export const serverStore = {
  id: 'server',
  label: 'Project folder',

  async list() {
    return (await json(await fetch('/api/routes'))).folders;
  },

  async get(id) {
    return json(await fetch(`/api/routes/${id}`));
  },

  // full route including the GPX (used to copy routes into the browser)
  async getWithGpx(id) {
    const route = await this.get(id);
    const res = await fetch(`/api/routes/${id}.gpx`);
    if (!res.ok) throw new Error('Could not read the GPX');
    return { ...route, gpx: await res.text() };
  },

  async save(route) {
    const { gpx, summary, resortName, ...body } = route; // the server recomputes the route and the GPX
    return json(await fetch('/api/routes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }));
  },

  async delete(id) {
    await json(await fetch(`/api/routes/${id}`, { method: 'DELETE' }));
  },

  async gpxBlob(id) {
    const res = await fetch(`/api/routes/${id}.gpx`);
    if (!res.ok) throw new Error('Download failed');
    const r = await this.get(id);
    return { blob: await res.blob(), filename: `${slug(r.name) || 'ski-route'}.gpx` };
  },

  async zipBlob(folder) {
    const res = await fetch(`/api/routes/zip?folder=${encodeURIComponent(folder)}`);
    if (!res.ok) throw new Error((await res.json()).error ?? 'Download failed');
    return { blob: await res.blob(), filename: `${slug(folder) || 'routes'}.zip` };
  },
};
