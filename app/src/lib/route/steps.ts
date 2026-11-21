// Texts for route steps and legs, and the distance markers along the route (old planner: stepTitle, stepMeta,
// the leg summary line and distanceMarkers).
import { haversine } from '@core/geo.ts';
import { DIFFICULTY_INFO } from '@core/search.ts';
import type { RouteStep, RouteSummary } from '@core/routing/index.ts';
import { formatDistance, formatDuration } from '../format.ts';
import { DIFFICULTY_SHORT } from './profile.ts';

type StepText = Pick<RouteStep, 'type' | 'label' | 'down' | 'runKind' | 'difficulty' | 'liftType' | 'distance' | 'eleStart' | 'eleEnd' | 'duration'>;

export function stepTitle(s: Pick<StepText, 'type' | 'label' | 'down' | 'runKind'>): string {
  if (s.type === 'lift') return `${s.down ? 'Ride down' : 'Take'} ${s.label}`;
  if (s.type === 'walk') return 'Walk';
  if (s.runKind === 'connection') return `Follow ${s.label === 'Unnamed run' ? 'the ski path' : s.label}`;
  if (s.runKind === 'connector') return 'Short connection';
  return `Ski ${s.label}`;
}

export function stepMeta(s: StepText): string {
  const parts: string[] = [];
  if (s.type === 'run' && s.runKind === 'downhill') parts.push(DIFFICULTY_INFO[s.difficulty ?? '']?.label ?? String(s.difficulty));
  if (s.type === 'lift') parts.push(String(s.liftType ?? 'lift').replaceAll('_', ' '));
  parts.push(formatDistance(s.distance));
  const dz = Math.round(s.eleEnd - s.eleStart);
  if (Math.abs(dz) >= 5) parts.push(`${dz > 0 ? '↑' : '↓'} ${Math.abs(dz)} m`);
  parts.push(`${Math.round(s.eleStart)} → ${Math.round(s.eleEnd)} m`);
  parts.push(`~${formatDuration(s.duration)}`);
  return parts.join(' · ');
}

/** "~18 min · 3.2 km · 1 lift · ↓ 610 m" */
export function legMeta(s: Pick<RouteSummary, 'duration' | 'distance' | 'liftCount' | 'descent'>): string {
  return [
    `~${formatDuration(s.duration)}`,
    formatDistance(s.distance),
    `${s.liftCount} lift${s.liftCount === 1 ? '' : 's'}`,
    ...(s.descent >= 5 ? [`↓ ${Math.round(s.descent)} m`] : []),
  ].join(' · ');
}

/** What kind of step it is, for the chart readout: "Black run", "Lift", "Ski path", "Walk". */
export function stepKind(s: Pick<StepText, 'type' | 'runKind' | 'difficulty' | 'down'>): string {
  if (s.type === 'lift') return s.down ? 'Lift (down)' : 'Lift';
  if (s.type === 'walk') return 'Walk';
  if (s.runKind === 'downhill') return `${DIFFICULTY_SHORT[s.difficulty ?? 'unknown'] ?? 'Unknown'} run`;
  if (s.runKind === 'connector') return 'Short connection';
  return 'Ski path';
}

/** Icon of a step row (spec §2.18): run number tile, lift up/down, footprints for walks and ski paths. */
export type StepIcon = 'number' | 'lift-up' | 'lift-down' | 'walk';
export function stepIcon(s: Pick<StepText, 'type' | 'runKind' | 'down'>): StepIcon {
  if (s.type === 'lift') return s.down ? 'lift-down' : 'lift-up';
  if (s.type === 'walk' || s.runKind !== 'downhill') return 'walk';
  return 'number';
}

export const markerLabel = (m: number): string => (m < 1000 ? `${m} m` : `${(m / 1000).toFixed(m % 1000 === 0 ? 0 : 1)} km`);

export interface DistanceMarker {
  label: string;
  coordinates: [number, number];
}

/** Points every N metres along the whole route, N chosen so there are at most ~12 markers. */
export function distanceMarkers(coords: readonly (readonly [number, number, number?])[]): DistanceMarker[] {
  const dist = (a: readonly [number, number, number?], b: readonly [number, number, number?]) => haversine([a[0], a[1]], [b[0], b[1]]);
  let total = 0;
  for (let i = 1; i < coords.length; i++) total += dist(coords[i - 1], coords[i]);
  const step = [100, 250, 500, 1000, 2000, 5000].find((s) => total / s <= 12) ?? 10000;
  const out: DistanceMarker[] = [];
  let travelled = 0;
  let next = step;
  for (let i = 1; i < coords.length && next < total; i++) {
    const a = coords[i - 1];
    const b = coords[i];
    const d = dist(a, b);
    while (d > 0 && travelled + d >= next && next < total) {
      const t = (next - travelled) / d;
      out.push({ label: markerLabel(next), coordinates: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t] });
      next += step;
    }
    travelled += d;
  }
  return out;
}
