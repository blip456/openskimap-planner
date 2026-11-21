// Map layers of the "Build region" page: the drawn box, the outlines of picked ski areas and the area a ski area
// region will cover (dashed).
import type { GeoJSONSource, Map as MlMap } from 'maplibre-gl';
import type { FeatureCollection } from 'geojson';
import { polygon, type Bbox } from './bbox.ts';

const BOX = 'region-box';
const AREAS = 'region-areas';
const COVER = 'region-cover';

const empty = (): FeatureCollection => ({ type: 'FeatureCollection', features: [] });

export function addRegionLayers(map: MlMap, accent: string): void {
  for (const id of [BOX, AREAS, COVER]) map.addSource(id, { type: 'geojson', data: empty() });
  map.addLayer({ id: `${AREAS}-fill`, type: 'fill', source: AREAS, paint: { 'fill-color': '#ef7d00', 'fill-opacity': 0.12 } });
  map.addLayer({ id: `${AREAS}-line`, type: 'line', source: AREAS, paint: { 'line-color': '#ef7d00', 'line-width': 1.5 } });
  map.addLayer({ id: `${COVER}-line`, type: 'line', source: COVER, paint: { 'line-color': accent, 'line-width': 2, 'line-dasharray': [2, 2] } });
  map.addLayer({ id: `${BOX}-fill`, type: 'fill', source: BOX, paint: { 'fill-color': accent, 'fill-opacity': 0.1 } });
  map.addLayer({ id: `${BOX}-line`, type: 'line', source: BOX, paint: { 'line-color': accent, 'line-width': 2.5 } });
}

function set(map: MlMap, id: string, boxes: Bbox[]): void {
  (map.getSource(id) as GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features: boxes.map(polygon) });
}

/** box: the drawn box; areas: outlines of picked ski areas; cover: what a ski area region will cover */
export function showRegion(map: MlMap, { box, areas, cover }: { box: Bbox | null; areas: Bbox[]; cover: Bbox | null }): void {
  set(map, BOX, box ? [box] : []);
  set(map, AREAS, areas);
  set(map, COVER, cover ? [cover] : []);
}
