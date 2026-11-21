// Parity with the old planner frontend: its profile, gradient, step-text, distance-marker, lift-row and pin-action
// functions (frozen in packages/core/test/reference/app-route.legacy.mjs when planner/ was removed) run on real
// routes and lifts, and must give the same results as the new modules. Uses the real data when it exists.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { SkiNetwork, type RouteResult } from '@core/routing/index.ts';
import { featureDetails } from '@core/feature-info.ts';
import type { ResortData } from '@core/types.ts';
import miniResort from '../../packages/core/test/fixtures/mini-resort.json';
import { routeGradient, routeProfilePoints, routeProfileSegments } from '../src/lib/route/profile.ts';
import { distanceMarkers, stepMeta, stepTitle } from '../src/lib/route/steps.ts';
import { applyPinAction, crumbsFor, liftRows, pinActions } from '../src/lib/explore/info-card.ts';
// @ts-expect-error plain JavaScript reference copy without types
import * as legacyModule from '../../packages/core/test/reference/app-route.legacy.mjs';

const ROOT = path.resolve(import.meta.dirname, '../..');
const REAL = path.join(ROOT, 'build/planner/oberstdorf-kleinwalsertal.json');

type LngLat = [number, number];
type Legacy = {
  routeProfilePoints(r: unknown): unknown[];
  routeGradient(r: unknown): unknown;
  routeProfileSegments(r: unknown, points: unknown[], mode: string): { from: number; to: number; slope: number; step: number; color: string; key: string }[];
  stepTitle(s: unknown): string;
  stepMeta(s: unknown): string;
  distanceMarkers(c: unknown): { properties: { label: string }; geometry: { coordinates: number[] } }[];
  liftRows(lp: unknown, st: unknown): [string, string | null][];
  crumbsFor(pr: unknown): string[];
  pinActions(p: LngLat, after?: () => void): [string, () => void, boolean?][];
  withState(s: { points: LngLat[] }): void;
};
const legacy = legacyModule as unknown as Legacy;

function routes(): RouteResult[] {
  const out: RouteResult[] = [];
  const add = (data: ResortData, pairs: [number, number][][]) => {
    const net = new SkiNetwork(data);
    for (const pts of pairs) {
      try {
        out.push(net.route(pts));
      } catch {
        // no route between these points
      }
    }
  };
  add(miniResort as unknown as ResortData, [[[10, 47.01], [10.0003, 47.0003]]]);
  if (fs.existsSync(REAL)) {
    const data = JSON.parse(fs.readFileSync(REAL, 'utf8')) as ResortData;
    // lift top → lift bottom of the first 25 gondolas/chairlifts, and some 3-point routes
    const lifts = data.lifts.filter((l) => ['gondola', 'chair_lift'].includes(String(l.properties.liftType))).slice(0, 25);
    const ends = lifts.map((l) => {
      const c = l.geometry.coordinates;
      return { top: [c[c.length - 1][0], c[c.length - 1][1]] as [number, number], bottom: [c[0][0], c[0][1]] as [number, number] };
    });
    add(data, ends.map((e) => [e.top, e.bottom]));
    add(data, ends.slice(0, 10).map((e, i) => [e.top, ends[(i + 1) % 10].bottom, e.bottom]));
  }
  return out;
}

describe('parity with the old planner', () => {
  const all = routes();

  test('enough real routes to compare', () => {
    expect(all.length).toBeGreaterThanOrEqual(fs.existsSync(REAL) ? 20 : 1);
  });

  test('profile points, gradient and segments (both colour modes) are the same', () => {
    for (const r of all) {
      const points = routeProfilePoints(r);
      expect(points).toEqual(legacy.routeProfilePoints(r));
      const g = routeGradient(r, points);
      expect(g).toEqual(legacy.routeGradient(r));
      for (const mode of ['official', 'steepness'] as const) {
        const ours = routeProfileSegments(r, points, mode).map(({ from, to, slope, step, color, key }) => ({ from, to, slope, step, color, key }));
        const old = legacy.routeProfileSegments(r, points, mode).map(({ from, to, slope, step, color, key }) => ({ from, to, slope, step, color, key }));
        expect(ours).toEqual(old);
      }
    }
  });

  test('step titles and meta lines are the same', () => {
    for (const r of all) {
      for (const s of r.steps) {
        expect(stepTitle(s)).toBe(legacy.stepTitle(s));
        expect(stepMeta(s)).toBe(legacy.stepMeta(s));
      }
    }
  });

  test('distance markers are the same', () => {
    for (const r of all) {
      const coords = r.coordinates.map((c) => [c[0], c[1]] as [number, number]);
      const old = legacy.distanceMarkers(coords).map((f) => ({ label: f.properties.label, coordinates: f.geometry.coordinates }));
      expect(distanceMarkers(coords)).toEqual(old);
    }
  });

  test('info card: lift rows and crumbs are the same', () => {
    const data = (fs.existsSync(REAL) ? JSON.parse(fs.readFileSync(REAL, 'utf8')) : miniResort) as ResortData;
    let n = 0;
    for (const l of data.lifts.slice(0, 40)) {
      const d = featureDetails(data, String(l.properties.id));
      if (!d) continue;
      const old = legacy.liftRows(d.properties, d.stats ?? {}).filter(([, v]) => v != null && v !== '').map(([label, value]) => ({ label, value }));
      expect(liftRows(d.properties, d.stats ?? {})).toEqual(old);
      expect(crumbsFor(d.properties)).toEqual(legacy.crumbsFor(d.properties));
      n++;
    }
    expect(n).toBeGreaterThan(0);
  });

  test('"Use this spot" actions: same labels, same main action, same resulting points', () => {
    const p: LngLat = [9, 9];
    const starts: LngLat[][] = [[], [[1, 1]], [[1, 1], [2, 2]], [[1, 1], [2, 2], [3, 3]]];
    for (const pts of starts) {
      const ours = pinActions(pts.length);
      legacy.withState({ points: pts.map((x) => [...x] as LngLat) });
      const old = legacy.pinActions(p);
      expect(ours.map((a) => [a.label, a.primary])).toEqual(old.map(([label, , primary]) => [label, !!primary]));
      ours.forEach((a, i) => {
        const state = { points: pts.map((x) => [...x] as LngLat) };
        legacy.withState(state);
        legacy.pinActions(p)[i][1]();
        expect(applyPinAction(pts, a.id, p)).toEqual(state.points);
      });
    }
  });
});
