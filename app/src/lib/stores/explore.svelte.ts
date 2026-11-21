// Explore mode: the info card of a tapped run, lift, lift station or place, the search pin, and what is highlighted
// on the map for them (old planner: openInfoCard, closeInfoCard, setInfoHighlight, dropSearchPin, removeSearchPin,
// setHover). Details come from the routing worker (`feature(id)`); without details the card uses the tile's data.
import type { FeatureDetails } from '@core/feature-info.ts';
import type { Geometry } from '@core/types.ts';
import {
  applyPinAction,
  pinCardModel,
  placeCardModel,
  skiCardModel,
  tileCardModel,
  type InfoCardModel,
  type LngLat,
  type PinActionId,
  type PinData,
} from '../explore/info-card.ts';
import type { RouteState } from './route.svelte.ts';

/** A feature under a tap, as plain data (MapView turns the MapLibre feature into this). */
export interface PickedFeature {
  source: string;
  sourceLayer?: string;
  layerId: string;
  properties: Record<string, unknown>;
  /** the whole run/lift as far as it is loaded (all tile pieces) */
  geometry: Geometry;
}

export interface Highlight {
  /** the tapped run section / lift / place */
  section: Geometry | null;
  /** the whole named piste, drawn lighter underneath */
  piste: Geometry | null;
}

export interface ExploreDeps {
  feature: (id: string) => Promise<FeatureDetails | null>;
  route: RouteState;
  /** a card opened (show it; reveal the spot on the map) */
  onopen?: (card: InfoCardModel, geometry: Geometry | null) => void;
  /** a pin was dropped (move the map to it) */
  onpin?: (pin: PinData) => void;
  /** a "Use this spot" button changed the route */
  onused?: () => void;
}

export class ExploreState {
  card = $state.raw<InfoCardModel | null>(null);
  loading = $state(false);
  highlight = $state.raw<Highlight | null>(null);
  /** orange search pin (search result not used yet) */
  pin = $state.raw<PinData | null>(null);
  /** mouse hover over a run/lift/place (devices with hover only) */
  hover = $state.raw<Geometry | null>(null);
  /** ski area emphasised from the legend (hover or tap) */
  skiArea = $state<string | null>(null);
  private seq = 0;
  private readonly deps: ExploreDeps;

  constructor(deps: ExploreDeps) {
    this.deps = deps;
  }

  get open(): boolean {
    return this.card !== null;
  }

  /** Tap on a feature in explore mode. */
  async openFeature(f: PickedFeature, at: LngLat): Promise<void> {
    const seq = ++this.seq;
    this.pin = null;
    const props = f.properties as Record<string, any>;
    this.highlight = { section: f.geometry, piste: null };
    if (f.source !== 'ski' || !props.id) {
      this.loading = false;
      this.show(placeCardModel(props, at), f.geometry);
      return;
    }
    // show the tile's data at once, then the details from the worker
    this.loading = true;
    this.show(tileCardModel(props, at), f.geometry);
    let details: FeatureDetails | null = null;
    try {
      details = await this.deps.feature(String(props.id));
    } catch {
      details = null;
    }
    if (seq !== this.seq) return;
    this.loading = false;
    if (!details) return;
    this.highlight = { section: details.geometry, piste: details.piste?.geometry ?? null };
    this.card = skiCardModel(details, at);
  }

  private show(card: InfoCardModel, geometry: Geometry | null): void {
    this.card = card;
    this.deps.onopen?.(card, geometry);
  }

  /** A picked search result: orange pin + its card. */
  openPin(pin: PinData): void {
    ++this.seq;
    this.loading = false;
    this.pin = pin;
    this.highlight = null;
    this.card = pinCardModel(pin);
    this.deps.onpin?.(pin);
  }

  close(): void {
    ++this.seq;
    this.card = null;
    this.loading = false;
    this.highlight = null;
    this.pin = null;
  }

  /** "Use this spot in your route". */
  use(action: PinActionId): void {
    const card = this.card;
    if (!card) return;
    const route = this.deps.route;
    if (!route.setPoints(applyPinAction(route.points, action, card.position))) return;
    this.close();
    this.deps.onused?.();
  }
}
