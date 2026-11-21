// The app only talks to a DataSource (docs/pwa-plan.md §3.1). Desktop: files over HTTP from the desktop server.
// PWA: files in the browser storage (OPFS), imported from the data ZIP.
import type { Source as PmtilesSource } from 'pmtiles';
import type { TileArchive } from '@core/styles/index.ts';

export type { TileArchive };
export const TILE_ARCHIVES: readonly TileArchive[] = ['ski', 'basemap', 'terrain', 'contours'];

export interface ResortEntry {
  id: string;
  name: string;
  bbox: [number, number, number, number];
  center: [number, number];
}

export interface DataInfo {
  resorts: ResortEntry[];
  /** label language of the basemap */
  language: string;
  /** archives that exist (terrain and contours are optional) */
  tiles: TileArchive[];
  zoom: { terrain: number | null; basemap: number | null; ski: number | null } | null;
  /** YYYY-MM-DD of the data build, when known */
  buildDate: string | null;
  /** size of the imported data in bytes (PWA), null when not known */
  sizeBytes?: number | null;
  /** files of the imported data with their sizes (PWA, from the manifest) */
  files?: { path: string; size: number }[];
  /** date of the OpenSkiData download, when known */
  openSkiDataDate?: string | null;
}

/** How the routing worker gets the planner file: it fetches a URL itself, or reads a Blob (OPFS File). */
export type PlannerInput = { kind: 'url'; url: string } | { kind: 'blob'; blob: Blob };

export interface DataSource {
  readonly kind: 'server' | 'local';
  readonly info: DataInfo;
  plannerData(resortId: string): Promise<PlannerInput>;
  /** PMTiles source with a stable key (`pmtiles://<name>` in the style), or null when the archive is missing */
  pmtilesSource(name: TileArchive): PmtilesSource | null;
  glyphsUrl(): string;
  spriteUrl(): string;
  /** Local data only: reads `fonts/…` and `sprites/…` for the `localdata://` protocol. */
  readAsset?(path: string): Promise<Blob | null>;
}

/** Wraps a PMTiles source so its key is a fixed name: the style says `pmtiles://basemap` in both builds. */
export class NamedSource implements PmtilesSource {
  readonly name: string;
  readonly inner: PmtilesSource;
  constructor(name: string, inner: PmtilesSource) {
    this.name = name;
    this.inner = inner;
  }
  getKey(): string {
    return this.name;
  }
  getBytes(offset: number, length: number, signal?: AbortSignal, etag?: string) {
    return this.inner.getBytes(offset, length, signal, etag);
  }
}

/** PMTiles source over any Blob (an OPFS File, or an in-memory Blob in tests). */
export class BlobSource implements PmtilesSource {
  readonly blob: Blob;
  readonly key: string;
  constructor(blob: Blob, key: string) {
    this.blob = blob;
    this.key = key;
  }
  getKey(): string {
    return this.key;
  }
  async getBytes(offset: number, length: number) {
    return { data: await this.blob.slice(offset, offset + length).arrayBuffer() };
  }
}
