// 3D terrain (old planner applyTerrain): its own elevation source (sharing the hillshade's lowers the quality), a
// copy of the style's elevation source: the imported terrain on the offline ski map, Mapterhorn online on the online
// maps. The offline ski map never goes online.
import type { Map as MlMap, RasterDEMSourceSpecification } from 'maplibre-gl';
import { TERRAIN_LAYERS } from './basemaps.ts';

/** Turns 3D on or off. Returns false when 3D is wanted but the style has no elevation data. */
export function applyTerrain(map: MlMap, on: boolean): boolean {
  try {
    if (!on) {
      if (map.getTerrain()) map.setTerrain(null);
      return true;
    }
    if (!map.getSource('terrain-3d')) {
      const sources = map.getStyle().sources ?? {};
      const src = sources.terrain ?? sources.dem;
      if (src?.type !== 'raster-dem') return false;
      map.addSource('terrain-3d', { ...src } as RasterDEMSourceSpecification);
    }
    map.setTerrain({ source: 'terrain-3d', exaggeration: 1.2 });
    map.setSky({
      'sky-color': '#9ec9f0',
      'horizon-color': '#e4eef7',
      'fog-color': '#f2f5f8',
      'sky-horizon-blend': 0.6,
      'horizon-fog-blend': 0.6,
      'fog-ground-blend': 0.85,
    });
    return true;
  } catch {
    // the style is still loading; style.load applies it again
    return true;
  }
}

/** Shows or hides the hillshading and contour lines (hidden layers load no tiles). */
export function showTerrainLayers(map: MlMap, on: boolean): void {
  for (const id of TERRAIN_LAYERS) {
    if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
  }
}
