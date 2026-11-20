// Data model shared by the data build, the routing worker and the app.
// The resort file (`build/planner/<resort>.json`) is written by scripts/build.mjs.

/** [lon, lat] or [lon, lat, elevation in m]. */
export type Position = [lon: number, lat: number, ele?: number];
/** [minLon, minLat, maxLon, maxLat] */
export type Bbox = [number, number, number, number];

export interface LineString {
  type: 'LineString';
  coordinates: Position[];
}
export interface Polygon {
  type: 'Polygon';
  coordinates: Position[][];
}
export interface MultiLineString {
  type: 'MultiLineString';
  coordinates: Position[][];
}
export interface Point {
  type: 'Point';
  coordinates: Position;
}
export type Geometry = LineString | Polygon | MultiLineString | Point;

export interface Feature<G extends Geometry = Geometry, P = Record<string, unknown>> {
  type: 'Feature';
  geometry: G;
  properties: P;
}
export interface FeatureCollection<G extends Geometry = Geometry, P = Record<string, unknown>> {
  type: 'FeatureCollection';
  features: Feature<G, P>[];
}

export type Difficulty = 'novice' | 'easy' | 'intermediate' | 'advanced' | 'expert' | 'freeride' | 'extreme' | 'unknown';
export type RunKind = 'downhill' | 'connection' | 'nordic' | 'skitour' | 'sled' | 'hike' | 'other';
export type LiftClass = 'drag' | 'rail' | 'aerial';
export type LiftDirection = 'up' | 'both' | 'unknown';

export interface SkiAreaRef {
  id: string;
  name: string | null;
}

/** Properties every run, lift and spot has. */
export interface BaseProps {
  id: string;
  name: string | null;
  ref: string | null;
  status: string | null;
  skiAreaIds?: string[];
  skiAreas?: SkiAreaRef[];
  place?: { country: string | null; region: string | null; locality: string | null };
  sources?: { type: string; id: string }[];
  websites?: string[];
  wikidataID?: string | null;
  description?: string | null;
  label: string;
}

export interface RunProps extends BaseProps {
  uses?: string[];
  kind: RunKind;
  difficulty: Difficulty | null;
  color: string;
  oneway: boolean | null;
  grooming?: string | null;
  lit?: boolean | null;
  gladed?: boolean | null;
  patrolled?: boolean | null;
  snowmaking?: boolean | null;
  /** id of the piste this section belongs to (only when the piste has several sections) */
  piste?: string;
  /** "|id|id|": every piste the section belongs to */
  pistes?: string;
}

export interface LiftStation {
  coordinates?: Position;
  name: string | null;
  position: string | null;
  entry: boolean | null;
  exit: boolean | null;
}

export interface LiftProps extends BaseProps {
  liftType: string | null;
  liftClass?: LiftClass;
  direction?: LiftDirection;
  oneway: boolean | null;
  duration: number | null;
  capacity?: number | null;
  occupancy?: number | null;
  bubble?: boolean | null;
  heating?: boolean | null;
  detachable?: boolean | null;
  access?: string | null;
  stations?: LiftStation[];
}

export interface SpotProps extends BaseProps {
  spotType: string | null;
  position: string | null;
  liftId: string | null;
  entry: boolean | null;
  exit: boolean | null;
}

export type Run = Feature<LineString, RunProps>;
export type RunArea = Feature<Polygon, RunProps>;
export type Lift = Feature<LineString, LiftProps>;
export type Spot = Feature<Point, SpotProps>;

/** Named place from the basemap (village, peak, hut, …) for the search. */
export interface Place {
  name: string;
  kind: string;
  coordinates: Position;
  elevation?: number | null;
}

/** One resort file: build/planner/<resort>.json */
export interface ResortData {
  id?: string;
  name: string;
  bbox?: Bbox;
  builtAt?: string;
  source?: unknown;
  runs: Run[];
  runAreas?: RunArea[];
  lifts: Lift[];
  spots?: Spot[];
  places?: Place[];
}

/** Entry of build/planner/resorts.json */
export interface ResortInfo {
  id: string;
  name: string;
  bbox: Bbox;
  center: [number, number];
}
