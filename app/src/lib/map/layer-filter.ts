// "Show" filter and run colours for the ski layers (old planner: LAYER_GROUPS, applyLayerFilter, addSlopeLayer).
// The pure part (which layer is visible, label filters) is unit-tested; `applyLayerFilter` writes it to the map.
import type { FilterSpecification, Map as MlMap } from 'maplibre-gl';
import { runSlopeLayer } from '@core/styles/index.ts';
import type { DisplayData } from '../stores/planner-persist.ts';

export type LayerGroup = keyof DisplayData['layers'];

/** Ski style layers per "Show" switch. */
export const LAYER_GROUPS: Record<LayerGroup, readonly string[]> = {
  downhill: [
    'ski-run-areas',
    'ski-runs-casing',
    'ski-runs-connection',
    'ski-runs-downhill',
    'ski-runs-expert-center',
    'ski-runs-freeride',
    'ski-runs-oneway',
  ],
  lifts: ['ski-lifts-casing', 'ski-lifts', 'ski-lifts-drag', 'ski-lift-stations', 'ski-lifts-direction', 'ski-lifts-label'],
  nordic: ['ski-runs-nordic'],
  other: ['ski-runs-other'],
};

/** Run kinds in the shared run label layer, per "Show" switch. */
export const RUN_LABEL_KINDS: Record<Exclude<LayerGroup, 'lifts'>, readonly string[]> = {
  downhill: ['downhill', 'connection'],
  nordic: ['nordic'],
  other: ['skitour', 'sled', 'hike', 'other'],
};

/** Lines coloured by the official difficulty; hidden when runs are coloured by steepness. */
export const DIFFICULTY_LINE_LAYERS: readonly string[] = ['ski-runs-downhill', 'ski-runs-expert-center', 'ski-runs-freeride'];
export const SLOPE_LAYER = 'ski-runs-slope';

type Display = Pick<DisplayData, 'layers' | 'colorBy'>;

/** Visibility of every ski layer the filter controls (incl. the steepness layer). */
export function layerVisibility(d: Display): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  const bySlope = d.colorBy === 'slope';
  for (const [group, ids] of Object.entries(LAYER_GROUPS) as [LayerGroup, readonly string[]][]) {
    for (const id of ids) out[id] = d.layers[group] && !(bySlope && DIFFICULTY_LINE_LAYERS.includes(id));
  }
  out[SLOPE_LAYER] = d.layers.downhill && bySlope;
  return out;
}

/** Run kinds whose names stay on the map. */
export function visibleRunKinds(layers: DisplayData['layers']): string[] {
  return (Object.entries(RUN_LABEL_KINDS) as [Exclude<LayerGroup, 'lifts'>, readonly string[]][]).flatMap(([g, kinds]) => (layers[g] ? [...kinds] : []));
}

/** Filter of the run label layer: its own filter, and only the visible run kinds. */
export function runLabelFilter(base: unknown, layers: DisplayData['layers']): unknown[] {
  return ['all', base ?? true, ['in', ['get', 'kind'], ['literal', visibleRunKinds(layers)]]];
}

/** Ski-area halos follow the "Show" switches of runs and lifts (null = no filter). */
export function skiAreaHaloFilter(layers: DisplayData['layers']): unknown[] | null {
  if (layers.lifts && layers.downhill) return null;
  return ['==', ['get', 'type'], layers.lifts ? 'lift' : layers.downhill ? 'run' : 'none'];
}

/** Adds the steepness layer (hidden) next to the run lines; call after every style load. */
export function addSlopeLayer(map: MlMap): void {
  if (!map.getSource('ski') || map.getLayer(SLOPE_LAYER)) return;
  const before = ['ski-runs-oneway', 'ski-lifts-casing'].find((id) => map.getLayer(id));
  const layer = runSlopeLayer(SLOPE_LAYER) as unknown as Parameters<MlMap['addLayer']>[0] & { layout: Record<string, unknown> };
  map.addLayer({ ...layer, layout: { ...layer.layout, visibility: 'none' } } as Parameters<MlMap['addLayer']>[0], before);
}

const baseFilters = new WeakMap<MlMap, { style: unknown; filter: unknown }>();

/** Writes the "Show" switches and the run colours to the map. */
export function applyLayerFilter(map: MlMap, d: Display): void {
  for (const [id, visible] of Object.entries(layerVisibility(d))) {
    if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none');
  }
  if (map.getLayer('ski-runs-label')) {
    // remember the style's own filter once per style (a new style has a new one)
    const style = map.style;
    let base = baseFilters.get(map);
    if (!base || base.style !== style) {
      base = { style, filter: map.getFilter('ski-runs-label') ?? true };
      baseFilters.set(map, base);
    }
    map.setFilter('ski-runs-label', runLabelFilter(base.filter, d.layers) as FilterSpecification);
  }
  if (map.getLayer('ski-area-halo')) map.setFilter('ski-area-halo', skiAreaHaloFilter(d.layers) as FilterSpecification | null);
}
