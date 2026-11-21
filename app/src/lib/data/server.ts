// Desktop data source: the files of `npm run build`, served by the desktop server (server/server.mjs).
import { FetchSource } from 'pmtiles';
import type { Source as PmtilesSource } from 'pmtiles';
import type { ServerDataInfo } from '../platform/index.ts';
import { NamedSource, TILE_ARCHIVES, type DataInfo, type DataSource, type PlannerInput, type TileArchive } from './types.ts';

export class ServerDataSource implements DataSource {
  readonly kind = 'server';
  readonly info: DataInfo;
  readonly origin: string;

  constructor(data: ServerDataInfo, origin: string) {
    this.origin = origin;
    this.info = {
      resorts: data.resorts,
      language: data.language,
      tiles: TILE_ARCHIVES.filter((t) => data.tiles.includes(t)),
      zoom: data.zoom,
      buildDate: data.builtAt ? data.builtAt.slice(0, 10) : null,
    };
  }

  private url(path: string): string {
    return new URL(path, this.origin).href;
  }

  async plannerData(resortId: string): Promise<PlannerInput> {
    if (!/^[\w-]+$/.test(resortId)) throw new Error(`Invalid resort id "${resortId}"`);
    return { kind: 'url', url: this.url(`/data/planner/${resortId}.json`) };
  }

  pmtilesSource(name: TileArchive): PmtilesSource | null {
    if (!this.info.tiles.includes(name)) return null;
    // HTTP Range requests against the desktop server
    return new NamedSource(name, new FetchSource(this.url(`/data/tiles/${name}.pmtiles`)));
  }

  glyphsUrl(): string {
    return this.url('/data/fonts/') + '{fontstack}/{range}.pbf';
  }

  spriteUrl(): string {
    return this.url('/data/sprites/light');
  }
}
