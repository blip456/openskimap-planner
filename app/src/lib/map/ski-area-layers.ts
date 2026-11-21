// "Ski areas in colour" (old planner: addSkiAreaLayers, loadSkiAreas, emphasizeSkiArea). Every ski area gets a
// colour (outline, fill, halo around its runs and lifts); umbrella regions get a dashed outline. The data comes from
// the routing worker (precomputed in the PWA data file).
import type { GeoJSONSource, Map as MlMap } from 'maplibre-gl';
import type { FeatureCollection } from 'geojson';
import type { SkiAreas } from '@core/ski-areas.ts';

export const SKI_AREA_LAYERS = ['ski-area-fill', 'ski-area-halo', 'ski-area-outline', 'ski-area-region-outline', 'ski-area-label'] as const;
const EMPTY: FeatureCollection = { type: 'FeatureCollection', features: [] };

export function addSkiAreaLayers(map: MlMap, font: string[]): void {
  if (map.getSource('ski-area-outlines')) return;
  for (const id of ['ski-area-outlines', 'ski-area-labels', 'ski-area-halos']) map.addSource(id, { type: 'geojson', data: EMPTY });
  // below the highlights and the runs, so runs keep their difficulty colours on top
  const before = ['search-highlight', 'ski-run-areas'].find((id) => map.getLayer(id));
  const hidden = { visibility: 'none' as const };
  map.addLayer(
    { id: 'ski-area-fill', type: 'fill', source: 'ski-area-outlines', filter: ['!', ['get', 'region']], layout: hidden, paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.12 } },
    before,
  );
  map.addLayer(
    {
      id: 'ski-area-halo',
      type: 'line',
      source: 'ski-area-halos',
      layout: { ...hidden, 'line-cap': 'round', 'line-join': 'round' },
      // solid light colours: no darker spots where runs and lifts overlap
      paint: { 'line-color': ['get', 'halo'], 'line-width': ['interpolate', ['exponential', 1.5], ['zoom'], 11, 5, 14, 9, 17, 18] },
    },
    before,
  );
  map.addLayer(
    {
      id: 'ski-area-outline',
      type: 'line',
      source: 'ski-area-outlines',
      filter: ['!', ['get', 'region']],
      layout: { ...hidden, 'line-join': 'round' },
      paint: { 'line-color': ['get', 'color'], 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 1.5, 15, 3], 'line-opacity': 0.9 },
    },
    before,
  );
  map.addLayer(
    {
      id: 'ski-area-region-outline',
      type: 'line',
      source: 'ski-area-outlines',
      filter: ['get', 'region'],
      layout: { ...hidden, 'line-join': 'round' },
      paint: { 'line-color': ['get', 'color'], 'line-width': 2, 'line-dasharray': [3, 2], 'line-opacity': 0.8 },
    },
    before,
  );
  map.addLayer(
    {
      id: 'ski-area-label',
      type: 'symbol',
      source: 'ski-area-labels',
      maxzoom: 15.5,
      layout: {
        ...hidden,
        'text-field': ['case', ['get', 'region'], ['concat', 'Region: ', ['get', 'name']], ['get', 'name']],
        'text-font': font,
        'text-size': ['case', ['get', 'region'], 12, 14],
        'text-max-width': 10,
        'symbol-sort-key': ['case', ['get', 'region'], 1, 0],
      },
      paint: { 'text-color': ['get', 'color'], 'text-halo-color': '#ffffff', 'text-halo-width': 2.2 },
    },
    map.getLayer('route-casing') ? 'route-casing' : undefined,
  );
}

export function setSkiAreaData(map: MlMap, areas: SkiAreas | null): void {
  const set = (id: string, data: unknown) => (map.getSource(id) as GeoJSONSource | undefined)?.setData((data ?? EMPTY) as FeatureCollection);
  set('ski-area-outlines', areas?.outlines);
  set('ski-area-labels', areas?.labels);
  set('ski-area-halos', areas?.halos);
}

export function showSkiAreas(map: MlMap, on: boolean): void {
  for (const id of SKI_AREA_LAYERS) if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
  // the ski style has its own (uncoloured) ski area names
  if (map.getLayer('ski-areas-label')) map.setLayoutProperty('ski-areas-label', 'visibility', on ? 'none' : 'visible');
}

/** Highlights one ski area (legend hover/tap); null = all normal. */
export function emphasizeSkiArea(map: MlMap, id: string | null): void {
  if (!map.getLayer('ski-area-fill')) return;
  map.setPaintProperty('ski-area-fill', 'fill-opacity', id ? ['case', ['==', ['get', 'id'], id], 0.3, 0.05] : 0.12);
  map.setPaintProperty('ski-area-halo', 'line-color', id ? ['case', ['==', ['get', 'area'], id], ['get', 'color'], '#e3e6e9'] : ['get', 'halo']);
}
