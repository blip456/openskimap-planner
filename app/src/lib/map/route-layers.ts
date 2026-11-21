// Route line on the map (same look as the current planner: white casing, run colours, dashed walks).
import type { ExpressionSpecification, GeoJSONSource, Map as MlMap, MapGeoJSONFeature, PointLike } from 'maplibre-gl';
import type { FeatureCollection } from 'geojson';
import { CONNECTION_COLOR, LIFT_COLOR } from '@core/ski.ts';
import type { RouteStep } from '@core/routing/index.ts';
import { distanceMarkers } from '../route/steps.ts';

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

/** Chevron pointing along the line, drawn on a canvas (no font needed; old planner arrowImage). */
export function arrowImage(color = '#1d2329'): ImageData | null {
  const c = document.createElement('canvas');
  c.width = 48;
  c.height = 48;
  const ctx = c.getContext('2d');
  if (!ctx) return null;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const path = () => {
    ctx.beginPath();
    ctx.moveTo(17, 12);
    ctx.lineTo(31, 24);
    ctx.lineTo(17, 36);
  };
  path();
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 12;
  ctx.stroke();
  path();
  ctx.strokeStyle = color;
  ctx.lineWidth = 6;
  ctx.stroke();
  return ctx.getImageData(0, 0, 48, 48);
}

const LABEL_FONT = ['Noto Sans Medium'];

/** Adds the route sources and layers (line, highlight, arrows, distance markers); call after every style load. */
export function addRouteLayers(map: MlMap): void {
  if (map.getSource('route')) return;
  for (const id of ['route', 'route-highlight', 'route-distances']) map.addSource(id, { type: 'geojson', data: EMPTY });
  if (!map.hasImage('route-arrow')) {
    const img = arrowImage();
    if (img) map.addImage('route-arrow', img, { pixelRatio: 2 });
  }
  map.addLayer({
    id: 'route-casing',
    type: 'line',
    source: 'route',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': '#ffffff', 'line-width': width(6, 14), 'line-opacity': 0.95 },
  });
  map.addLayer({
    id: 'route-highlight',
    type: 'line',
    source: 'route-highlight',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': '#ffe066', 'line-width': width(10, 20) },
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
  map.addLayer({
    id: 'route-arrows',
    type: 'symbol',
    source: 'route',
    layout: {
      'symbol-placement': 'line',
      'symbol-spacing': ['interpolate', ['linear'], ['zoom'], 11, 60, 16, 110],
      'icon-image': 'route-arrow',
      'icon-size': ['interpolate', ['linear'], ['zoom'], 11, 0.8, 16, 1.3],
      'icon-rotation-alignment': 'map',
      'icon-keep-upright': false,
      'icon-allow-overlap': true,
      'icon-ignore-placement': true,
    },
  });
  map.addLayer({
    id: 'route-distance-dots',
    type: 'circle',
    source: 'route-distances',
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 3, 16, 5],
      'circle-color': '#ffffff',
      'circle-stroke-color': '#1d2329',
      'circle-stroke-width': 2,
    },
  });
  map.addLayer({
    id: 'route-distance-labels',
    type: 'symbol',
    source: 'route-distances',
    layout: {
      'text-field': ['get', 'label'],
      'text-font': LABEL_FONT,
      'text-size': ['interpolate', ['linear'], ['zoom'], 11, 11, 16, 14],
      'text-offset': [0, -1.1],
      'text-anchor': 'bottom',
      'text-allow-overlap': false,
      'text-padding': 4,
    },
    paint: { 'text-color': '#1d2329', 'text-halo-color': '#ffffff', 'text-halo-width': 2 },
  });
}

export function setRouteSteps(map: MlMap, steps: readonly RouteStep[] | null, coordinates?: readonly (readonly [number, number, number?])[] | null): void {
  (map.getSource('route') as GeoJSONSource | undefined)?.setData(steps ? routeFeatures(steps) : EMPTY);
  const marks = coordinates ? distanceMarkers(coordinates) : [];
  (map.getSource('route-distances') as GeoJSONSource | undefined)?.setData({
    type: 'FeatureCollection',
    features: marks.map((m) => ({ type: 'Feature', properties: { label: m.label }, geometry: { type: 'Point', coordinates: m.coordinates } })),
  });
}

export function setRouteHighlight(map: MlMap, lines: readonly (readonly (readonly [number, number, number?])[])[] | null): void {
  (map.getSource('route-highlight') as GeoJSONSource | undefined)?.setData(
    lines
      ? {
          type: 'FeatureCollection',
          features: lines.map((c) => ({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: c.map((p) => [p[0], p[1]]) } })),
        }
      : EMPTY,
  );
}

/** Route arrows and distance markers on/off (display options showArrows / showDistances). */
export function setRouteDisplay(map: MlMap, d: { showArrows: boolean; showDistances: boolean }): void {
  if (!map.getLayer('route-arrows')) return;
  map.setLayoutProperty('route-arrows', 'visibility', d.showArrows ? 'visible' : 'none');
  for (const id of ['route-distance-dots', 'route-distance-labels']) map.setLayoutProperty(id, 'visibility', d.showDistances ? 'visible' : 'none');
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
