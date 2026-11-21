// Phase 4b: explore mode, info cards, search, the Map sheet, the menu and online-mode gating, in both builds, with a
// mouse (desktop panel layout, 1280 × 800) and with touch (iPhone size). Screenshots: docs/agents/screenshots/phase4b/.
import path from 'node:path';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { ROOT, collectErrors, exploreTargets, newestZip, project, shot, waitForMap, waitForMapStill } from './common.ts';

const SHOTS = path.join(ROOT, 'docs/agents/screenshots/phase4b');
type LngLat = [number, number];
type MapHook = import('maplibre-gl').Map;

async function openApp(page: Page, info: TestInfo): Promise<void> {
  await page.goto('/?e2e');
  if (info.project.name.startsWith('pwa')) {
    await expect(page.getByTestId('no-data')).toBeVisible();
    await page.getByTestId('import-input').setInputFiles(newestZip());
  }
  await waitForMap(page, 120_000);
}

const isWide = (page: Page) => (page.viewportSize()?.width ?? 0) >= 900;
const appState = (page: Page) =>
  page.evaluate(() => {
    const a = (window as unknown as { __app: { route: { points: LngLat[] }; basemap: string; explore: { skiArea: string | null } } }).__app;
    return { points: a.route.points.length, basemap: a.basemap, skiArea: a.explore.skiArea };
  });
const visibility = (page: Page, id: string) => page.evaluate((l) => (window as unknown as { __map: MapHook }).__map.getLayoutProperty(l, 'visibility') ?? 'visible', id);

/** Centres the map on a point (in the free part of the map) and taps/clicks it. */
async function tapAt(page: Page, p: LngLat, touch: boolean, zoom = 15.5): Promise<void> {
  await page.evaluate(
    ({ p, zoom }) => (window as unknown as { __map: MapHook }).__map.jumpTo({ center: p, zoom }),
    { p, zoom },
  );
  await waitForMapStill(page);
  const xy = await project(page, p);
  if (touch) await page.touchscreen.tap(xy.x, xy.y);
  else await page.mouse.click(xy.x, xy.y);
}

async function tap(page: Page, testid: string, touch: boolean): Promise<void> {
  const el = page.getByTestId(testid);
  if (touch) await el.tap();
  else await el.click();
}

/** Opens a tab: the tab bar on the phone, the segmented header of the panel on the desktop. */
async function openTab(page: Page, id: 'route' | 'saved' | 'map', touch: boolean): Promise<void> {
  if (!isWide(page) && (await page.getByTestId(`tab-${id}`).getAttribute('aria-current')) === 'true') return;
  await tap(page, `tab-${id}`, touch);
}

async function search(page: Page, text: string, touch: boolean): Promise<void> {
  if (!isWide(page)) {
    if (!(await page.getByTestId('search-overlay').count())) await tap(page, 'search-button', touch);
    await expect(page.getByTestId('search-overlay')).toBeVisible();
  }
  const input = page.getByTestId('search-input');
  await input.fill(text);
}

const ignoreNetwork = (errors: string[]) => errors.filter((e) => !/net::ERR_|Failed to load resource/.test(e));

test('explore: info card, use as start, search a lift → destination, coordinates, Map sheet, 3D', async ({ page, isMobile }, info) => {
  const touch = isMobile;
  const wide = isWide(page);
  const desktopBuild = info.project.name.startsWith('desktop');
  const log = collectErrors(page);
  const { run, lift } = exploreTargets();
  await openApp(page, info);
  await expect.poll(() => log.infos.some((t) => t.startsWith('[routing]'))).toBe(true);

  // --- desktop layout at 1280 × 800: floating panel, no tab bar ------------------------------------------------
  if (wide) {
    const box = (await page.getByTestId('panel').boundingBox())!;
    expect(box.x).toBe(12);
    expect(box.width).toBe(380);
    expect(box.height).toBe(800 - 24);
    await expect(page.getByTestId('search-button')).toHaveCount(0);
    await expect(page.getByTestId('panel-tabs')).toBeVisible();
    await shot(page, info, 'panel-1280', SHOTS);
  } else {
    await expect(page.getByTestId('panel')).toHaveCount(0);
    await expect(page.getByTestId('search-button')).toBeVisible();
  }

  // --- explore mode: tap a run → info card with stats and the elevation profile -------------------------------
  await tapAt(page, run.at, touch);
  const card = page.getByTestId('info-card');
  await expect(card).toHaveAttribute('data-kind', 'run');
  await expect(page.getByTestId('info-title')).toContainText(run.name);
  await expect(page.getByTestId('info-stats')).toContainText('Length');
  await expect(page.getByTestId('info-stats')).toContainText('Steepest');
  await expect(card).toHaveAttribute('aria-busy', 'false');
  // the tapped run is highlighted on the map
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __map: MapHook }).__map.queryRenderedFeatures({ layers: ['info-highlight-line'] }).length))
    .toBeGreaterThan(0);
  const chart = page.getByTestId('info-profile-chart');
  await chart.scrollIntoViewIfNeeded();
  await expect(chart).toBeVisible();
  if (!touch) {
    const cb = (await chart.boundingBox())!;
    await page.mouse.move(cb.x + cb.width * 0.5, cb.y + cb.height / 2);
    await expect(page.getByTestId('info-profile-readout')).toContainText('%');
    await expect(page.getByTestId('profile-cursor')).toBeVisible();
  }
  await card.evaluate((el) => el.closest('[data-testid=sheet-body], .body')?.scrollTo(0, 0));
  await page.waitForTimeout(400);
  await shot(page, info, 'info-card', SHOTS);

  // "use as start"
  await tap(page, 'use-start', touch);
  await expect.poll(async () => (await appState(page)).points).toBe(1);
  await expect(page.getByTestId('info-card')).toHaveCount(0);
  await expect(page.getByTestId('marker-A')).toBeVisible();

  // --- search a lift by name → pin → use as destination → route -----------------------------------------------
  await search(page, lift.name, touch);
  const result = page.getByTestId('search-result').filter({ hasText: lift.name }).first();
  await expect(result).toBeVisible();
  await expect(page.getByTestId('search-result').first()).toContainText('pin at the bottom station');
  await shot(page, info, 'search', SHOTS);
  if (touch) await result.tap();
  else await page.keyboard.press('Enter'); // keyboard: the first row is highlighted
  await expect(page.getByTestId('search-pin')).toBeVisible();
  await expect(page.getByTestId('info-card')).toHaveAttribute('data-kind', 'pin');
  await expect(page.getByTestId('info-title')).toContainText(lift.name); // search names carry the lift number ("23 See-Eckbahn")
  await tap(page, 'use-destination', touch);
  await expect.poll(async () => (await appState(page)).points).toBe(2);
  await expect(page.getByTestId('search-pin')).toHaveCount(0);
  await expect(page.getByTestId('route-summary')).toBeVisible();
  const pts = await page.evaluate(() => (window as unknown as { __app: { route: { points: LngLat[] } } }).__app.route.points.map((p) => [p[0], p[1]]));
  expect(pts[1][0]).toBeCloseTo(lift.bottom[0], 4); // lifts pin at the bottom station
  expect(pts[1][1]).toBeCloseTo(lift.bottom[1], 4);

  // --- coordinates ---------------------------------------------------------------------------------------------
  const coords = `${run.at[1].toFixed(5)}, ${run.at[0].toFixed(5)}`;
  await search(page, coords, touch);
  await expect(page.getByTestId('search-result').first()).toContainText(coords);
  await tap(page, 'search-result', touch);
  await expect(page.getByTestId('info-card')).toHaveAttribute('data-kind', 'pin');
  await expect(page.getByTestId('info-card')).toContainText(coords);
  await expect(page.getByTestId('use-set-destination')).toBeVisible(); // 2 points: "Set as destination" first
  await tap(page, 'info-close', touch);
  await expect(page.getByTestId('search-pin')).toHaveCount(0);

  // --- Map sheet: steepness colours, hide lifts -----------------------------------------------------------------
  await openTab(page, 'map', touch);
  await expect(page.getByTestId('map-sheet')).toBeVisible();
  if (!wide) {
    await page.getByTestId('sheet-handle').tap();
    await expect(page.getByTestId('sheet')).toHaveAttribute('data-detent', 'large');
  }
  await tap(page, 'color-slope', touch);
  await expect.poll(() => visibility(page, 'ski-runs-slope')).toBe('visible');
  await expect.poll(() => visibility(page, 'ski-runs-downhill')).toBe('none');
  await expect(page.getByTestId('slope-legend')).toContainText('25–40%');
  await page.getByTestId('layer-lifts').click();
  await expect.poll(() => visibility(page, 'ski-lifts')).toBe('none');
  // hidden lifts can't be tapped any more (rendered features update with the next frame)
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __map: MapHook }).__map.queryRenderedFeatures({ layers: ['ski-lifts', 'ski-lift-stations'] }).length))
    .toBe(0);
  await page.waitForTimeout(500);
  await shot(page, info, 'map-sheet', SHOTS);
  await page.getByTestId('layer-lifts').click();
  await expect.poll(() => visibility(page, 'ski-lifts')).toBe('visible');
  await tap(page, 'color-difficulty', touch);
  await expect.poll(() => visibility(page, 'ski-runs-downhill')).toBe('visible');

  // --- ski areas in colour + legend ---------------------------------------------------------------------------
  await page.getByTestId('show-ski-areas').click();
  await expect(page.getByTestId('ski-area-row').first()).toBeVisible();
  await expect.poll(() => visibility(page, 'ski-area-fill')).toBe('visible');
  const area = page.locator('[data-testid=ski-area-row].nested').first();
  await area.scrollIntoViewIfNeeded();
  if (touch) await area.tap();
  else await area.click();
  await expect.poll(async () => (await appState(page)).skiArea).not.toBeNull();
  await page.waitForTimeout(700);
  await shot(page, info, 'ski-areas', SHOTS);
  await page.getByTestId('show-ski-areas').click();
  await expect.poll(() => visibility(page, 'ski-area-fill')).toBe('none');

  // --- base map choices follow online mode (desktop: on by default; PWA: off) -----------------------------------
  if (desktopBuild) await expect(page.getByTestId('basemap-choices')).toBeVisible();
  else {
    await expect(page.getByTestId('basemap-offline-hint')).toBeVisible();
    await expect(page.getByTestId('basemap-choices')).toHaveCount(0);
  }

  // --- 3D terrain (the capsule; the phone needs the medium sheet to reach the top row) ------------------------
  if (!wide) {
    await page.getByTestId('sheet-handle').tap();
    await expect(page.getByTestId('sheet')).toHaveAttribute('data-detent', 'medium');
  }
  await tap(page, 'terrain-button', touch);
  await expect(page.getByTestId('terrain-button')).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => page.evaluate(() => !!(window as unknown as { __map: MapHook }).__map.getTerrain())).toBe(true);
  await expect.poll(() => page.evaluate(() => (window as unknown as { __map: MapHook }).__map.getPitch()), { timeout: 10_000 }).toBeGreaterThan(30);
  await expect(page.getByTestId('terrain-3d')).toBeChecked();
  await expect(page.getByTestId('compass')).toHaveCount(0); // tilted for 3D, not turned: no compass
  await page.evaluate(() => (window as unknown as { __map: MapHook }).__map.setBearing(40));
  await expect(page.getByTestId('compass')).toBeVisible();
  await tap(page, 'compass', touch);
  await expect.poll(() => page.evaluate(() => Math.round((window as unknown as { __map: MapHook }).__map.getBearing()))).toBe(0);
  await tap(page, 'terrain-button', touch);
  await expect.poll(() => page.evaluate(() => (window as unknown as { __map: MapHook }).__map.getTerrain())).toBeNull();

  expect(log.errors).toEqual([]);
});

test('menu: resort page, appearance, gpx.studio (desktop build), data (PWA), online mode gating without network', async ({ page, isMobile }, info) => {
  const touch = isMobile;
  const wide = isWide(page);
  const desktopBuild = info.project.name.startsWith('desktop');
  const log = collectErrors(page);
  // no internet: every request that does not go to the local test servers fails
  await page.context().route(
    (url) => !['127.0.0.1', 'localhost'].includes(url.hostname),
    (r) => r.abort(),
  );
  await openApp(page, info);
  await expect.poll(() => log.infos.some((t) => t.startsWith('[routing]'))).toBe(true);

  // --- menu root → Resort → back ---------------------------------------------------------------------------------
  await tap(page, 'menu-button', touch);
  const menu = page.getByTestId('menu');
  await expect(menu).toBeVisible();
  await expect(menu).toHaveAttribute('data-page', 'root');
  await expect(menu).toContainText('Settings');
  await expect(page.getByTestId('online-mode')).toBeChecked({ checked: desktopBuild }); // default: desktop online, PWA offline
  await page.waitForTimeout(500);
  await shot(page, info, 'menu', SHOTS);
  await tap(page, 'menu-row-resort', touch);
  await expect(menu).toHaveAttribute('data-page', 'resort');
  await expect(page.getByTestId('resort-list').getByRole('radio', { checked: true })).toHaveCount(1);
  await tap(page, 'menu-back', touch);
  await expect(menu).toHaveAttribute('data-page', 'root');

  // --- Appearance › Solid interface switches the glass tokens (and is saved) ----------------------------------------
  await tap(page, 'menu-row-appearance', touch);
  const glassFilter = () => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--glass-filter').trim());
  expect(await glassFilter()).toMatch(/blur/);
  await page.getByTestId('solid-interface').click();
  await expect(page.locator('html')).toHaveAttribute('data-solid', '');
  expect(await glassFilter()).toBe('none');
  await tap(page, 'menu-back', touch);

  // --- gpx.studio: desktop build only; Data: PWA only ----------------------------------------------------------------
  if (desktopBuild) {
    await expect(page.getByTestId('menu-row-data')).toHaveCount(0);
    await tap(page, 'menu-row-gpx', touch);
    await expect(page.getByTestId('gpx-links').locator('.row')).toHaveCount(4);
    await expect(page.getByTestId('gpx-links')).toContainText('/styles/ski-basemap/{z}/{x}/{y}@2x.jpg');
    await tap(page, 'menu-back', touch);
  } else {
    await expect(page.getByTestId('menu-row-gpx')).toHaveCount(0);
    await tap(page, 'menu-row-data', touch);
    await expect(page.getByTestId('installed-data')).toContainText('Oberstdorf');
    await expect(page.getByTestId('installed-data')).toContainText('Terrain z');
    await page.waitForTimeout(400);
    await shot(page, info, 'menu-data', SHOTS);
    await tap(page, 'menu-back', touch);
  }
  await tap(page, 'menu-row-about', touch);
  await expect(page.getByTestId('app-version')).toHaveText(/Version \d+\.\d+\.\d+/);
  await expect(menu).toContainText('OpenSkiData');
  await tap(page, 'menu-back', touch);

  // --- online mode on → online base maps appear; without network the app falls back to the offline map ------------
  if (!desktopBuild) await page.getByTestId('online-mode').click();
  await expect(page.getByTestId('online-mode')).toBeChecked();
  await tap(page, 'menu-close', touch);
  await expect(menu).toHaveCount(0);
  await openTab(page, 'map', touch);
  if (!wide) await page.getByTestId('sheet-handle').tap();
  await expect(page.getByTestId('basemap-choices')).toBeVisible();
  await tap(page, desktopBuild ? 'basemap-openfreemap' : 'basemap-online', touch);
  await expect(page.getByTestId('toast')).toContainText(desktopBuild ? 'Could not load OpenFreeMap' : 'No internet. Using the offline map.');
  await expect.poll(async () => (await appState(page)).basemap).toBe('local');
  await expect(page.getByTestId('basemap-offline')).toBeVisible();
  await waitForMap(page);
  await expect.poll(() => visibility(page, 'ski-runs-downhill')).toBe('visible'); // the offline ski map is back

  // online search row only in online mode
  await search(page, 'Hotel', touch);
  await expect(page.getByTestId('search-result').filter({ hasText: 'Search online for' })).toHaveCount(1);
  if (!wide) await tap(page, 'search-close', touch);
  else await page.getByTestId('search-input').fill('');

  // online mode off → the online maps disappear, search says online search is off.
  // Phone: the large sheet covers the top row (by design), so bring it to medium first
  if (!wide) {
    await page.getByTestId('sheet-handle').tap();
    await expect(page.getByTestId('sheet')).toHaveAttribute('data-detent', 'medium');
  }
  await tap(page, 'menu-button', touch);
  await page.getByTestId('online-mode').click();
  await expect(page.getByTestId('online-mode')).not.toBeChecked();
  await tap(page, 'menu-close', touch);
  await openTab(page, 'map', touch);
  await expect(page.getByTestId('basemap-offline-hint')).toBeVisible();
  await expect(page.getByTestId('basemap-choices')).toHaveCount(0);
  await search(page, 'zzqqxx', touch);
  await expect(page.getByTestId('search-result')).toHaveCount(1); // the rows of the earlier query are gone
  await expect(page.getByTestId('search-result')).toContainText('No matches');
  await expect(page.getByTestId('search-footnote')).toHaveText('Online search is off. Turn on online mode in Settings.');

  // the settings survive a reload
  await page.reload();
  await waitForMap(page);
  await expect(page.locator('html')).toHaveAttribute('data-solid', '');
  await tap(page, 'menu-button', touch);
  await expect(page.getByTestId('online-mode')).not.toBeChecked();
  if (wide) {
    // desktop: 1440 × 900 too
    await tap(page, 'menu-close', touch);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForTimeout(600);
    await shot(page, info, 'panel-1440', SHOTS);
  }

  expect(ignoreNetwork(log.errors)).toEqual([]);
});
