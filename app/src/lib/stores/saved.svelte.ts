// Saved routes: the library of the open storage place, saving the current route, opening and deleting routes.
// Old planner: loadLibrary / saveRoute / openSavedRoute / deleteSavedRoute.
import type { RouteSummary } from '@core/routing/index.ts';
import {
  DEFAULT_FOLDER,
  type BrowserRouteStore,
  type RouteStore,
  type SavedFolder,
  type SavedRoute,
  type SavedRouteMeta,
  type ServerRouteStore,
} from '../saved/stores.ts';
import type { RouteState } from './route.svelte.ts';

export type StorageId = 'browser' | 'server';

export interface SavedDeps {
  route: RouteState;
  /** current resort */
  resort(): { id: string; name: string } | null;
  /** route + GPX of the current points and settings, made by the routing worker with this name */
  makeRoute(name: string): Promise<{ gpx: string; summary: RouteSummary; legs: number }>;
  /** switches to the route's resort when needed, then shows it (sheet, map) */
  afterOpen?(route: SavedRoute): void | Promise<void>;
  /** resorts that exist in the loaded data */
  hasResort(id: string): boolean;
  switchResort?(id: string): Promise<void>;
  toast(text: string, action?: { label: string; run: () => void }): void;
}

export class SavedState {
  storage = $state<StorageId>('browser');
  folders = $state.raw<SavedFolder[]>([]);
  error = $state<string | null>(null);
  loading = $state(false);
  saving = $state(false);
  /** status line under the save buttons ("Saved in My routes.", "Could not save: …") */
  status = $state<{ text: string; error?: boolean } | null>(null);

  readonly stores: { browser: BrowserRouteStore | RouteStore; server: RouteStore | null };
  private readonly deps: SavedDeps;

  constructor(deps: SavedDeps, stores: { browser: BrowserRouteStore | RouteStore; server: RouteStore | null }, storage: StorageId = 'browser') {
    this.deps = deps;
    this.stores = stores;
    this.storage = storage === 'server' && stores.server ? 'server' : 'browser';
  }

  get store(): RouteStore {
    return (this.storage === 'server' && this.stores.server) || this.stores.browser;
  }

  get folderNames(): string[] {
    const names = this.folders.map((f) => f.name);
    return names.includes(DEFAULT_FOLDER) ? names : [DEFAULT_FOLDER, ...names];
  }

  get count(): number {
    return this.folders.reduce((n, f) => n + f.routes.length, 0);
  }

  async load(): Promise<void> {
    this.loading = true;
    try {
      this.folders = await this.store.list();
      this.error = null;
    } catch (err) {
      this.folders = [];
      this.error = err instanceof Error ? err.message : String(err);
    } finally {
      this.loading = false;
    }
  }

  /** A saved route belongs to one storage place: switching unlinks the current route. */
  async setStorage(id: StorageId): Promise<void> {
    if (id === this.storage || (id === 'server' && !this.stores.server)) return;
    this.storage = id;
    this.deps.route.unlinkSaved();
    this.status = null;
    await this.load();
  }

  /** Saves the current route (asNew: as a copy, even when it was opened from a saved route). */
  async save(asNew = false): Promise<SavedRouteMeta | null> {
    const route = this.deps.route;
    const resort = this.deps.resort();
    if (route.points.length < 2 || !resort || this.saving) return null;
    this.saving = true;
    this.status = { text: 'Saving…' };
    try {
      const name = route.routeName.trim() || `${resort.name} route`;
      const folder = route.routeFolder.trim() || DEFAULT_FOLDER;
      const made = await this.deps.makeRoute(name);
      const saved = await this.store.save({
        id: asNew ? null : route.savedId,
        name,
        folder,
        resort: resort.id,
        resortName: resort.name,
        points: route.points.map((p) => [p[0], p[1]]),
        options: JSON.parse(JSON.stringify(route.options)) as Record<string, unknown>,
        summary: { ...made.summary, legs: made.legs },
        gpx: made.gpx,
      });
      route.markSaved(saved.id, saved.name, saved.folder);
      await this.load();
      this.status = { text: `Saved in "${saved.folder}".` };
      return saved;
    } catch (err) {
      this.status = { text: `Could not save: ${err instanceof Error ? err.message : String(err)}`, error: true };
      return null;
    } finally {
      this.saving = false;
    }
  }

  async open(id: string): Promise<boolean> {
    try {
      const r = await this.store.get(id);
      if (!this.deps.hasResort(r.resort)) throw new Error(`the resort "${r.resortName ?? r.resort}" is not in the loaded data.`);
      if (r.resort !== this.deps.resort()?.id) await this.deps.switchResort?.(r.resort);
      this.deps.route.openSaved({ id: r.id, name: r.name, folder: r.folder, points: r.points, options: r.options });
      this.status = null;
      await this.deps.afterOpen?.(r);
      return true;
    } catch (err) {
      this.deps.toast(`Could not open the route: ${err instanceof Error ? err.message : String(err)}`);
      return false;
    }
  }

  /** Deletes without asking (spec §3.3); the toast offers Undo. */
  async delete(meta: Pick<SavedRouteMeta, 'id' | 'name'>): Promise<void> {
    // one delete per route at a time: a second one could finish after the Undo of the first and remove it again
    if (this.deleting.has(meta.id)) return;
    this.deleting.add(meta.id);
    try {
      await this.deleteNow(meta);
    } finally {
      this.deleting.delete(meta.id);
    }
  }
  private deleting = new Set<string>();

  private async deleteNow(meta: Pick<SavedRouteMeta, 'id' | 'name'>): Promise<void> {
    const store = this.store;
    let full: SavedRoute | null = null;
    try {
      full = await store.get(meta.id);
      if (store.id === 'server' && 'getWithGpx' in store) full = await (store as unknown as { getWithGpx(id: string): Promise<SavedRoute> }).getWithGpx(meta.id);
    } catch {
      // still delete it
    }
    await store.delete(meta.id);
    const wasOpen = this.deps.route.savedId === meta.id;
    if (wasOpen) this.deps.route.unlinkSaved();
    await this.load();
    this.deps.toast('Route deleted', full ? { label: 'Undo', run: () => void this.restore(store, full!, wasOpen) } : undefined);
  }

  // --- backup (Menu › Routes backup) -------------------------------------------------------------------------

  private get browser(): BrowserRouteStore {
    return this.stores.browser as BrowserRouteStore;
  }

  /** All routes of this device as one JSON file; null when there is nothing to export. */
  async exportBackup(): Promise<{ blob: Blob; filename: string } | null> {
    const backup = await this.browser.exportBackup();
    return backup.count ? { blob: backup.blob, filename: backup.filename } : null;
  }

  /** Adds the routes of a backup file to this device. Returns how many were added. */
  async importBackup(text: string): Promise<number> {
    const count = await this.browser.importBackup(text);
    if (this.storage === 'browser') await this.load();
    return count;
  }

  /** Desktop: copies every route of the project folder into this browser (same id: no duplicates). */
  async copyAllToBrowser(): Promise<number> {
    const server = this.stores.server as ServerRouteStore | null;
    if (!server) return 0;
    let count = 0;
    for (const folder of await server.list()) {
      for (const meta of folder.routes) {
        await this.browser.save(await server.getWithGpx(meta.id));
        count++;
      }
    }
    if (this.storage === 'browser') await this.load();
    return count;
  }

  private async restore(store: RouteStore, r: SavedRoute, relink: boolean): Promise<void> {
    let id = r.id;
    if ('put' in store && typeof (store as BrowserRouteStore).put === 'function') await (store as BrowserRouteStore).put(r, true);
    else id = (await store.save({ ...r, id: null })).id; // the server gives a new id
    if (relink) this.deps.route.markSaved(id, r.name, r.folder);
    await this.load();
  }
}
