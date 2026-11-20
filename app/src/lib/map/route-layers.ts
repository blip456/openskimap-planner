// Route line on the map (same look as the current planner: white casing, run colours, dashed walks).
import type { ExpressionSpecification, GeoJSONSource, Map as MlMap, MapGeoJSONFeature, PointLike } from 'maplibre-gl';
import type { FeatureCollection } from 'geojson';
import { CONNECTION_COLOR, LIFT_COLOR } from '@core/ski.ts';
import type { RouteStep } from '@core/routing/index.ts';

const EMPTY: FeatureCollection = { type: 'FeatureCollection', features: [] };
const width = (a: number, b: number): ExpressionSpecification => ['interpolate', ['linear'], ['zoom'], 11, a, 16, b];

export function stepColor(s: Pick<RouteStep, 'type' | 'runKind' | 'color'>): string {
  if (s.type === 'lift') return LIFT_COLOR;
  if (s.type === 'walk' || s.runKind !== 'downhill') return CONNECTION_COLOR;
  return s.color ?? CONNECTION_COLOR;
}

export function routeFeatures(steps: readonly Pick<RouteStep, 'type' | 'runKind' | 'color' | 'coordinates'>[]): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: steps.map((s, i) => ({
      type: 'Feature',
      properties: { index: i, type: s.type, color: stepColor(s) },
      geometry: { type: 'LineString', coordinates: s.coordinates.map((c) => [c[0], c[1]]) },
    })),
  };
}

/** Adds the route source and layers; call after every style load. */
export function addRouteLayers(map: MlMap): void {
  if (map.getSource('route')) return;
  map.addSource('route', { type: 'geojson', data: EMPTY });
  map.addLayer({
    id: 'route-casing',
    type: 'line',
    source: 'route',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': '#ffffff', 'line-width': width(6, 14), 'line-opacity': 0.95 },
  });
  map.addLayer({
    id: 'route-line',
    type: 'line',
    source: 'route',
    filter: ['!=', ['get', 'type'], 'walk'],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': ['get', 'color'], 'line-width': width(3, 8) },
  });
  map.addLayer({
    id: 'route-walk',
    type: 'line',
    source: 'route',
    filter: ['==', ['get', 'type'], 'walk'],
    layout: { 'line-cap': 'round' },
    paint: { 'line-color': CONNECTION_COLOR, 'line-width': width(2, 5), 'line-dasharray': [0.5, 1.5] },
  });
}

export function setRouteSteps(map: MlMap, steps: readonly RouteStep[] | null): void {
  (map.getSource('route') as GeoJSONSource | undefined)?.setData(steps ? routeFeatures(steps) : EMPTY);
}

/** Layers a tap can pick, best first (same order as the current planner). */
const INTERACTIVE: [string, number][] = [
  ['ski-lift-stations', 0], ['ski-lifts', 1], ['ski-lifts-drag', 1], ['ski-lifts-label', 1],
  ['ski-runs-downhill', 2], ['ski-runs-slope', 2], ['ski-runs-freeride', 2], ['ski-runs-expert-center', 2],
  ['ski-runs-connection', 2], ['ski-runs-nordic', 2], ['ski-runs-other', 2], ['ski-runs-label', 2], ['ski-run-areas', 3],
  ['pois', 4], ['places_locality', 5], ['places_subplace', 5],
];
const PRIORITY = Object.fromEntries(INTERACTIVE);

/** The run, lift or place under a tap (with a few px of slack), or null. */
export function pickFeature(map: MlMap, point: { x: number; y: number }, pad = 8): MapGeoJSONFeature | null {
  const layers = INTERACTIVE.map(([id]) => id).filter((id) => map.getLayer(id));
  if (!layers.length) return null;
  const box: [PointLike, PointLike] = [[point.x - pad, point.y - pad], [point.x + pad, point.y + pad]];
  const usable = map
    .queryRenderedFeatures(box, { layers })
    .filter((f) => (f.source === 'ski' ? f.properties.id : f.properties.name));
  usable.sort((a, b) => PRIORITY[a.layer.id] - PRIORITY[b.layer.id]);
  return usable[0] ?? null;
}
