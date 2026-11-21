// "Start from my location" (plan §7): checks the GPS position and the nearest run/lift/station (worker `nearest`)
// against simple limits, and puts the snapped point in front of the route. Pure functions, unit-tested.
import { haversine } from '@core/geo.ts';
import { SNAP_DISTANCE } from '@core/routing/graph.ts';
import type { NearestHit } from '../worker/engine.ts';

export type LngLat = [number, number];

/**
 * Limits (docs/agents/decisions.md, phase 6):
 * - `maxAccuracy` 100 m: a worse GPS fix could put the start on the wrong run (runs are often 50–100 m apart).
 * - `maxDistance` 400 m: the router's own limit for a route point (`SNAP_DISTANCE`); farther away you are not in the
 *   ski area, and a route from there would fail anyway.
 * - `near` 75 m: up to here the start is "at" the run; farther it is still set, with a note (the router also warns
 *   from 75 m on).
 * - `maxAge` 30 s: an older fix is not used; the app waits for a new one (the dot also turns grey after 30 s).
 * - `merge` 30 m: when the current start is this close to the new one, it is replaced instead of adding a point.
 */
export const START_LIMITS = { maxAccuracy: 100, maxDistance: SNAP_DISTANCE, near: 75, maxAge: 30_000, merge: 30 } as const;

export interface Fix {
  lon: number;
  lat: number;
  /** m (radius, 68 % as the browser reports it) */
  accuracy: number;
  /** ms (Date.now() clock) */
  time: number;
  /** degrees from north, when the GPS reports a course (moving) */
  course?: number | null;
}

export type StartCheck =
  | { ok: true; point: LngLat; far: boolean; name: string | null; distance: number }
  | { ok: false; reason: 'accuracy' | 'too-far' | 'no-network'; message: string };

const km = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(m >= 10_000 ? 0 : 1)} km` : `${Math.round(m)} m`);

/** Is the position good enough and close enough to the runs to start a route there? */
export function checkStart(fix: Pick<Fix, 'accuracy'>, hit: NearestHit | null, limits = START_LIMITS): StartCheck {
  if (!hit) return { ok: false, reason: 'no-network', message: 'There are no runs or lifts in the map data.' };
  if (hit.distance > limits.maxDistance) {
    return {
      ok: false,
      reason: 'too-far',
      message: `You are ${km(hit.distance)} from the nearest run or lift. Start from my location works in the ski area.`,
    };
  }
  if (fix.accuracy > limits.maxAccuracy) {
    return {
      ok: false,
      reason: 'accuracy',
      message: `Your location is not exact enough (± ${Math.round(fix.accuracy)} m). Wait a moment, best outside, and try again.`,
    };
  }
  return { ok: true, point: [hit.position[0], hit.position[1]], far: hit.distance > limits.near, name: hit.names[0] ?? null, distance: hit.distance };
}

/** Toast after the start was set (spec §6). */
export function startMessage(check: Extract<StartCheck, { ok: true }>): string {
  if (check.far) return 'You are far from the runs. Start set at the nearest lift or run.';
  return check.name ? `Start set at ${check.name}` : 'Start set at your location';
}

/**
 * The new start goes in front of the route (decision, phase 6): no points → it is A; with points → it becomes the
 * new A and the old points follow (a single old point becomes the destination). When the old start is within
 * `merge` metres of the new one, the old start is replaced instead (no double point).
 */
export function insertStart(points: readonly LngLat[], p: LngLat, merge: number = START_LIMITS.merge): LngLat[] {
  const start: LngLat = [p[0], p[1]];
  if (!points.length) return [start];
  const rest = points.map((q) => [q[0], q[1]] as LngLat);
  if (haversine(points[0], p) <= merge) return [start, ...rest.slice(1)];
  return [start, ...rest];
}

/** A fix is fresh enough to be used for the start. */
export const isFresh = (fix: Fix | null, now: number, maxAge: number = START_LIMITS.maxAge): fix is Fix => !!fix && now - fix.time <= maxAge;
