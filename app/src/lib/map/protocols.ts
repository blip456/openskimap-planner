// Map protocols: pmtiles:// (all builds) and localdata:// (fonts and sprites from the browser storage).
import { addProtocol, type AddProtocolAction } from 'maplibre-gl';
import { PMTiles, Protocol } from 'pmtiles';
import type { DataSource } from '../data/types.ts';
import { LOCAL_PROTOCOL } from '../data/local.ts';
import { loadLocalAsset } from './local-assets.ts';

let protocol: Protocol | null = null;
let current: DataSource | null = null;

const localHandler: AddProtocolAction = async (params) => ({ data: await loadLocalAsset(current, params.url, params.type) });

/** Registers the protocols once, and the archives of this data source under their fixed names. */
export function useDataSource(ds: DataSource): void {
  if (!protocol) {
    protocol = new Protocol({ metadata: false });
    addProtocol('pmtiles', protocol.tile);
    addProtocol(LOCAL_PROTOCOL, localHandler);
  }
  current = ds;
  protocol.tiles.clear();
  for (const name of ds.info.tiles) {
    const source = ds.pmtilesSource(name);
    if (source) protocol.add(new PMTiles(source));
  }
}
