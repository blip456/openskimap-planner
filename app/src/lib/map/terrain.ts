// 3D terrain (old planner applyTerrain): its own elevation source (sharing the hillshade's lowers the quality),
// from the local terrain, or Mapterhorn online as a fallback in online mode.
import type { Map as MlMap, RasterDEMSourceSpecification } from 'maplibre-gl';
import { ONLINE_DEM } from './basemaps.ts';

/** Turns 3D on or off. Returns false when 3D is wanted but there is no elevation data (offline, no terrain). */
export function applyTerrain(map: MlMap, on: boolean, online: boolean): boolean {
  try {
    if (!on) {
      if (map.getTerrain()) map.setTerrain(null);
      return true;
    }
    if (!map.getSource('terrain-3d')) {
      const local = map.getStyle().sources?.terrain ?? map.getStyle().sources?.dem;
      const src = local?.type === 'raster-dem' ? { ...local } : online ? { ...ONLINE_DEM } : null;
      if (!src) return false;
      map.addSource('terrain-3d', src as RasterDEMSourceSpecification);
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
