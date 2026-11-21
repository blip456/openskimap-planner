// Base maps (docs/pwa-plan.md §6): the Protomaps ski map from the local data always; OpenSnowMap and
// OpenFreeMap + OpenSkiData pistes only in online mode. Port of the old planner's ONLINE_STYLE and
// loadOpenFreeMapStyle; the runs and lifts on OpenFreeMap now come from the local ski tiles (pmtiles://ski) instead of
// the tile server. The offline ski map only uses the imported terrain; the online maps use Mapterhorn online.
import type { Style, StyleLayer } from '@core/styles/index.ts';
import type { DisplayData } from '../stores/planner-persist.ts';

export type BasemapId = DisplayData['basemap'];

export const BASEMAPS: readonly { id: BasemapId; label: string; sources: string; online: boolean }[] = [
  { id: 'local', label: 'Ski map (offline)', sources: 'OpenSkiData + Protomaps, from your map data', online: false },
  { id: 'openfreemap', label: 'OpenFreeMap', sources: 'OpenSkiData + OpenFreeMap', online: true },
  { id: 'online', label: 'OpenSnowMap', sources: 'OpenStreetMap + OpenSnowMap pistes', online: true },
];

/** Online base maps need online mode; without it the offline map is used (the choice is kept for later). */
export function effectiveBasemap(chosen: BasemapId, online: boolean): BasemapId {
  return online ? chosen : 'local';
}

/** Base maps the Map sheet offers. */
export function basemapChoices(online: boolean): typeof BASEMAPS {
  return online ? BASEMAPS : BASEMAPS.filter((b) => !b.online);
}

/** OpenSnowMap draws runs and lifts as pictures: no ski layers to tap, hide or colour. */
export const hasSkiLayers = (b: BasemapId): boolean => b !== 'online';

/** OpenFreeMap's glyph server has no "Noto Sans Medium"; the other maps do. */
export const labelFont = (b: BasemapId): string[] => (b === 'openfreemap' ? ['Noto Sans Bold'] : ['Noto Sans Medium']);

/** Hosts of the online maps (requests to them fail without internet). */
export const ONLINE_HOSTS = ['tile.openstreetmap.org', 'tiles.opensnowmap.org', 'tiles.openfreemap.org', 'tiles.mapterhorn.com', 'protomaps.github.io'];
export const isOnlineUrl = (url: string): boolean => ONLINE_HOSTS.some((h) => url.includes(`//${h}/`));

export const OPENFREEMAP_STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';

// Online elevation tiles (Mapterhorn): 3D and hillshading on the online maps.
export const ONLINE_DEM = {
  type: 'raster-dem',
  tiles: ['https://tiles.mapterhorn.com/{z}/{x}/{y}.webp'],
  tileSize: 512,
  encoding: 'terrarium',
  maxzoom: 14,
  attribution: '<a href="https://mapterhorn.com/attribution" target="_blank">© Mapterhorn</a>',
} as const;

export const LOCAL_DEM = { type: 'raster-dem', url: 'pmtiles://terrain', encoding: 'terrarium', tileSize: 512 } as const;

const HILLSHADE: StyleLayer = {
  id: 'hillshade',
  type: 'hillshade',
  source: 'dem',
  paint: { 'hillshade-exaggeration': 0.3, 'hillshade-shadow-color': '#3d3527' },
};

/** Layers drawn from the elevation tiles (the Terrain switch hides them). */
export const TERRAIN_LAYERS = ['hillshade', 'contours-minor', 'contours-index', 'contours-label'];

/** Elevation source for hillshading / 3D: the offline ski map only uses the imported terrain, online maps Mapterhorn. */
export function demSource(basemap: BasemapId, hasLocalTerrain: boolean): Record<string, unknown> | null {
  if (basemap !== 'local') return { ...ONLINE_DEM };
  return hasLocalTerrain ? { ...LOCAL_DEM } : null;
}

/** OpenStreetMap with the transparent piste overlay of OpenSnowMap. */
export function openSnowMapStyle(): Style {
  const dem = demSource('online', false)!;
  return {
    version: 8,
    name: 'OpenStreetMap + OpenSnowMap',
    center: [0, 0],
    zoom: 12,
    glyphs: 'https://protomaps.github.io/basemaps-assets/fonts/{fontstack}/{range}.pbf',
    sources: {
      osm: {
        type: 'raster',
        tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
        tileSize: 256,
        maxzoom: 19,
        attribution: '© OpenStreetMap contributors',
      },
      dem,
      opensnowmap: {
        type: 'raster',
        tiles: ['https://tiles.opensnowmap.org/pistes/{z}/{x}/{y}.png'],
        tileSize: 256,
        maxzoom: 18,
        attribution: 'Pistes: opensnowmap.org (CC-BY-SA)',
      },
    },
    layers: [{ id: 'osm', type: 'raster', source: 'osm' }, structuredClone(HILLSHADE), { id: 'opensnowmap', type: 'raster', source: 'opensnowmap' }],
  };
}

/**
 * OpenFreeMap (online vector map) + hillshading + the OpenSkiData runs and lifts of the local ski tiles. The ski
 * layers keep their ids, so info cards, "Show" and run colours work as on the ski map.
 * `base` is the OpenFreeMap style JSON, `overlay` the core ski overlay style (with `pmtiles://ski`).
 */
export function openFreeMapStyle(base: Style, overlay: Style): Style {
  const style = structuredClone(base);
  const at = (id: string, fallback: number) => {
    const i = style.layers.findIndex((l) => l.id === id);
    return i < 0 ? fallback : i;
  };
  style.name = 'OpenFreeMap + OpenSkiData';
  style.sources.dem = demSource('openfreemap', false)!;
  style.layers.splice(at('water', 0) + 1, 0, structuredClone(HILLSHADE));
  style.sources.ski = overlay.sources.ski;
  const font = labelFont('openfreemap');
  const fixFont = (l: StyleLayer): StyleLayer => {
    const layout = l.layout as Record<string, unknown> | undefined;
    return layout?.['text-font'] ? { ...l, layout: { ...layout, 'text-font': font } } : l;
  };
  const lines = overlay.layers.filter((l) => l.type !== 'symbol');
  const labels = overlay.layers.filter((l) => l.type === 'symbol').map(fixFont);
  // runs and lifts below OpenFreeMap's labels, their own labels on top (like the Protomaps ski map)
  style.layers.splice(at('waterway_line_label', style.layers.length), 0, ...lines);
  style.layers.push(...labels);
  return style;
}

export interface StyleChoice {
  style: Style;
  /** the base map really shown (an online map can fall back to the offline one) */
  used: BasemapId;
  /** message for the user when something did not work */
  warning?: string;
}

export interface StyleDeps {
  /** the offline ski map */
  local: () => Style;
  /** the ski overlay (runs + lifts only) for OpenFreeMap */
  overlay: () => Style;
  fetch?: typeof fetch;
  /** cached OpenFreeMap style JSON between switches */
  cache?: { openFreeMap?: Style };
}

export const NO_NETWORK = 'No internet. Using the offline map.';

/** The style for a base map. Online maps fall back to the offline map with a message when they cannot load. */
export async function styleFor(id: BasemapId, deps: StyleDeps): Promise<StyleChoice> {
  if (id === 'local') return { style: deps.local(), used: 'local' };
  if (id === 'online') return { style: openSnowMapStyle(), used: 'online' };
  try {
    const cache = deps.cache ?? {};
    if (!cache.openFreeMap) {
      const res = await (deps.fetch ?? fetch)(OPENFREEMAP_STYLE_URL);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      cache.openFreeMap = (await res.json()) as Style;
    }
    return { style: openFreeMapStyle(cache.openFreeMap, deps.overlay()), used: 'openfreemap' };
  } catch {
    return { style: deps.local(), used: 'local', warning: 'Could not load OpenFreeMap (no internet?). Showing the offline ski map.' };
  }
}
