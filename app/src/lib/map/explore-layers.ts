// Map layers for explore mode (old planner style.load): info-card highlight, mouse hover highlight and the search
// highlight, all drawn *below* the ski runs like a glow. Plus wholeGeometry: a rendered feature is only the piece
// inside one vector tile, so all loaded pieces with the same id (and, for runs, all sections of the same named
// piste) are collected.
import type { GeoJSONSource, Map as MlMap, MapGeoJSONFeature } from 'maplibre-gl';
import type { FeatureCollection, Geometry as GjGeometry } from 'geojson';
import type { Geometry } from '@core/types.ts';
import type { Highlight } from '../stores/explore.svelte.ts';

const EMPTY: FeatureCollection = { type: 'FeatureCollection', features: [] };
const lineWidth = (a: number, b: number) => ['interpolate', ['linear'], ['zoom'], 11, a, 16, b] as unknown as number;

export function addExploreLayers(map: MlMap): void {
  if (map.getSource('info-highlight')) return;
  for (const id of ['search-highlight', 'hover-highlight', 'info-highlight']) map.addSource(id, { type: 'geojson', data: EMPTY });
  // solid colours under the ski layers: translucent lines would look darker where tile pieces overlap
  const under = map.getLayer('ski-run-areas') ? 'ski-run-areas' : undefined;
  map.addLayer(
    {
      id: 'search-highlight',
      type: 'line',
      source: 'search-highlight',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#ffc58a', 'line-width': lineWidth(8, 18) },
    },
    under,
  );
  map.addLayer(
    {
      id: 'info-highlight-line',
      type: 'line',
      source: 'info-highlight',
      filter: ['!=', ['geometry-type'], 'Point'],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': ['case', ['==', ['get', 'part'], 'piste'], '#fff0a8', '#ffd84d'], 'line-width': lineWidth(8, 18) },
    },
    under,
  );
  map.addLayer(
    {
      id: 'hover-highlight-line',
      type: 'line',
      source: 'hover-highlight',
      filter: ['!=', ['geometry-type'], 'Point'],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#9ad7ff', 'line-width': lineWidth(6, 14) },
    },
    under,
  );
  map.addLayer(
    { id: 'hover-highlight-point', type: 'circle', source: 'hover-highlight', filter: ['==', ['geometry-type'], 'Point'], paint: { 'circle-radius': 12, 'circle-color': '#9ad7ff' } },
    under,
  );
  map.addLayer(
    { id: 'info-highlight-point', type: 'circle', source: 'info-highlight', filter: ['==', ['geometry-type'], 'Point'], paint: { 'circle-radius': 14, 'circle-color': '#ffd84d' } },
    under,
  );
}

const feature = (geometry: Geometry, properties: Record<string, unknown> = {}) => ({ type: 'Feature' as const, properties, geometry: geometry as unknown as GjGeometry });
const setData = (map: MlMap, id: string, data: FeatureCollection) => (map.getSource(id) as GeoJSONSource | undefined)?.setData(data);

export function setInfoHighlight(map: MlMap, h: Highlight | null): void {
  const features = [];
  if (h?.piste) features.push(feature(h.piste, { part: 'piste' }));
  if (h?.section) features.push(feature(h.section, { part: 'section' }));
  setData(map, 'info-highlight', { type: 'FeatureCollection', features });
}

export function setHoverHighlight(map: MlMap, g: Geometry | null): void {
  setData(map, 'hover-highlight', g ? { type: 'FeatureCollection', features: [feature(g)] } : EMPTY);
}

export function setSearchHighlight(map: MlMap, lines: [number, number][][] | null | undefined): void {
  setData(
    map,
    'search-highlight',
    lines?.length ? { type: 'FeatureCollection', features: lines.map((l) => feature({ type: 'LineString', coordinates: l })) } : EMPTY,
  );
}

/** All loaded pieces of a run or lift (and the other sections of the same piste), as one geometry. */
export function wholeGeometry(map: MlMap, f: Pick<MapGeoJSONFeature, 'source' | 'sourceLayer' | 'properties' | 'geometry'>): Geometry {
  const geometry = f.geometry as unknown as Geometry;
  if (f.source !== 'ski' || !f.properties.id || f.geometry.type === 'Point') return geometry;
  let pieces: MapGeoJSONFeature[];
  if (f.sourceLayer === 'run_slopes') {
    pieces = map.querySourceFeatures('ski', { sourceLayer: 'runs', filter: ['==', ['get', 'id'], f.properties.id] }) as MapGeoJSONFeature[];
    const named = pieces.find((p) => p.properties.name);
    if (named) return wholeGeometry(map, { source: 'ski', sourceLayer: 'runs', properties: named.properties, geometry: named.geometry });
  } else if (f.sourceLayer === 'runs' && f.properties.piste) {
    pieces = map.querySourceFeatures('ski', {
      sourceLayer: 'runs',
      filter: ['in', `|${f.properties.piste}|`, ['coalesce', ['get', 'pistes'], '']],
    }) as MapGeoJSONFeature[];
  } else {
    pieces = map.querySourceFeatures('ski', { sourceLayer: f.sourceLayer, filter: ['==', ['get', 'id'], f.properties.id] }) as MapGeoJSONFeature[];
  }
  const lines: number[][][] = [];
  const polygons: number[][][][] = [];
  for (const p of pieces) {
    const g = p.geometry;
    if (g.type === 'LineString') lines.push(g.coordinates);
    else if (g.type === 'MultiLineString') lines.push(...g.coordinates);
    else if (g.type === 'Polygon') polygons.push(g.coordinates);
    else if (g.type === 'MultiPolygon') polygons.push(...g.coordinates);
  }
  if (polygons.length) return { type: 'MultiPolygon', coordinates: polygons } as unknown as Geometry;
  if (lines.length) return { type: 'MultiLineString', coordinates: lines } as unknown as Geometry;
  return geometry;
}

/** Every coordinate of a geometry (for fitting the camera). */
export function geometryCoords(g: Geometry | null): [number, number][] {
  if (!g) return [];
  const out: [number, number][] = [];
  const walk = (x: unknown): void => {
    if (Array.isArray(x) && typeof x[0] === 'number') out.push([x[0] as number, x[1] as number]);
    else if (Array.isArray(x)) x.forEach(walk);
  };
  walk((g as { coordinates: unknown }).coordinates);
  return out;
}
