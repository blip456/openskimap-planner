// Parity with the old planner (planner/public/app.js): its profile, gradient, step-text and distance-marker
// functions are cut out of app.js and run on real routes, and must give the same results as the new modules.
// Skips when planner/ is gone (phase 4b removes it) or when the real data is missing.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { SkiNetwork, type RouteResult } from '@core/routing/index.ts';
import type { ResortData } from '@core/types.ts';
import miniResort from '../../packages/core/test/fixtures/mini-resort.json';
import { routeGradient, routeProfilePoints, routeProfileSegments } from '../src/lib/route/profile.ts';
import { distanceMarkers, stepMeta, stepTitle } from '../src/lib/route/steps.ts';

const ROOT = path.resolve(import.meta.dirname, '../..');
const APP_JS = path.join(ROOT, 'planner/public/app.js');
const REAL = path.join(ROOT, 'build/planner/oberstdorf-kleinwalsertal.json');

/** Top-level `function name(…) {…}` or `const name = …;` from the old app.js, as source text. */
function extract(src: string, name: string): string {
  const fn = new RegExp(`^function ${name}\\(`, 'm').exec(src);
  if (fn) {
    const end = src.indexOf('\n}\n', fn.index);
    return src.slice(fn.index, end + 2);
  }
  const c = new RegExp(`^const ${name} = `, 'm').exec(src);
  if (!c) throw new Error(`${name} not found in app.js`);
  const rest = src.slice(c.index);
  const firstLine = rest.slice(0, rest.indexOf('\n'));
  const multi = /[[{]$/.test(firstLine);
  const end = multi ? rest.search(/^[\]}];\n/m) + 3 : rest.indexOf(';\n') + 2;
  return rest.slice(0, end);
}

type Legacy = {
  routeProfilePoints(r: unknown): unknown[];
  routeGradient(r: unknown): unknown;
  routeProfileSegments(r: unknown, points: unknown[], mode: string): { from: number; to: number; slope: number; step: number; color: string; key: string }[];
  stepTitle(s: unknown): string;
  stepMeta(s: unknown): string;
  distanceMarkers(c: unknown): { properties: { label: string }; geometry: { coordinates: number[] } }[];
};

function loadLegacy(): Legacy {
  const src = fs.readFileSync(APP_JS, 'utf8');
  const names = [
    'DIFFICULTY_INFO', 'LIFT_COLOR', 'WALK_COLOR', 'SLOPE_CLASSES', 'slopeClass', 'haversineM', 'routeProfilePoints', 'routeGradient',
    'officialStyle', 'routeProfileSegments', 'fmtDist', 'fmtTime', 'stepTitle', 'stepMeta', 'haversine', 'fmtMarker', 'distanceMarkers',
  ];
  const body = `${names.map((n) => extract(src, n)).join('\n')}\nreturn { routeProfilePoints, routeGradient, routeProfileSegments, stepTitle, stepMeta, distanceMarkers };`;
  return new Function(body)() as Legacy;
}

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

describe.skipIf(!fs.existsSync(APP_JS))('parity with the old planner', () => {
  const legacy = fs.existsSync(APP_JS) ? loadLegacy() : (null as unknown as Legacy);
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
});
