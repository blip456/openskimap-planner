// App start-up: capabilities → data source → routing worker. Also runs data imports (PWA).
import { TARGET, fetchServerCapabilities, mergeServerCapabilities, staticCapabilities, type Capabilities } from './platform/index.ts';
import type { DataSource, ResortEntry } from './data/types.ts';
import { ServerDataSource } from './data/server.ts';
import { openLocalDataSource } from './data/local.ts';
import { hasOpfs, opfsDataRoot } from './data/opfs.ts';
import { removePackagesExcept } from './data/package-store.ts';
import { readStorageStatus, requestPersist, toImportFailure, type ImportFailure, type StorageStatus } from './data/storage-info.ts';
import { startImport } from './data/import/client.ts';
import type { ImportProgress } from './data/import/pipeline.ts';
import { startRoutingWorker, type RoutingClient } from './worker/client.ts';
import type { LoadInfo } from './worker/engine.ts';
import { Settings } from './stores/settings.svelte.ts';
import { RouteState, type LngLat } from './stores/route.svelte.ts';
import { UiState, type Detent, type RoutePage, type SheetId } from './stores/ui.svelte.ts';
import { SavedState } from './stores/saved.svelte.ts';
import { defaultStorage, type KeyValue } from './stores/persist.ts';
import { loadPlannerData, savePlannerData, STATE_VERSION, type DisplayData, type MapView, type PlannerData } from './stores/planner-persist.ts';
import { BrowserRouteStore, ServerRouteStore, countBackupRoutes } from './saved/stores.ts';
import { gpxFileName, shareFile } from './share.ts';
import { ExploreState } from './stores/explore.svelte.ts';
import { SearchState } from './stores/search.svelte.ts';
import { geometryCoords } from './map/explore-layers.ts';
import { NO_NETWORK, effectiveBasemap, type BasemapId } from './map/basemaps.ts';
import { geocode } from '@core/search.ts';
import type { SkiAreas } from '@core/ski-areas.ts';
import type { GoogleResult } from './search/items.ts';

/** Points further than this from any run or lift keep their coordinates as title. */
const NAME_DISTANCE = 150;

export type AppStatus = 'starting' | 'no-data' | 'ready' | 'error';

export class AppState {
  status = $state<AppStatus>('starting');
  error = $state<string | null>(null);
  caps = $state.raw<Capabilities>(staticCapabilities(TARGET));
  data = $state.raw<DataSource | null>(null);
  resort = $state.raw<ResortEntry | null>(null);
  /** the routing worker answered `load` */
  routingReady = $state(false);
  loadInfo = $state.raw<LoadInfo | null>(null);
  importing = $state(false);
  importProgress = $state.raw<ImportProgress | null>(null);
  importError = $state.raw<ImportFailure | null>(null);
  /** browser storage: used, quota, persistent (Menu › Data) */
  storage = $state.raw<StorageStatus>({ usage: null, quota: null, persisted: null });
  /** the "Delete data" job is running */
  deleting = $state(false);
  /** a new app version is installed and waits (service worker); the user reloads when it suits them */
  updateReady = $state(false);
  /** reloads into the new version (set by the service worker module) */
  applyUpdate: () => void = () => location.reload();
  /** bumps after every (re)load of the data, so the map rebuilds */
  dataVersion = $state(0);
  /** ski area outlines of the open resort (loaded when "Ski areas in colour" is first switched on) */
  skiAreas = $state.raw<SkiAreas | null>(null);
  skiAreasError = $state<string | null>(null);
  /** the browser says it has a network connection */
  network = $state(typeof navigator === 'undefined' ? true : navigator.onLine !== false);
  /** an online map could not load in this session: the offline map is used until the user picks one again */
  onlineFailed = $state(false);

  readonly settings: Settings;
  readonly route: RouteState;
  readonly ui = new UiState();
  readonly explore: ExploreState;
  readonly search: SearchState;
  /** display options (route arrows and distances here; the Map sheet of phase 4b changes the rest) */
  display = $state<DisplayData>() as DisplayData;
  saved = $state.raw<SavedState>() as SavedState;
  /** desktop with a mouse: click removes a marker, GPX is downloaded instead of shared */
  readonly desktop = typeof matchMedia === 'function' && matchMedia('(hover: hover) and (pointer: fine)').matches;
  /** last map view, saved with the state (set by the map on moveend) */
  mapView: MapView | null = null;
  routing: RoutingClient | null = null;
  private stopWorker: (() => void) | null = null;
  private cancelImport: (() => void) | null = null;
  private readonly kv: KeyValue | null;
  private stored: PlannerData;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private stopPersist: (() => void) | null = null;

  constructor(kv: KeyValue | null = defaultStorage()) {
    this.kv = kv;
    this.settings = new Settings({ online: this.caps.onlineByDefault }, kv);
    const { data, source } = loadPlannerData(kv);
    if (source === 'legacy') console.info('[state] took over the route and settings of the old planner');
    this.stored = data;
    this.display = data.display;
    this.mapView = data.view;
    this.route = new RouteState({ stored: data });
    this.route.onNotice = (text) => this.ui.showToast(text);
    const s = data.sections;
    if (s.sheet === 'route' || s.sheet === 'saved' || s.sheet === 'map') this.ui.openSheet(s.sheet as SheetId, s.detent === 'large' ? 'large' : 'medium');
    if (s.routePage === 'settings' || s.routePage === 'speeds') this.ui.routePage = s.routePage as RoutePage;
    this.saved = this.makeSaved(data.routeStorage);
    this.explore = new ExploreState({
      feature: async (id) => (this.routing ? this.routing.call('feature', id) : null),
      route: this.route,
      // show the tapped spot in the free part of the map, without zooming in
      onopen: (card, geometry) => {
        const coords = geometryCoords(geometry);
        this.ui.fitTo(coords.length ? coords : [card.position], { onlyIfHidden: true, keepZoom: true });
      },
      onpin: (pin) => {
        const coords: [number, number][] = [[pin.lon, pin.lat], ...(pin.lines ?? []).flat()];
        this.ui.fitTo(coords, { maxZoom: 16 });
      },
      onused: () => {
        if (this.ui.wide) this.ui.openSheet('route');
        else this.ui.openSheet('route', 'medium');
      },
    });
    this.search = new SearchState({
      local: async (q) => (this.routing ? this.routing.call('search', q, 10) : []),
      online: () => this.settings.online,
      network: () => this.network,
      shortLinks: () => this.caps.googleShortLinks,
      resolve: (url) => this.resolveLink(url),
      geocode: (q) => geocode(q, this.resort?.bbox ?? null),
      pick: (pin) => {
        this.ui.searchOpen = false;
        this.explore.openPin(pin);
      },
    });
    if (typeof addEventListener === 'function') {
      addEventListener('online', () => (this.network = true));
      addEventListener('offline', () => this.networkLost());
    }
  }

  /** Google Maps short links: the desktop server follows them (capability googleShortLinks). */
  private async resolveLink(url: string): Promise<GoogleResult> {
    const q = new URLSearchParams({ url, resort: this.resort?.id ?? '' });
    const res = await fetch(`/api/resolve?${q}`);
    const body = (await res.json().catch(() => ({}))) as GoogleResult & { error?: string };
    if (!res.ok) throw new Error(body.error ?? res.statusText);
    return body;
  }

  // --- map options (Map sheet, Menu) ---------------------------------------------------------------------------

  /**
   * Online features may be used: the online-mode switch is on AND the browser has a network (plan §6). Every online
   * feature (online maps, Mapterhorn terrain, Nominatim, Google short links) asks this, so it falls back quietly.
   */
  get onlineUsable(): boolean {
    return this.settings.online && this.network;
  }

  /** The base map really shown: online maps only in online mode, with a network, and while they work. */
  get basemap(): BasemapId {
    return this.onlineFailed ? 'local' : effectiveBasemap(this.display.basemap, this.onlineUsable);
  }

  /** The network went away: an online map falls back to the offline map, with one short hint. */
  networkLost(): void {
    this.network = false;
    if (this.settings.online && this.display.basemap !== 'local' && !this.onlineFailed) this.ui.showToast(NO_NETWORK);
  }

  setBasemap(id: BasemapId): void {
    this.display.basemap = id;
    this.onlineFailed = false;
    if (id !== 'local' && !this.network) this.onlineFallback(NO_NETWORK);
  }

  /** An online map did not load (no internet): tell the user and show the offline map. */
  onlineFallback(message: string): void {
    if (this.onlineFailed) return;
    this.onlineFailed = true;
    this.ui.showToast(message);
  }

  setOnline(on: boolean): void {
    this.settings.setOnline(on);
    this.onlineFailed = false;
    if (on && !this.network) this.ui.showToast(NO_NETWORK);
  }

  setSolid(on: boolean): void {
    this.settings.setSolid(on);
  }

  /** Loads the ski areas once per resort (precomputed in the PWA data, built by the worker on the desktop). */
  async loadSkiAreas(): Promise<void> {
    if (this.skiAreas || !this.routing) return;
    const routing = this.routing;
    try {
      const areas = await routing.call('skiAreas');
      if (routing === this.routing) this.skiAreas = areas;
      this.skiAreasError = null;
    } catch {
      this.skiAreasError = 'Could not load the ski areas.';
    }
  }

  // --- routes backup (Menu) ------------------------------------------------------------------------------------

  async exportBackup(): Promise<void> {
    try {
      const backup = await this.saved.exportBackup();
      if (!backup) {
        this.ui.showToast('There are no saved routes to export.');
        return;
      }
      await shareFile(backup.blob, backup.filename, { desktop: this.desktop });
    } catch (err) {
      this.ui.showToast(err instanceof Error ? err.message : String(err));
    }
  }

  /** Reads a backup file: the number of routes in it (for the question), or an error message. */
  async readBackup(file: Blob): Promise<{ text: string; count: number } | { error: string }> {
    try {
      const text = await file.text();
      return { text, count: countBackupRoutes(text) };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  }

  async importBackup(text: string): Promise<void> {
    try {
      const count = await this.saved.importBackup(text);
      this.ui.showToast(`${count} route${count === 1 ? '' : 's'} imported.`);
    } catch {
      this.ui.showToast('This file is not a valid backup.');
    }
  }

  async copyAllToBrowser(): Promise<void> {
    try {
      const count = await this.saved.copyAllToBrowser();
      this.ui.showToast(`${count} route${count === 1 ? '' : 's'} copied to this browser.`);
    } catch (err) {
      this.ui.showToast(`Copy failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private makeSaved(storage: 'browser' | 'server'): SavedState {
    const browser = new BrowserRouteStore(typeof indexedDB === 'undefined' ? (undefined as unknown as IDBFactory) : indexedDB);
    return new SavedState(
      {
        route: this.route,
        resort: () => this.resort,
        hasResort: (id) => !!this.data?.info.resorts.some((r) => r.id === id),
        switchResort: (id) => this.switchResort(id, true),
        makeRoute: async (name) => {
          const r = await this.routeNow(name);
          return { gpx: r.gpx, summary: r.summary, legs: r.legs.length };
        },
        afterOpen: (r) => {
          this.ui.openSheet('route', 'medium');
          this.ui.fitTo(r.points);
        },
        toast: (text, action) => this.ui.showToast(text, { action }),
      },
      { browser, server: this.caps.projectFolderRoutes ? new ServerRouteStore() : null },
      storage,
    );
  }

  /** Everything that is saved in localStorage, read inside an effect (so it re-runs on every change). */
  plannerData(): PlannerData {
    const ui = this.ui;
    return {
      version: STATE_VERSION,
      resort: this.resort?.id ?? this.stored.resort,
      ...this.route.toData(),
      routeStorage: this.saved.storage,
      display: $state.snapshot(this.display) as DisplayData,
      sections: { ...(ui.sheet ? { sheet: ui.sheet, detent: ui.detent } : {}), routePage: ui.routePage },
      view: this.mapView,
    };
  }

  /** Saves now (also on pagehide). */
  saveNow(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = null;
    if (this.status === 'ready') savePlannerData(this.kv, this.plannerData());
  }

  scheduleSave(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.saveNow(), 150);
  }

  private startPersistence(): void {
    if (this.stopPersist) return;
    this.stopPersist = $effect.root(() => {
      $effect(() => {
        JSON.stringify(this.plannerData()); // track every field
        this.scheduleSave();
      });
    });
    addEventListener('pagehide', () => this.saveNow());
  }

  setMapView(view: MapView): void {
    this.mapView = view;
    this.scheduleSave();
  }

  /** Routes the current points now (for saving and sharing: the GPX carries the route name). */
  async routeNow(name: string) {
    if (!this.routing) throw new Error('Routing is not ready yet.');
    const points = this.route.points.map((p) => [p[0], p[1]] as LngLat);
    return this.routing.call('route', points, $state.snapshot(this.route.options), name.slice(0, 120));
  }

  /** Share GPX (iPhone share sheet) or download it (desktop). */
  async shareGpx(): Promise<void> {
    if (this.route.points.length < 2 || !this.resort) return;
    try {
      const name = this.route.routeName.trim() || `${this.resort.name} route`;
      const r = await this.routeNow(name);
      await shareFile(new Blob([r.gpx], { type: 'application/gpx+xml' }), gpxFileName(name), { desktop: this.desktop });
    } catch (err) {
      this.ui.showToast(`Could not make the GPX file: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async shareBlob(make: () => Promise<{ blob: Blob; filename: string }>): Promise<void> {
    try {
      const { blob, filename } = await make();
      await shareFile(blob, filename, { desktop: this.desktop });
    } catch (err) {
      this.ui.showToast(err instanceof Error ? err.message : String(err));
    }
  }

  /** Switches the resort (keepPoints: a saved route of that resort is being opened). */
  async switchResort(id: string, keepPoints = false): Promise<void> {
    const resort = this.data?.info.resorts.find((r) => r.id === id);
    if (!resort || !this.data || resort.id === this.resort?.id) return;
    this.settings.setResort(id);
    this.resort = resort;
    this.mapView = null;
    if (!keepPoints) this.route.clear();
    this.explore.close();
    this.search.clear();
    this.skiAreas = null;
    this.dataVersion++;
    await this.startRouting(this.data, resort);
  }

  async start(): Promise<void> {
    try {
      if (TARGET === 'desktop') {
        const server = await fetchServerCapabilities();
        this.caps = mergeServerCapabilities(this.caps, server);
        if (this.caps.projectFolderRoutes) this.saved = this.makeSaved(this.stored.routeStorage);
        if (!server.data) throw new Error(server.dataError ?? 'The desktop server has no map data. Run npm run build first.');
        await this.useData(new ServerDataSource(server.data, location.origin));
      } else {
        await this.openLocal();
      }
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err);
      this.status = 'error';
    }
  }

  private async openLocal(): Promise<void> {
    if (!hasOpfs()) throw new Error('This browser cannot store the map data (no Origin Private File System).');
    const ds = await openLocalDataSource(await opfsDataRoot(false));
    if (!ds) {
      this.status = 'no-data';
      return;
    }
    await this.useData(ds);
  }

  private async useData(ds: DataSource): Promise<void> {
    const wanted = this.settings.resortId ?? this.stored.resort;
    const resort = ds.info.resorts.find((r) => r.id === wanted) ?? ds.info.resorts[0];
    if (!resort) throw new Error('The data has no resorts.');
    // points, view and saved-route link belong to the stored resort
    if (this.stored.resort && this.stored.resort !== resort.id) {
      this.route.points = [];
      this.route.unlinkSaved();
    }
    if (this.mapView && this.mapView.resort !== resort.id) this.mapView = null;
    this.stored = { ...this.stored, resort: resort.id };
    this.data = ds;
    this.resort = resort;
    this.skiAreas = null;
    this.explore.close();
    this.dataVersion++;
    this.status = 'ready';
    this.startPersistence();
    void this.saved.load();
    await this.startRouting(ds, resort);
  }

  private async startRouting(ds: DataSource, resort: ResortEntry): Promise<void> {
    this.stopWorker?.();
    this.routingReady = false;
    this.route.setRouter(null);
    this.route.setNamer(null);
    const { client, terminate } = startRoutingWorker();
    this.routing = client;
    this.stopWorker = terminate;
    const t0 = performance.now();
    let info: LoadInfo;
    try {
      info = await client.call('load', resort.id, await ds.plannerData(resort.id));
    } catch (err) {
      this.route.error = `Routing is not available: ${err instanceof Error ? err.message : String(err)}`;
      return;
    }
    const t = info.timings;
    // measured start-up of the routing worker (plan §3.2: should be well under a second)
    console.info(
      `[routing] ${info.name}: ready in ${Math.round(performance.now() - t0)} ms incl. worker start ` +
        `(read ${t.readMs} ms, parse ${t.parseMs} ms, network ${t.networkMs} ms, search index ${t.searchMs} ms; ` +
        `${info.nodes} nodes, ${info.edges} edges)`,
    );
    this.loadInfo = { ...info, timings: { ...t, totalMs: Math.round(performance.now() - t0) } };
    this.routingReady = true;
    if (this.display.showSkiAreas) void this.loadSkiAreas();
    this.route.setRouter((points, options) => client.call('route', points, options));
    this.route.setNamer(async (p) => {
      const hit = await client.call('nearest', p);
      return hit && hit.distance <= NAME_DISTANCE && hit.names.length ? hit.names[0] : null;
    });
  }

  /** Sheet detent changes (persisted with the state). */
  setDetent(d: Detent): void {
    this.ui.detent = d;
  }

  /** Imports a data ZIP (file picker or the dev "Load data from build/" button). */
  async importData(file: Blob): Promise<boolean> {
    if (this.importing) return false;
    this.importing = true;
    this.importError = null;
    this.importProgress = { phase: 'checking', bytesDone: 0, bytesTotal: 0 };
    const job = startImport(file, (p) => (this.importProgress = p));
    this.cancelImport = job.cancel;
    try {
      const result = await job.done;
      console.info(`[import] ${(result.bytes / 1048576).toFixed(1)} MB in ${result.ms} ms (${result.writeMode})`);
      await this.openLocal();
      this.ui.showToast('Data imported');
      // ask the browser to keep the data (iOS may otherwise delete it when space runs low); the result is shown
      // on the Data page
      await requestPersist();
      await this.refreshStorage();
      return true;
    } catch (err) {
      this.importError = err instanceof Error && err.name === 'ImportCancelled' ? null : toImportFailure(err);
      void this.refreshStorage();
      return false;
    } finally {
      this.importing = false;
      this.importProgress = null;
      this.cancelImport = null;
    }
  }

  /** Reads the storage estimate and the persistent status again (Menu › Data). */
  async refreshStorage(): Promise<void> {
    this.storage = await readStorageStatus();
  }

  /** "Protect data" on the Data page: asks for persistent storage again. */
  async protectData(): Promise<void> {
    const ok = await requestPersist();
    await this.refreshStorage();
    if (ok === false) this.ui.showToast('The browser did not allow it. See the note below.');
  }

  /**
   * Deletes the imported data (Menu › Data › Delete data). Saved routes and settings stay. Afterwards the app shows
   * the first-run screen.
   */
  async deleteData(): Promise<void> {
    if (this.importing || this.deleting || TARGET !== 'pwa') return;
    this.deleting = true;
    try {
      this.saveNow();
      // stop everything that reads the files first
      this.stopWorker?.();
      this.stopWorker = null;
      this.routing = null;
      this.routingReady = false;
      this.route.setRouter(null);
      this.route.setNamer(null);
      this.explore.close();
      this.search.clear();
      this.ui.closeMenu();
      this.data = null;
      this.resort = null;
      this.skiAreas = null;
      this.status = 'no-data';
      // let the map unmount (it holds the tile files) before the files go
      await new Promise((r) => setTimeout(r, 50));
      await removePackagesExcept(await opfsDataRoot(false), null);
      this.importError = null;
      this.ui.showToast('Data deleted');
    } catch (err) {
      this.ui.showToast(`Could not delete the data: ${err instanceof Error ? err.message : String(err)}`);
      await this.openLocal().catch(() => {});
    } finally {
      this.deleting = false;
      await this.refreshStorage();
    }
  }

  cancelRunningImport(): void {
    this.cancelImport?.();
  }

  /** Dev builds only: fetch the newest ZIP from build/pwa/ through the Vite dev server. */
  async importFromBuild(): Promise<void> {
    if (!import.meta.env.DEV) return;
    this.importError = null;
    const res = await fetch('/__dev/pwa-data');
    if (!res.ok) {
      const message = ((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? `Could not load the ZIP (${res.status})`;
      this.importError = { code: 'other', message };
      return;
    }
    await this.importData(await res.blob());
  }
}
