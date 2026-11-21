// Details + computed statistics for the info card shown when clicking a run, lift or lift station.
import { haversine } from './geo.ts';
import type { Feature, Geometry, MultiLineString, Position, ResortData } from './types.ts';

export interface LineStats {
  /** m, along the slope / cable when the line has elevation, else horizontal */
  length: number;
  horizontalLength: number;
  eleStart?: number;
  eleEnd?: number;
  minEle?: number;
  maxEle?: number;
  vertical?: number;
  descent?: number;
  ascent?: number;
  avgSlope?: number;
  maxSlope?: number;
  /** [distance m, elevation m] */
  profile?: [number, number][];
  duration?: number | null;
  speed?: number;
  verticalSpeed?: number;
}

export interface FeatureDetails {
  type: 'lift' | 'run' | 'spot';
  properties: Record<string, any>;
  geometry: Geometry;
  stats: LineStats | null;
  piste?: { name: string; sections: number; length: number; difficulties: string[]; geometry: MultiLineString };
  lift?: {
    id: string;
    label: string;
    liftType: string | null;
    occupancy: number | null;
    capacity: number | null;
    direction: string | null;
    status: string | null;
  };
}

type AnyFeature = Feature<Geometry, Record<string, any>>;

const SLOPE_WINDOW = 30; // m, minimum horizontal distance used for the steepest-section calculation
const PROFILE_POINTS = 80;

function lineStats(coords: Position[], type: string, p: { duration?: number | null }): LineStats {
  let c = coords;
  // lifts are described bottom → top
  if (type === 'lift' && (c[0][2] ?? 0) > (c[c.length - 1][2] ?? 0)) c = [...c].reverse();

  const dist = [0];
  for (let i = 1; i < c.length; i++) dist.push(dist[i - 1] + haversine(c[i - 1], c[i]));
  const hasEle = c.every((x) => x[2] != null);
  const length = dist[dist.length - 1];

  const stats: LineStats = { length, horizontalLength: length };
  if (hasEle) {
    const ele = c.map((x) => x[2] as number);
    // distance along the slope / cable, like OpenSkiMap shows
    let inclined = 0;
    for (let i = 1; i < c.length; i++) inclined += Math.hypot(dist[i] - dist[i - 1], ele[i] - ele[i - 1]);
    stats.length = inclined;
    const minEle = Math.min(...ele);
    const maxEle = Math.max(...ele);
    Object.assign(stats, { eleStart: ele[0], eleEnd: ele[ele.length - 1], minEle, maxEle, vertical: maxEle - minEle });

    let descent = 0;
    let ascent = 0;
    for (let i = 1; i < ele.length; i++) {
      const dz = ele[i] - ele[i - 1];
      if (dz < 0) descent -= dz;
      else ascent += dz;
    }
    stats.descent = descent;
    stats.ascent = ascent;

    const net = Math.abs(ele[ele.length - 1] - ele[0]);
    stats.avgSlope = length > 0 ? net / length : 0; // rise over horizontal run

    let maxSlope = 0;
    let j = 0;
    for (let i = 0; i < c.length; i++) {
      while (j < c.length && dist[j] - dist[i] < SLOPE_WINDOW) j++;
      if (j >= c.length) break;
      maxSlope = Math.max(maxSlope, Math.abs(ele[j] - ele[i]) / (dist[j] - dist[i]));
    }
    if (length >= SLOPE_WINDOW) stats.maxSlope = maxSlope;

    // evenly spaced elevation profile for the sparkline
    const profile: [number, number][] = [];
    let k = 0;
    for (let s = 0; s <= PROFILE_POINTS; s++) {
      const d = (length * s) / PROFILE_POINTS;
      while (k < dist.length - 2 && dist[k + 1] < d) k++;
      const span = dist[k + 1] - dist[k] || 1;
      const t = Math.min(1, Math.max(0, (d - dist[k]) / span));
      profile.push([Math.round(d), Math.round((ele[k] + (ele[k + 1] - ele[k]) * t) * 10) / 10]);
    }
    stats.profile = profile;
  }

  if (type === 'lift') {
    stats.duration = p.duration ?? null;
    if (p.duration) {
      stats.speed = stats.length / p.duration;
      if (stats.vertical != null) stats.verticalSpeed = stats.vertical / (p.duration / 60);
    }
  }
  return stats;
}

export function featureDetails(
  data: Pick<ResortData, 'runs' | 'lifts' | 'runAreas' | 'spots'>,
  id: string,
): FeatureDetails | null {
  const find = (list: readonly AnyFeature[] | undefined): AnyFeature | undefined => (list ?? []).find((f) => f.properties.id === id);
  let type: FeatureDetails['type'] = 'lift';
  let f = find(data.lifts);
  if (!f) {
    type = 'run';
    f = find(data.runs) ?? find(data.runAreas);
  }
  if (!f) {
    type = 'spot';
    f = find(data.spots);
  }
  if (!f) return null;

  const details: FeatureDetails = {
    type,
    properties: f.properties,
    geometry: f.geometry,
    stats: f.geometry.type === 'LineString' ? lineStats(f.geometry.coordinates, type, f.properties) : null,
  };

  // OSM often splits one signed piste into several sections: describe the whole piste too
  // (`piste` / `pistes` are set by the build, see piste.ts)
  if (type === 'run' && f.properties.piste) {
    const primary = String(f.properties.name).split(/,\s*/)[0];
    const piste = f.properties.piste as string;
    const sections = data.runs.filter((r) => r.properties.pistes?.includes(`|${piste}|`));
    if (sections.length > 1) {
      let length = 0;
      for (const s of sections) {
        const c = s.geometry.coordinates;
        for (let i = 1; i < c.length; i++) length += haversine(c[i - 1], c[i]);
      }
      details.piste = {
        name: primary,
        sections: sections.length,
        length,
        difficulties: [...new Set(sections.map((s) => s.properties.difficulty ?? 'unknown'))],
        geometry: { type: 'MultiLineString', coordinates: sections.map((s) => s.geometry.coordinates.map((c) => [c[0], c[1]])) },
      };
    }
  }

  const liftId = f.properties.liftId;
  if (type === 'spot' && liftId) {
    const liftFeature = data.lifts.find((l) => l.properties.id === liftId);
    if (liftFeature) {
      const lp = liftFeature.properties;
      details.lift = {
        id: lp.id,
        label: lp.label,
        liftType: lp.liftType,
        occupancy: lp.occupancy ?? null,
        capacity: lp.capacity ?? null,
        direction: lp.direction ?? null,
        status: lp.status ?? null,
      };
      details.geometry = liftFeature.geometry;
      details.stats = lineStats(liftFeature.geometry.coordinates, 'lift', lp);
    }
  }
  return details;
}
