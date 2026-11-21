// Helpers for the smoke tests.
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { expect, type Page, type TestInfo } from '@playwright/test';
import { SkiNetwork } from '../../packages/core/src/routing/index.ts';
import type { ResortData } from '../../packages/core/src/types.ts';

export const ROOT = path.resolve(import.meta.dirname, '../..');
export const SHOTS = path.join(ROOT, 'docs/agents/screenshots/phase3');

type LngLat = [number, number];

/** Console errors and page errors; the tests expect none. */
export function collectErrors(page: Page): { errors: string[]; infos: string[] } {
  const out = { errors: [] as string[], infos: [] as string[] };
  page.on('console', (m) => {
    if (m.type() === 'error') out.errors.push(m.text());
    if (m.type() === 'info') out.infos.push(m.text());
  });
  page.on('pageerror', (e) => out.errors.push(e.message));
  return out;
}

/** Screenshots of the current phase are always written. Older phases are a record of how the app looked then:
 * they are only rewritten with E2E_ALL_SHOTS=1 (saves time and keeps git quiet). */
export const CURRENT_SHOTS = 'phase7';

export async function shot(page: Page, info: TestInfo, step: string, dir = SHOTS): Promise<void> {
  if (path.basename(dir) !== CURRENT_SHOTS && !process.env.E2E_ALL_SHOTS) return;
  fs.mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: path.join(dir, `${info.project.name}-${step}.png`) });
}

export async function waitForMap(page: Page, timeout = 60_000): Promise<void> {
  await expect(page.locator('[data-testid=map][data-style-ready=true]')).toBeVisible({ timeout });
  await expect(page.locator('[data-testid=map][data-idle=true]')).toBeAttached({ timeout });
}

/** Waits until camera animations are over and every tile is loaded. */
export async function waitForMapStill(page: Page): Promise<void> {
  await page.waitForTimeout(300); // let a fitBounds that was just triggered start
  await page.waitForFunction(() => {
    const map = (window as unknown as { __map?: import('maplibre-gl').Map }).__map;
    return !!map && !map.isMoving() && map.loaded() && map.areTilesLoaded();
  });
}

/** The map canvas shows a real picture: many colours and enough contrast, not one flat colour. */
export async function expectMapNotBlank(page: Page): Promise<void> {
  const png = await page.locator('[data-testid=map] canvas').screenshot();
  const stats = await sharp(png).stats();
  const spread = Math.max(...stats.channels.slice(0, 3).map((c) => c.stdev));
  expect(spread, 'map canvas looks blank').toBeGreaterThan(10);
}

/** A lift top → bottom pair that has a real ski route (computed with the core on the real data). */
export function routePoints(): [LngLat, LngLat] {
  const resorts = JSON.parse(fs.readFileSync(path.join(ROOT, 'build/regions/default/planner/resorts.json'), 'utf8')) as { id: string }[];
  const data = JSON.parse(fs.readFileSync(path.join(ROOT, `build/regions/default/planner/${resorts[0].id}.json`), 'utf8')) as ResortData;
  const net = new SkiNetwork(data);
  for (const lift of data.lifts) {
    if (!['gondola', 'chair_lift'].includes(String(lift.properties.liftType))) continue;
    const c = lift.geometry.coordinates;
    const top: LngLat = [c[c.length - 1][0], c[c.length - 1][1]];
    const bottom: LngLat = [c[0][0], c[0][1]];
    try {
      const r = net.route([top, bottom]);
      if (r.steps.some((s) => s.type === 'run') && r.summary.distance > 1500) return [top, bottom];
    } catch {
      // try the next lift
    }
  }
  throw new Error('No usable lift found in the real data');
}

/** Three points on a real route: a lift top, a point in the middle of the run down, the lift bottom. */
export function threePoints(): [LngLat, LngLat, LngLat] {
  const [top, bottom] = routePoints();
  const resorts = JSON.parse(fs.readFileSync(path.join(ROOT, 'build/regions/default/planner/resorts.json'), 'utf8')) as { id: string }[];
  const data = JSON.parse(fs.readFileSync(path.join(ROOT, `build/regions/default/planner/${resorts[0].id}.json`), 'utf8')) as ResortData;
  const r = new SkiNetwork(data).route([top, bottom]);
  const mid = r.coordinates[Math.floor(r.coordinates.length / 2)];
  return [top, [mid[0], mid[1]], bottom];
}

/** Screen position of a map coordinate. */
export async function project(page: Page, p: LngLat): Promise<{ x: number; y: number }> {
  return page.evaluate((pt) => {
    const q = (window as unknown as { __map: import('maplibre-gl').Map }).__map.project(pt);
    return { x: q.x, y: q.y };
  }, p);
}

/** A finger drag (Chromium touch events through CDP: real pointer events with pointerType "touch"). */
export async function touchDrag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }, opts: { steps?: number; holdMs?: number } = {}): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  const steps = opts.steps ?? 12;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: from.x, y: from.y }] });
  if (opts.holdMs) await page.waitForTimeout(opts.holdMs);
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t }] });
    await page.waitForTimeout(16);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
}

/** A mouse drag with the left button. */
export async function mouseDrag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }, steps = 12): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps });
  await page.mouse.up();
}

/** Frames both points in the middle of the map and taps/clicks them (plan mode must be on). */
export async function addPoints(page: Page, points: LngLat[], touch: boolean): Promise<void> {
  // the points are framed in the part of the map that no sheet (or the desktop panel) covers
  await page.evaluate((pts) => {
    const map = (window as unknown as { __map: import('maplibre-gl').Map }).__map;
    const lons = pts.map((p) => p[0]);
    const lats = pts.map((p) => p[1]);
    const wide = innerWidth >= 900;
    map.setPadding({ top: 0, bottom: 0, left: 0, right: 0 });
    map.fitBounds([[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]], {
      padding: wide ? { top: 120, bottom: 80, left: 470, right: 120 } : { top: 180, bottom: 260, left: 70, right: 70 },
      animate: false,
    });
  }, points);
  await waitForMap(page);
  for (const p of points) {
    const xy = await page.evaluate((pt) => (window as unknown as { __map: import('maplibre-gl').Map }).__map.project(pt), p);
    if (touch) await page.touchscreen.tap(xy.x, xy.y);
    else await page.mouse.click(xy.x, xy.y);
    await page.waitForTimeout(150);
  }
}

export function newestZip(): string {
  const dir = path.join(ROOT, 'build/pwa-map-data');
  const zips = fs.readdirSync(dir).filter((n) => /-z14\.zip$/.test(n)).sort();
  if (!zips.length) throw new Error('No build/pwa-map-data/*-z14.zip. Run npm run build:pwa-map-data first.');
  return path.join(dir, zips[zips.length - 1]);
}

function realData(): ResortData {
  const resorts = JSON.parse(fs.readFileSync(path.join(ROOT, 'build/regions/default/planner/resorts.json'), 'utf8')) as { id: string }[];
  return JSON.parse(fs.readFileSync(path.join(ROOT, `build/regions/default/planner/${resorts[0].id}.json`), 'utf8')) as ResortData;
}

const metres = (a: readonly (number | undefined)[], b: readonly (number | undefined)[]) => {
  const [ax = 0, ay = 0] = a;
  const [bx = 0, by = 0] = b;
  const k = Math.PI / 180;
  const x = (bx - ax) * k * Math.cos(((ay + by) / 2) * k);
  const y = (by - ay) * k;
  return Math.hypot(x, y) * 6371000;
};

/**
 * Targets for the explore tests, from the real data: the middle of a long named downhill run that is far from
 * every lift and other run (so a tap there can only hit that run), and a lift with a unique name.
 */
export function exploreTargets(): { run: { name: string; at: LngLat }; lift: { name: string; bottom: LngLat } } {
  const data = realData();
  const liftPts = data.lifts.flatMap((l) => l.geometry.coordinates);
  const runs = data.runs.filter((r) => r.properties.kind === 'downhill' && r.properties.name && r.geometry.type === 'LineString');
  let run: { name: string; at: LngLat } | null = null;
  for (const r of runs) {
    const c = r.geometry.coordinates;
    if (c.length < 6) continue;
    const mid = c[Math.floor(c.length / 2)];
    if (liftPts.some((p) => metres(p, mid) < 150)) continue;
    const others = data.runs.filter((o) => o !== r && o.properties.name !== r.properties.name);
    if (others.some((o) => o.geometry.coordinates.some((p) => metres(p, mid) < 60))) continue;
    run = { name: String(r.properties.name), at: [mid[0], mid[1]] };
    break;
  }
  if (!run) throw new Error('No lonely run found in the real data');
  const names = data.lifts.map((l) => String(l.properties.name ?? ''));
  const lift = data.lifts.find((l) => {
    const n = String(l.properties.name ?? '');
    return n.length > 6 && names.filter((x) => x === n).length === 1 && !data.runs.some((r) => r.properties.name === n) && ['gondola', 'chair_lift'].includes(String(l.properties.liftType));
  });
  if (!lift) throw new Error('No lift with a unique name in the real data');
  const c = lift.geometry.coordinates;
  return { run, lift: { name: String(lift.properties.name), bottom: [c[0][0], c[0][1]] } };
}
