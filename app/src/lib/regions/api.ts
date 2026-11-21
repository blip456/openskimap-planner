// Client for the desktop server's "Build region" endpoints (server/region-builds.mjs).
import type { Bbox } from './bbox.ts';

export interface Zoom {
  terrain: number;
  basemap: number;
  ski: number;
}

export interface SkiAreaRef {
  id: string;
  name?: string;
}

/** A region as the server stores it (regions.json) and builds it. Either `bbox` or `skiAreas`. */
export interface Region {
  id: string;
  name: string;
  bbox?: Bbox;
  skiAreas?: (SkiAreaRef | string)[];
  marginKm?: number;
  zoom?: Partial<Zoom>;
}

export interface RegionDefaults {
  zoom: Zoom;
  ranges: { terrain: [number, number]; basemap: [number, number]; ski: [number, number] };
  bigZoom: number;
  maxSpanDeg: number;
  maxMarginKm: number;
  skiAreasAvailable: boolean;
}

export interface SkiAreaHit {
  id: string;
  name: string | null;
  country: string | null;
  region: string | null;
  locality: string | null;
  activities: string[];
  status: string | null;
  downhillKm: number;
  bbox: Bbox | null;
}

export interface Estimate {
  bbox: Bbox;
  widthKm: number;
  heightKm: number;
  terrainTiles: number;
  terrainBytes: number;
  basemapTiles: number;
  zoom: Zoom;
  big: boolean;
}

export type BuildState = 'running' | 'done' | 'failed' | 'cancelled';

export interface BuildStatus {
  id: string;
  region: Region;
  saved: boolean;
  state: BuildState;
  startedAt: string;
  finishedAt: string | null;
  zip: string | null;
  error: string | null;
  progress: string | null;
  lineCount: number;
}

export interface ZipInfo {
  name: string;
  size: number;
  modifiedAt: string;
}

/** One thing the "Clean up files" section can delete (server/region-builds.mjs cleanupGroups). */
export interface CleanupItem {
  key: string;
  label: string;
  note: string;
  /** optional items start unticked: deleting them makes the next build slower or needs a download */
  optional: boolean;
  count: number;
  bytes: number;
}

/** Region id from its name, same rule as the server (scripts/lib/region.mjs slugify). */
export function regionId(name: string): string {
  return name
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63)
    .replace(/-+$/, '');
}

export const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,62}$/;

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const body = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!res.ok) throw new Error(body?.error ?? `The desktop server answered ${res.status}.`);
  return body as T;
}

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

export const regionsApi = {
  defaults: () => call<RegionDefaults>('/api/regions/defaults'),
  search: (q: string, signal?: AbortSignal) => call<{ results: SkiAreaHit[] }>(`/api/skiareas?q=${encodeURIComponent(q)}`, { signal }).then((r) => r.results),
  estimate: (region: Partial<Region>, signal?: AbortSignal) => call<Estimate>('/api/regions/estimate', { ...json('POST', region), signal }),
  list: () => call<{ regions: Region[] }>('/api/regions').then((r) => r.regions),
  remove: (id: string) => call<{ ok: true }>(`/api/regions/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  build: (region: Region, save: boolean) => call<BuildStatus>('/api/builds', json('POST', { region, save })),
  cancel: () => call<BuildStatus>('/api/builds/current', { method: 'DELETE' }),
  zips: () => call<{ zips: ZipInfo[] }>('/api/zips').then((r) => r.zips),
  zipUrl: (name: string) => `/api/zips/${encodeURIComponent(name)}`,
  deleteZip: (name: string) =>
    call<{ removed: string; folderRemoved: boolean; bytes: number }>(`/api/zips/${encodeURIComponent(name)}`, { method: 'DELETE' }),
  cleanupItems: () => call<{ items: CleanupItem[] }>('/api/cleanup').then((r) => r.items),
  cleanup: (keys: string[]) => call<{ removed: { key: string; count: number; bytes: number }[] }>('/api/cleanup', json('POST', { keys })),
};

export interface BuildEvents {
  onhello: (build: BuildStatus | null, lines: string[]) => void;
  online: (text: string) => void;
  onprogress: (text: string) => void;
  onstatus: (build: BuildStatus) => void;
}

/** Live build output (server-sent events). Returns a function that closes the connection. */
export function watchBuild(handlers: BuildEvents): () => void {
  const es = new EventSource('/api/builds/current/events');
  const on = <T>(type: string, fn: (data: T) => void) =>
    es.addEventListener(type, (e) => fn(JSON.parse((e as MessageEvent<string>).data) as T));
  on<{ build: BuildStatus | null; lines: string[] }>('hello', (d) => handlers.onhello(d.build, d.lines));
  on<{ text: string }>('line', (d) => handlers.online(d.text));
  on<{ text: string }>('progress', (d) => handlers.onprogress(d.text));
  on<BuildStatus>('status', (d) => handlers.onstatus(d));
  return () => es.close();
}
