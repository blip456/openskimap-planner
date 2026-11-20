// Map style builders. Used by the data build (TileServer GL styles) and by the app (with its own URLs).
import { layers as protomapsLayers, namedFlavor } from '@protomaps/basemaps';
import { CONNECTION_COLOR, LIFT_COLOR, NORDIC_COLOR } from '../ski.ts';
import { SLOPE_CLASSES } from '../slope.ts';
import type { Bbox } from '../types.ts';

export { CONNECTION_COLOR, LIFT_COLOR, NORDIC_COLOR, RUN_COLORS } from '../ski.ts';

/** A MapLibre style layer (kept loose on purpose: the style spec types are not a dependency of the core). */
export type StyleLayer = { id: string; [key: string]: unknown };
export type ColorBy = 'difficulty' | 'slope';
export interface Style {
  version: 8;
  name: string;
  center: [number, number];
  zoom: number;
  glyphs: string;
  sprite?: string;
  sources: Record<string, Record<string, unknown>>;
  layers: StyleLayer[];
}

const FONT_REGULAR = ['Noto Sans Regular'];
const FONT_MEDIUM = ['Noto Sans Medium'];

const runWidth = (base: number): unknown[] => ['interpolate', ['exponential', 1.5], ['zoom'], 11, base * 0.8, 14, base * 2, 17, base * 5];
const lineName = ['coalesce', ['get', 'label'], ''];

// Downhill runs coloured per ~50 m slice by measured gradient instead of the official difficulty.
export function runSlopeLayer(id = 'ski-runs-slope'): StyleLayer {
  return {
    id,
    type: 'line',
    source: 'ski',
    'source-layer': 'run_slopes',
    minzoom: 10,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': ['match', ['get', 'cls'], ...SLOPE_CLASSES.flatMap((c) => [c.id, c.color]), '#7d7d7d'],
      'line-width': runWidth(1),
    },
  };
}

const DIFFICULTY_LINE_LAYERS = ['ski-runs-downhill', 'ski-runs-expert-center', 'ski-runs-freeride'];

function skiLayers({ labels = true, colorBy = 'difficulty' }: { labels?: boolean; colorBy?: ColorBy } = {}): StyleLayer[] {
  const all = skiLayersByDifficulty({ labels });
  if (colorBy !== 'slope') return all;
  const at = all.findIndex((l) => l.id === 'ski-runs-downhill');
  const rest = all.filter((l) => !DIFFICULTY_LINE_LAYERS.includes(l.id));
  rest.splice(at, 0, runSlopeLayer());
  return rest;
}

function skiLayersByDifficulty({ labels = true }: { labels?: boolean } = {}): StyleLayer[] {
  const runLine = (id: string, filter: unknown[], paint: Record<string, unknown>, extraLayout: Record<string, unknown> = {}): StyleLayer => ({
    id,
    type: 'line',
    source: 'ski',
    'source-layer': 'runs',
    minzoom: 10,
    filter: ['all', ['==', ['geometry-type'], 'LineString'], filter],
    layout: { 'line-cap': 'round', 'line-join': 'round', ...extraLayout },
    paint,
  });

  const isDownhill = ['==', ['get', 'kind'], 'downhill'];
  const isFreeride = ['in', ['get', 'difficulty'], ['literal', ['freeride', 'extreme']]];
  const isExpert = ['==', ['get', 'difficulty'], 'expert'];
  const isDrag = ['==', ['get', 'liftClass'], 'drag'];

  const layers: StyleLayer[] = [
    {
      id: 'ski-run-areas',
      type: 'fill',
      source: 'ski',
      'source-layer': 'runs',
      minzoom: 11,
      filter: ['==', ['geometry-type'], 'Polygon'],
      paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.18 },
    },
    runLine('ski-runs-nordic', ['==', ['get', 'kind'], 'nordic'], {
      'line-color': NORDIC_COLOR,
      'line-width': runWidth(0.6),
      'line-dasharray': [2, 1.5],
      'line-opacity': 0.85,
    }),
    runLine('ski-runs-other', ['in', ['get', 'kind'], ['literal', ['skitour', 'sled', 'hike', 'other']]], {
      'line-color': '#8a6d3b',
      'line-width': runWidth(0.5),
      'line-dasharray': [1, 2],
      'line-opacity': 0.8,
    }),
    runLine('ski-runs-casing', ['any', isDownhill, ['==', ['get', 'kind'], 'connection']], {
      'line-color': '#ffffff',
      'line-width': runWidth(1.6),
      'line-opacity': 0.9,
    }),
    runLine('ski-runs-connection', ['==', ['get', 'kind'], 'connection'], {
      'line-color': CONNECTION_COLOR,
      'line-width': runWidth(0.7),
      'line-dasharray': [1.5, 1.5],
    }),
    runLine('ski-runs-downhill', ['all', isDownhill, ['!', isFreeride]], {
      'line-color': ['get', 'color'],
      'line-width': runWidth(1),
    }),
    runLine('ski-runs-expert-center', ['all', isDownhill, isExpert], {
      'line-color': '#ffffff',
      'line-width': runWidth(0.25),
      'line-dasharray': [2, 2],
    }),
    runLine('ski-runs-freeride', ['all', isDownhill, isFreeride], {
      'line-color': ['get', 'color'],
      'line-width': runWidth(0.8),
      'line-dasharray': [1.5, 1],
    }),
    {
      id: 'ski-lifts-casing',
      type: 'line',
      source: 'ski',
      'source-layer': 'lifts',
      minzoom: 10,
      layout: { 'line-cap': 'round' },
      paint: { 'line-color': '#ffffff', 'line-width': runWidth(1.2), 'line-opacity': 0.9 },
    },
    {
      id: 'ski-lifts',
      type: 'line',
      source: 'ski',
      'source-layer': 'lifts',
      minzoom: 10,
      filter: ['!', isDrag],
      layout: { 'line-cap': 'round' },
      paint: { 'line-color': LIFT_COLOR, 'line-width': runWidth(0.6) },
    },
    {
      id: 'ski-lifts-drag',
      type: 'line',
      source: 'ski',
      'source-layer': 'lifts',
      minzoom: 10,
      filter: isDrag,
      paint: { 'line-color': LIFT_COLOR, 'line-width': runWidth(0.6), 'line-dasharray': [2, 1] },
    },
    {
      id: 'ski-lift-stations',
      type: 'circle',
      source: 'ski',
      'source-layer': 'spots',
      minzoom: 13,
      filter: ['==', ['get', 'spotType'], 'lift_station'],
      paint: {
        'circle-color': '#ffffff',
        'circle-stroke-color': LIFT_COLOR,
        'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 13, 1, 17, 2.5],
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 13, 2.5, 17, 6],
      },
    },
  ];

  if (!labels) return layers;

  return [
    ...layers,
    {
      id: 'ski-runs-oneway',
      type: 'symbol',
      source: 'ski',
      'source-layer': 'runs',
      minzoom: 15,
      filter: ['all', ['==', ['geometry-type'], 'LineString'], isDownhill, ['==', ['get', 'oneway'], true]],
      layout: {
        'symbol-placement': 'line',
        'symbol-spacing': 140,
        'text-field': '›',
        'text-font': FONT_MEDIUM,
        'text-size': ['interpolate', ['linear'], ['zoom'], 15, 22, 18, 28],
        'text-keep-upright': false,
        'text-allow-overlap': true,
        'text-ignore-placement': true,
      },
      paint: { 'text-color': ['get', 'color'], 'text-halo-color': '#ffffff', 'text-halo-width': 2 },
    },
    {
      // lifts are oriented bottom → top in the build, so "›" points towards the top station;
      // "‹ ›" marks lifts you can ride both ways
      id: 'ski-lifts-direction',
      type: 'symbol',
      source: 'ski',
      'source-layer': 'lifts',
      minzoom: 13,
      layout: {
        'symbol-placement': 'line',
        'symbol-spacing': ['interpolate', ['linear'], ['zoom'], 13, 90, 17, 160],
        'text-field': ['case', ['==', ['get', 'direction'], 'both'], '‹ ›', '›'],
        'text-font': FONT_MEDIUM,
        'text-size': ['interpolate', ['linear'], ['zoom'], 13, 18, 17, 26],
        'text-keep-upright': false,
        'text-allow-overlap': true,
        'text-ignore-placement': true,
        'text-letter-spacing': 0.1,
      },
      paint: { 'text-color': LIFT_COLOR, 'text-halo-color': '#ffffff', 'text-halo-width': 2.2 },
    },
    {
      id: 'ski-runs-label',
      type: 'symbol',
      source: 'ski',
      'source-layer': 'runs',
      minzoom: 13,
      filter: ['all', ['==', ['geometry-type'], 'LineString'], ['!=', lineName, '']],
      layout: {
        'symbol-placement': 'line',
        'symbol-spacing': 300,
        'text-field': lineName,
        'text-font': FONT_MEDIUM,
        'text-size': ['interpolate', ['linear'], ['zoom'], 13, 12, 17, 17],
        'text-max-angle': 35,
      },
      paint: {
        'text-color': ['case', ['==', ['get', 'kind'], 'nordic'], NORDIC_COLOR, ['get', 'color']],
        'text-halo-color': '#ffffff',
        'text-halo-width': 2.2,
      },
    },
    {
      id: 'ski-lifts-label',
      type: 'symbol',
      source: 'ski',
      'source-layer': 'lifts',
      minzoom: 13,
      filter: ['!=', lineName, ''],
      layout: {
        'symbol-placement': 'line',
        'symbol-spacing': 400,
        'text-field': lineName,
        'text-font': FONT_MEDIUM,
        'text-size': ['interpolate', ['linear'], ['zoom'], 13, 12, 17, 17],
        'text-max-angle': 30,
      },
      paint: { 'text-color': LIFT_COLOR, 'text-halo-color': '#ffffff', 'text-halo-width': 2.2 },
    },
    {
      id: 'ski-areas-label',
      type: 'symbol',
      source: 'ski',
      'source-layer': 'ski_areas_labels',
      minzoom: 9,
      maxzoom: 13,
      layout: {
        'text-field': ['get', 'name'],
        'text-font': FONT_MEDIUM,
        'text-size': 13,
      },
      paint: { 'text-color': '#333333', 'text-halo-color': '#ffffff', 'text-halo-width': 2 },
    },
  ];
}

function terrainLayers(): StyleLayer[] {
  return [
    {
      id: 'hillshade',
      type: 'hillshade',
      source: 'terrain',
      paint: {
        'hillshade-exaggeration': ['interpolate', ['linear'], ['zoom'], 10, 0.55, 16, 0.35],
        'hillshade-shadow-color': '#3d3527',
        'hillshade-highlight-color': '#ffffff',
        'hillshade-accent-color': '#6b6255',
      },
    },
    {
      id: 'contours-minor',
      type: 'line',
      source: 'contours',
      'source-layer': 'contours',
      minzoom: 13,
      filter: ['!=', ['get', 'idx'], 1],
      paint: { 'line-color': '#a0784a', 'line-width': 0.5, 'line-opacity': 0.55 },
    },
    {
      id: 'contours-index',
      type: 'line',
      source: 'contours',
      'source-layer': 'contours',
      minzoom: 11,
      filter: ['==', ['get', 'idx'], 1],
      paint: {
        'line-color': '#a0784a',
        'line-width': ['interpolate', ['linear'], ['zoom'], 11, 0.6, 16, 1.2],
        'line-opacity': 0.7,
      },
    },
  ];
}

function contourLabels(): StyleLayer[] {
  return [
    {
      id: 'contours-label',
      type: 'symbol',
      source: 'contours',
      'source-layer': 'contours',
      minzoom: 14,
      filter: ['==', ['get', 'idx'], 1],
      layout: {
        'symbol-placement': 'line',
        'symbol-spacing': 350,
        'text-field': ['concat', ['to-string', ['get', 'ele']], ' m'],
        'text-font': FONT_REGULAR,
        'text-size': 10,
      },
      paint: { 'text-color': '#8a6339', 'text-halo-color': 'rgba(255,255,255,0.8)', 'text-halo-width': 1.2 },
    },
  ];
}

const ATTRIBUTION =
  'Data: OpenSkiData / OpenSkiMap.org, © OpenStreetMap contributors (ODbL), Skimap.org, Who\'s On First, © Mapterhorn, Protomaps';

export type TileArchive = 'basemap' | 'ski' | 'terrain' | 'contours';

/**
 * Where the style points. The defaults are the TileServer GL placeholders of the data build
 * (`pmtiles://{basemap}`, `{fontstack}/{range}.pbf`, `light`); the app passes its own URLs.
 */
export interface StyleUrls {
  tiles?: Partial<Record<TileArchive, string>>;
  glyphs?: string;
  sprite?: string;
}

const tileUrl = (urls: StyleUrls | undefined, name: TileArchive): string => urls?.tiles?.[name] ?? `pmtiles://{${name}}`;
const DEFAULT_GLYPHS = '{fontstack}/{range}.pbf';

export interface BasemapStyleOptions {
  language: string;
  bounds: Bbox;
  hasTerrain: boolean;
  hasContours: boolean;
  colorBy?: ColorBy;
  urls?: StyleUrls;
}

export function buildBasemapStyle({ language, bounds, hasTerrain, hasContours, colorBy = 'difficulty', urls }: BasemapStyleOptions): Style {
  const base = protomapsLayers('protomaps', namedFlavor('light'), { lang: language }) as unknown as StyleLayer[];
  const insertTerrainAfter = base.findIndex((l) => l.id === 'landuse_pier');
  const insertSkiBefore = base.findIndex((l) => l.id === 'address_label');

  const terrain: StyleLayer[] = [];
  if (hasTerrain) terrain.push(terrainLayers()[0]);
  if (hasContours) terrain.push(...terrainLayers().slice(1));

  const layers: StyleLayer[] = [
    ...base.slice(0, insertTerrainAfter + 1),
    ...terrain,
    ...base.slice(insertTerrainAfter + 1, insertSkiBefore),
    ...skiLayers({ labels: false, colorBy }),
    ...(hasContours ? contourLabels() : []),
    ...base.slice(insertSkiBefore),
    ...skiLayers({ labels: true, colorBy }).slice(skiLayers({ labels: false, colorBy }).length),
  ];

  const sources: Style['sources'] = {
    protomaps: { type: 'vector', url: tileUrl(urls, 'basemap'), attribution: ATTRIBUTION },
    ski: { type: 'vector', url: tileUrl(urls, 'ski') },
  };
  if (hasTerrain) {
    sources.terrain = { type: 'raster-dem', url: tileUrl(urls, 'terrain'), encoding: 'terrarium', tileSize: 512 };
  }
  if (hasContours) sources.contours = { type: 'vector', url: tileUrl(urls, 'contours') };

  return {
    version: 8,
    name: colorBy === 'slope' ? 'Ski basemap (runs by steepness)' : 'Ski basemap',
    center: [(bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2],
    zoom: 12,
    glyphs: urls?.glyphs ?? DEFAULT_GLYPHS,
    sprite: urls?.sprite ?? 'light',
    sources,
    layers,
  };
}

export function buildOverlayStyle({ bounds, colorBy = 'difficulty', urls }: { bounds: Bbox; colorBy?: ColorBy; urls?: StyleUrls }): Style {
  return {
    version: 8,
    name: colorBy === 'slope' ? 'Ski overlay (runs by steepness)' : 'Ski overlay',
    center: [(bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2],
    zoom: 12,
    glyphs: urls?.glyphs ?? DEFAULT_GLYPHS,
    sources: { ski: { type: 'vector', url: tileUrl(urls, 'ski'), attribution: ATTRIBUTION } },
    layers: skiLayers({ labels: true, colorBy }),
  };
}
