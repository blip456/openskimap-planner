// App start-up: capabilities → data source → routing worker. Also runs data imports (PWA).
import { TARGET, fetchServerCapabilities, mergeServerCapabilities, staticCapabilities, type Capabilities } from './platform/index.ts';
import type { DataSource, ResortEntry } from './data/types.ts';
import { ServerDataSource } from './data/server.ts';
import { openLocalDataSource } from './data/local.ts';
import { hasOpfs, opfsDataRoot } from './data/opfs.ts';
import { startImport } from './data/import/client.ts';
import type { ImportProgress } from './data/import/pipeline.ts';
import { startRoutingWorker, type RoutingClient } from './worker/client.ts';
import type { LoadInfo } from './worker/engine.ts';
import { Settings } from './stores/settings.svelte.ts';
import { RouteState } from './stores/route.svelte.ts';
import { UiState } from './stores/ui.svelte.ts';

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
  importError = $state<string | null>(null);
  /** bumps after every (re)load of the data, so the map rebuilds */
  dataVersion = $state(0);

  readonly settings: Settings;
  readonly route = new RouteState();
  readonly ui = new UiState();
  routing: RoutingClient | null = null;
  private stopWorker: (() => void) | null = null;
  private cancelImport: (() => void) | null = null;

  constructor() {
    this.settings = new Settings({ online: this.caps.onlineByDefault });
  }

  async start(): Promise<void> {
    try {
      if (TARGET === 'desktop') {
        const server = await fetchServerCapabilities();
        this.caps = mergeServerCapabilities(this.caps, server);
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
    const resort = ds.info.resorts.find((r) => r.id === this.settings.resortId) ?? ds.info.resorts[0];
    if (!resort) throw new Error('The data has no resorts.');
    this.data = ds;
    this.resort = resort;
    this.dataVersion++;
    this.status = 'ready';
    await this.startRouting(ds, resort);
  }

  private async startRouting(ds: DataSource, resort: ResortEntry): Promise<void> {
    this.stopWorker?.();
    this.routingReady = false;
    this.route.setRouter(null);
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
    this.route.setRouter((points, options) => client.call('route', points, options));
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
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.importError = err instanceof Error && err.name === 'ImportCancelled' ? null : msg;
      return false;
    } finally {
      this.importing = false;
      this.importProgress = null;
      this.cancelImport = null;
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
      this.importError = ((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? `Could not load the ZIP (${res.status})`;
      return;
    }
    await this.importData(await res.blob());
  }
}
