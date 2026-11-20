// The routing engine that runs in the routing worker (docs/pwa-plan.md §3.2): loads one resort, builds the
// SkiNetwork and the search index, and answers route / search / feature / skiAreas / nearest.
// No DOM and no worker APIs here, so it is unit-tested in Node.
import { SkiNetwork, RouteError, type RouteOptionsInput, type RouteResult } from '@core/routing/index.ts';
import { toGpx } from '@core/gpx.ts';
import { buildSearchIndex, prepareSearchIndex, searchLocal, type IndexedEntry, type SearchEntry } from '@core/search.ts';
import { featureDetails, type FeatureDetails } from '@core/feature-info.ts';
import { buildSkiAreas, type SkiAreas } from '@core/ski-areas.ts';
import { haversine } from '@core/geo.ts';
import type { ResortData } from '@core/types.ts';
import type { PlannerInput } from '../data/types.ts';

/** The planner file in the data ZIP also carries the precomputed search index and ski areas. */
export type PlannerFile = ResortData & { searchIndex?: SearchEntry[]; skiAreas?: SkiAreas };

export interface LoadTimings {
  /** reading the file (fetch or Blob) */
  readMs: number;
  parseMs: number;
  networkMs: number;
  searchMs: number;
  totalMs: number;
}

export interface LoadInfo {
  resortId: string;
  name: string;
  nodes: number;
  edges: number;
  searchEntries: number;
  precomputed: { searchIndex: boolean; skiAreas: boolean };
  timings: LoadTimings;
}

export type RouteResponse = RouteResult & { gpx: string; ms: number };

export interface NearestHit {
  /** [lon, lat, ele] of the network node */
  position: [number, number, number];
  /** m */
  distance: number;
  /** names of the runs/lifts at that node */
  names: string[];
}

export interface RoutingApi {
  load(resortId: string, input: PlannerInput): Promise<LoadInfo>;
  route(points: [number, number][], options?: RouteOptionsInput, name?: string): RouteResponse;
  search(query: string, limit?: number): SearchEntry[];
  feature(id: string): FeatureDetails | null;
  skiAreas(): SkiAreas;
  nearest(point: [number, number]): NearestHit | null;
}

type Clock = () => number;

export class RoutingEngine implements RoutingApi {
  private data: PlannerFile | null = null;
  private net: SkiNetwork | null = null;
  private index: IndexedEntry[] = [];
  private areas: SkiAreas | null = null;
  private readonly clock: Clock;
  private readonly fetchFn: typeof fetch;

  constructor(options: { clock?: Clock; fetch?: typeof fetch } = {}) {
    this.clock = options.clock ?? (() => performance.now());
    this.fetchFn = options.fetch ?? ((...a) => fetch(...a));
  }

  async load(resortId: string, input: PlannerInput): Promise<LoadInfo> {
    const t0 = this.clock();
    let text: string;
    if (input.kind === 'url') {
      const res = await this.fetchFn(input.url);
      if (!res.ok) throw new Error(`Could not load the resort data (${res.status})`);
      text = await res.text();
    } else {
      text = await input.blob.text();
    }
    const t1 = this.clock();
    const data = JSON.parse(text) as PlannerFile;
    const t2 = this.clock();
    const net = new SkiNetwork(data);
    const t3 = this.clock();
    const precomputedIndex = Array.isArray(data.searchIndex);
    this.index = prepareSearchIndex(precomputedIndex ? data.searchIndex! : buildSearchIndex(data));
    const t4 = this.clock();
    this.data = data;
    this.net = net;
    this.areas = data.skiAreas ?? null;
    const r = (ms: number) => Math.round(ms * 10) / 10;
    return {
      resortId,
      name: data.name,
      nodes: net.nodes.length,
      edges: net.edges.length,
      searchEntries: this.index.length,
      precomputed: { searchIndex: precomputedIndex, skiAreas: !!data.skiAreas },
      timings: { readMs: r(t1 - t0), parseMs: r(t2 - t1), networkMs: r(t3 - t2), searchMs: r(t4 - t3), totalMs: r(t4 - t0) },
    };
  }

  private network(): SkiNetwork {
    if (!this.net) throw new Error('No resort loaded');
    return this.net;
  }

  route(points: [number, number][], options: RouteOptionsInput = {}, name?: string): RouteResponse {
    const net = this.network();
    const t = this.clock();
    const result = net.route(points, options);
    const title = (name || `${net.name} ski route`).slice(0, 120);
    return { ...result, gpx: toGpx(title, result), ms: Math.round(this.clock() - t) };
  }

  search(query: string, limit = 10): SearchEntry[] {
    this.network();
    return searchLocal(this.index, query, limit).map(({ norm: _norm, ...e }) => e);
  }

  feature(id: string): FeatureDetails | null {
    this.network();
    return featureDetails(this.data!, id);
  }

  skiAreas(): SkiAreas {
    this.network();
    this.areas ??= buildSkiAreas(this.data!);
    return this.areas;
  }

  nearest(point: [number, number]): NearestHit | null {
    const net = this.network();
    const snap = net.nearestNode(point, false);
    if (snap.node < 0) return null;
    const names = [...net.nodeFeatures[snap.node]]
      .map((id) => net.features.get(id)?.props)
      .map((p) => (p ? String(p.name ?? p.ref ?? '').trim() : ''))
      .filter(Boolean);
    const pos = net.nodes[snap.node];
    return { position: [pos[0], pos[1], pos[2]], distance: Math.round(haversine(point, pos)), names: [...new Set(names)] };
  }
}

export { RouteError };
