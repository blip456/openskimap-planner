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

export async function shot(page: Page, info: TestInfo, step: string, dir = SHOTS): Promise<void> {
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
  const resorts = JSON.parse(fs.readFileSync(path.join(ROOT, 'build/planner/resorts.json'), 'utf8')) as { id: string }[];
  const data = JSON.parse(fs.readFileSync(path.join(ROOT, `build/planner/${resorts[0].id}.json`), 'utf8')) as ResortData;
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
  const resorts = JSON.parse(fs.readFileSync(path.join(ROOT, 'build/planner/resorts.json'), 'utf8')) as { id: string }[];
  const data = JSON.parse(fs.readFileSync(path.join(ROOT, `build/planner/${resorts[0].id}.json`), 'utf8')) as ResortData;
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
  // the points are framed in the part of the map that no sheet covers
  await page.evaluate((pts) => {
    const map = (window as unknown as { __map: import('maplibre-gl').Map }).__map;
    const lons = pts.map((p) => p[0]);
    const lats = pts.map((p) => p[1]);
    map.fitBounds([[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]], {
      padding: { top: 180, bottom: 260, left: 70, right: 70 },
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
  const dir = path.join(ROOT, 'build/pwa');
  const zips = fs.readdirSync(dir).filter((n) => /-z14\.zip$/.test(n)).sort();
  if (!zips.length) throw new Error('No build/pwa/*-z14.zip. Run npm run build:pwa-data first.');
  return path.join(dir, zips[zips.length - 1]);
}
