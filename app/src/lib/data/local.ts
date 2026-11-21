// PWA data source: the imported data ZIP in the browser storage (OPFS).
import { FileSource } from 'pmtiles';
import type { Source as PmtilesSource } from 'pmtiles';
import { findActivePackage, type StoredPackage } from './package-store.ts';
import { readPath, type StorageDir } from './storage.ts';
import { BlobSource, NamedSource, TILE_ARCHIVES, type DataInfo, type DataSource, type PlannerInput, type TileArchive } from './types.ts';

export const LOCAL_PROTOCOL = 'localdata';

export class LocalDataSource implements DataSource {
  readonly kind = 'local';
  readonly info: DataInfo;
  readonly pkg: StoredPackage;
  private readonly tiles: Map<TileArchive, File>;

  constructor(pkg: StoredPackage, tiles: Map<TileArchive, File>) {
    this.pkg = pkg;
    this.tiles = tiles;
    const m = pkg.manifest;
    this.info = {
      resorts: m.resorts.map(({ id, name, bbox, center }) => ({ id, name, bbox, center })),
      language: m.language ?? 'en',
      tiles: [...tiles.keys()],
      zoom: m.zoom,
      buildDate: m.buildDate,
      sizeBytes: m.files.reduce((n, f) => n + f.size, 0),
    };
  }

  async plannerData(resortId: string): Promise<PlannerInput> {
    const resort = this.pkg.manifest.resorts.find((r) => r.id === resortId);
    if (!resort) throw new Error(`Unknown resort "${resortId}"`);
    const blob = await readPath(this.pkg.dir, resort.planner);
    if (!blob) throw new Error(`The stored data is incomplete (${resort.planner}). Import the data file again.`);
    return { kind: 'blob', blob };
  }

  pmtilesSource(name: TileArchive): PmtilesSource | null {
    const file = this.tiles.get(name);
    if (!file) return null;
    // FileSource reads byte ranges with File.slice: nothing big is loaded into memory
    return new NamedSource(name, typeof File !== 'undefined' && file instanceof File ? new FileSource(file) : new BlobSource(file, name));
  }

  glyphsUrl(): string {
    return `${LOCAL_PROTOCOL}://fonts/{fontstack}/{range}.pbf`;
  }

  spriteUrl(): string {
    return `${LOCAL_PROTOCOL}://sprites/light`;
  }

  async readAsset(path: string): Promise<Blob | null> {
    if (!/^(fonts|sprites)\//.test(path)) return null;
    try {
      return await readPath(this.pkg.dir, path);
    } catch {
      return null; // unsafe path
    }
  }
}

/** Opens the newest complete import, or returns null when there is no data yet. */
export async function openLocalDataSource(root: StorageDir): Promise<LocalDataSource | null> {
  const pkg = await findActivePackage(root);
  if (!pkg) return null;
  const tiles = new Map<TileArchive, File>();
  for (const name of TILE_ARCHIVES) {
    const file = await readPath(pkg.dir, `tiles/${name}.pmtiles`);
    if (file) tiles.set(name, file);
  }
  if (!tiles.has('ski') || !tiles.has('basemap')) return null;
  return new LocalDataSource(pkg, tiles);
}
