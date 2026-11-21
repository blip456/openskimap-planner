// Phase 6: my location (blue dot, accuracy circle), the Locate button states, follow + pan, heading cone and map
// rotation with fake compass events, Start from my location (near, too far, not exact), the denied state, touch
// (no page zoom, map pinch + rotate) and Keep screen on. Both builds, iPhone size (touch) and wide (mouse).
// Screenshots: docs/agents/screenshots/phase6/.
import path from 'node:path';
import { expect, test, type BrowserContext, type Page, type TestInfo } from '@playwright/test';
import { ROOT, collectErrors, exploreTargets, mouseDrag, newestZip, shot, touchDrag, waitForMap, waitForMapStill } from './common.ts';

const SHOTS = path.join(ROOT, 'docs/agents/screenshots/phase6');
type LngLat = [number, number];
type MapHook = import('maplibre-gl').Map;
interface AppHook {
  route: { points: LngLat[]; clear(): void };
  location: { mode: string; fix: { lat: number; lon: number } | null; heading: number | null };
  settings: { keepAwake: boolean };
}

const isWide = (page: Page) => (page.viewportSize()?.width ?? 0) >= 900;

async function openApp(page: Page, info: TestInfo): Promise<void> {
  await page.goto('/?e2e');
  if (info.project.name.startsWith('pwa')) {
    await expect(page.getByTestId('no-data')).toBeVisible();
    await page.getByTestId('import-input').setInputFiles(newestZip());
  }
  await waitForMap(page, 120_000);
  await page.waitForFunction(() => (window as unknown as { __app: { routingReady: boolean } }).__app.routingReady);
}

async function tap(page: Page, testid: string, touch: boolean): Promise<void> {
  const el = page.getByTestId(testid);
  if (touch) await el.tap();
  else await el.click();
}

/** Moves the fake GPS and waits until the app has the new position. */
async function moveTo(context: BrowserContext, page: Page, p: LngLat, accuracy = 15): Promise<void> {
  await context.setGeolocation({ latitude: p[1], longitude: p[0], accuracy });
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __app: AppHook }).__app.location.fix))
    .toMatchObject({ lat: p[1], lon: p[0] });
}

const metres = (a: LngLat, b: LngLat) => {
  const k = Math.PI / 180;
  return Math.hypot((b[0] - a[0]) * k * Math.cos(((a[1] + b[1]) / 2) * k), (b[1] - a[1]) * k) * 6371000;
};
const mapCentre = (page: Page) =>
  page.evaluate(() => {
    const c = (window as unknown as { __map: MapHook }).__map.getCenter();
    return [c.lng, c.lat] as LngLat;
  });
const bearing = (page: Page) => page.evaluate(() => (window as unknown as { __map: MapHook }).__map.getBearing());
const rendered = (page: Page, layer: string) =>
  page.evaluate((l) => (window as unknown as { __map: MapHook }).__map.queryRenderedFeatures({ layers: [l] }).length, layer);
const points = (page: Page) => page.evaluate(() => (window as unknown as { __app: AppHook }).__app.route.points.length);

/** Fake compass events as iOS sends them (webkitCompassHeading), several in a row so the smoothing settles. */
async function compass(page: Page, heading: number, count = 14): Promise<number[]> {
  return page.evaluate(
    async ({ heading, count }) => {
      const seen: number[] = [];
      for (let i = 0; i < count; i++) {
        const e = new Event('deviceorientation');
        Object.defineProperty(e, 'alpha', { value: 0 });
        Object.defineProperty(e, 'webkitCompassHeading', { value: heading });
        Object.defineProperty(e, 'webkitCompassAccuracy', { value: 10 });
        dispatchEvent(e);
        await new Promise((r) => setTimeout(r, 120));
        seen.push((window as unknown as { __map: MapHook }).__map.getBearing());
      }
      return seen;
    },
    { heading, count },
  );
}

/** Route tab: the sheet on the phone (at medium), the panel on the desktop. */
async function openRoute(page: Page, touch: boolean): Promise<void> {
  if (isWide(page)) {
    await tap(page, 'tab-route', touch);
    return;
  }
  if ((await page.getByTestId('tab-route').getAttribute('aria-current')) !== 'true') await tap(page, 'tab-route', touch);
  await expect(page.getByTestId('sheet')).toBeVisible();
}

test('my location: dot, locate states, follow, heading, start from my location', async ({ page, context, isMobile }, info) => {
  const touch = isMobile;
  const log = collectErrors(page);
  // iOS has DeviceOrientationEvent.requestPermission; Chromium does not. Add it so the tap path is the iPhone one.
  await page.addInitScript(() => {
    const w = window as unknown as { __compassAsked: number; DeviceOrientationEvent: { requestPermission?: () => Promise<string> } };
    w.__compassAsked = 0;
    if (w.DeviceOrientationEvent) {
      w.DeviceOrientationEvent.requestPermission = async () => {
        w.__compassAsked++;
        return 'granted';
      };
    }
  });
  const { lift } = exploreTargets();
  // ~22 m north of a lift bottom station
  const here: LngLat = [lift.bottom[0], lift.bottom[1] + 0.0002];
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation({ latitude: here[1], longitude: here[0], accuracy: 15 });
  await openApp(page, info);

  // --- Show my location: centre once, blue dot + accuracy circle -------------------------------------------------
  const locate = page.getByTestId('locate-button');
  await expect(locate).toHaveAttribute('data-state', 'off');
  await expect(locate).toHaveAttribute('aria-label', 'Show my location');
  await tap(page, 'locate-button', touch);
  await expect(locate).toHaveAttribute('data-state', 'centred');
  await expect(locate).toHaveAttribute('aria-label', 'Follow my location');
  await waitForMapStill(page);
  expect(metres(await mapCentre(page), here)).toBeLessThan(5);
  expect(await page.evaluate(() => (window as unknown as { __map: MapHook }).__map.getZoom())).toBeGreaterThanOrEqual(15);
  await expect.poll(() => rendered(page, 'user-location-dot')).toBe(1);
  await expect.poll(() => rendered(page, 'user-location-accuracy')).toBe(1);
  await expect.poll(() => rendered(page, 'user-location-heading')).toBe(0); // no compass yet
  await shot(page, info, 'location-dot', SHOTS);

  // --- Follow: the map moves with the position; panning by hand stops following ----------------------------------
  await tap(page, 'locate-button', touch);
  await expect(locate).toHaveAttribute('data-state', 'follow');
  await expect(locate).toHaveAttribute('aria-pressed', 'true');
  const moved: LngLat = [here[0] + 0.0012, here[1] + 0.0006];
  await moveTo(context, page, moved);
  await expect.poll(async () => metres(await mapCentre(page), moved)).toBeLessThan(5);
  const box = (await page.getByTestId('map').boundingBox())!;
  const from = { x: box.width / 2, y: box.height * 0.3 };
  const to = { x: box.width / 2 + 80, y: box.height * 0.3 + 60 };
  if (touch) await touchDrag(page, from, to);
  else await mouseDrag(page, from, to);
  await expect(locate).toHaveAttribute('data-state', 'centred');
  await moveTo(context, page, here);
  await waitForMapStill(page);
  expect(metres(await mapCentre(page), here)).toBeGreaterThan(20); // not following any more

  // --- Follow with heading (touch devices with a compass) --------------------------------------------------------
  if (touch) {
    await tap(page, 'locate-button', touch); // follow
    await tap(page, 'locate-button', touch); // heading: asks for the compass in the tap
    await expect(locate).toHaveAttribute('data-state', 'heading');
    await expect(locate).toHaveAttribute('aria-label', 'Stop following');
    expect(await page.evaluate(() => (window as unknown as { __compassAsked: number }).__compassAsked)).toBe(1);
    await compass(page, 90);
    await expect.poll(() => bearing(page)).toBeGreaterThan(85);
    expect(await bearing(page)).toBeLessThan(95);
    await expect.poll(() => rendered(page, 'user-location-heading')).toBe(1);
    await expect(page.getByTestId('compass')).toBeVisible();
    await waitForMapStill(page);
    await shot(page, info, 'location-heading', SHOTS);
    // across north: 350 → 10 turns 20° through 0, never the long way round
    await compass(page, 350, 20);
    await expect.poll(() => bearing(page)).toBeLessThan(-5);
    const seen = await compass(page, 10, 20);
    expect(seen.every((b) => Math.abs(b) < 25), `bearings ${seen.map((b) => b.toFixed(0)).join(' ')}`).toBe(true);
    await expect.poll(() => bearing(page)).toBeGreaterThan(5);
    // the compass button: back to "follow", map points north
    await tap(page, 'compass', touch);
    await expect(locate).toHaveAttribute('data-state', 'follow');
    await expect.poll(async () => Math.abs(await bearing(page))).toBeLessThan(1);
    await tap(page, 'locate-button', touch); // heading again (no second question)
    await expect(locate).toHaveAttribute('data-state', 'heading');
    await compass(page, 45);
    await expect.poll(() => bearing(page)).toBeGreaterThan(30);
    await tap(page, 'locate-button', touch); // stop following: north again, the dot stays
    await expect(locate).toHaveAttribute('data-state', 'off');
    await expect.poll(async () => Math.abs(await bearing(page))).toBeLessThan(1);
    await expect.poll(() => rendered(page, 'user-location-dot')).toBe(1);
  } else {
    // desktop with a mouse: no compass, so the third tap stops following
    await tap(page, 'locate-button', touch);
    await expect(locate).toHaveAttribute('data-state', 'follow');
    await tap(page, 'locate-button', touch);
    await expect(locate).toHaveAttribute('data-state', 'off');
  }

  // --- Start from my location ------------------------------------------------------------------------------------
  await page.evaluate(() => (window as unknown as { __app: AppHook }).__app.route.clear());
  await openRoute(page, touch);
  await expect(page.getByTestId('route-empty')).toBeVisible();
  await shot(page, info, 'route-empty', SHOTS);
  await tap(page, 'start-from-location', touch);
  await expect.poll(() => points(page)).toBe(1);
  await expect(page.getByTestId('toast')).toContainText(/Start set at|far from the runs/);
  await expect(page.getByTestId('point-row-A')).toBeVisible();
  const a = await page.evaluate(() => (window as unknown as { __app: AppHook }).__app.route.points[0]);
  expect(metres(a, here)).toBeLessThan(75); // snapped onto the network next to the station
  await shot(page, info, 'start-from-location', SHOTS);

  // too far away: nothing changes, a plain message
  await moveTo(context, page, [here[0] + 0.3, here[1] - 0.3]);
  await tap(page, 'start-from-location', touch);
  await expect(page.getByTestId('toast')).toContainText('from the nearest run or lift');
  expect(await points(page)).toBe(1);
  // not exact enough
  await moveTo(context, page, here, 400);
  await tap(page, 'start-from-location', touch);
  await expect(page.getByTestId('toast')).toContainText('not exact enough');
  expect(await points(page)).toBe(1);
  // with a route: the new start goes in front (the old A becomes B)
  const other: LngLat = [lift.bottom[0], lift.bottom[1]];
  await page.evaluate((p) => (window as unknown as { __app: { route: { setPoints(p: LngLat[]): boolean } } }).__app.route.setPoints([p]), [
    other[0] + 0.01,
    other[1] + 0.01,
  ] as LngLat);
  await moveTo(context, page, here);
  await tap(page, 'start-from-location', touch);
  await expect.poll(() => points(page)).toBe(2);

  expect(log.errors).toEqual([]);
});

test('location denied: clear message, the app keeps working', async ({ page, context, isMobile }, info) => {
  const touch = isMobile;
  const log = collectErrors(page);
  await context.clearPermissions();
  await openApp(page, info);
  await tap(page, 'locate-button', touch);
  await expect(page.getByTestId('locate-button')).toHaveAttribute('data-state', 'denied');
  await expect(page.getByTestId('locate-button')).toHaveAttribute('aria-label', 'Location is off');
  await expect(page.getByTestId('toast')).toContainText('Location is off for this app');
  await shot(page, info, 'location-denied', SHOTS);
  // Start from my location says the same, and the map still works
  await openRoute(page, touch);
  await tap(page, 'start-from-location', touch);
  await expect(page.getByTestId('toast')).toContainText('Location is off for this app');
  expect(await points(page)).toBe(0);
  await expect(page.getByTestId('map')).toHaveAttribute('data-style-ready', 'true');
  expect(log.errors).toEqual([]);
});

test('touch: the page does not zoom, the map pinches and turns; keep screen on', async ({ page, isMobile }, info) => {
  const touch = isMobile;
  await openApp(page, info);
  const touchAction = await page.evaluate(() => ({
    body: getComputedStyle(document.body).touchAction,
    html: getComputedStyle(document.documentElement).touchAction,
    map: getComputedStyle(document.querySelector('[data-testid=map]')!).touchAction,
  }));
  expect(touchAction).toEqual({ body: 'pan-x pan-y', html: 'pan-x pan-y', map: 'none' });

  if (touch) {
    // two fingers: spread and twist on the map → the map zooms and turns, the page stays at scale 1
    const before = await page.evaluate(() => {
      const m = (window as unknown as { __map: MapHook }).__map;
      return { zoom: m.getZoom(), bearing: m.getBearing() };
    });
    const box = (await page.getByTestId('map').boundingBox())!;
    const cx = box.width / 2;
    const cy = box.height * 0.35;
    const cdp = await page.context().newCDPSession(page);
    const fingers = (r: number, a: number) => [
      { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a), id: 1 },
      { x: cx - r * Math.cos(a), y: cy - r * Math.sin(a), id: 2 },
    ];
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: fingers(40, 0) });
    for (let i = 1; i <= 16; i++) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: fingers(40 + i * 6, (i * Math.PI) / 64) });
      await page.waitForTimeout(16);
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await cdp.detach();
    await waitForMapStill(page);
    const after = await page.evaluate(() => {
      const m = (window as unknown as { __map: MapHook }).__map;
      return { zoom: m.getZoom(), bearing: m.getBearing(), scale: visualViewport?.scale ?? 1 };
    });
    expect(after.zoom).toBeGreaterThan(before.zoom + 0.5);
    expect(Math.abs(after.bearing - before.bearing)).toBeGreaterThan(10);
    expect(after.scale).toBe(1);
  }

  // Menu › Appearance › Keep screen on while planning (Chromium has the Wake Lock API); saved over a reload
  if (!isWide(page)) await expect(page.getByTestId('sheet')).toHaveCount(0);
  await tap(page, 'menu-button', touch);
  await tap(page, 'menu-row-appearance', touch);
  const sw = page.getByTestId('keep-awake');
  await expect(sw).toBeVisible();
  await sw.click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __app: AppHook }).__app.settings.keepAwake)).toBe(true);
  await page.waitForTimeout(400); // the switch thumb animation
  await shot(page, info, 'menu-appearance', SHOTS);
  await page.reload();
  await waitForMap(page, 120_000);
  expect(await page.evaluate(() => (window as unknown as { __app: AppHook }).__app.settings.keepAwake)).toBe(true);
});
