// Phase 4a: everything about the route, in both builds, with a mouse (wide, desktop panel layout) and with touch
// (iPhone size). Screenshots go to phase4b/ now (route-*.png), so the 4b layout fixes can be checked.
// Plan 3 points by tapping, drag a marker, undo/redo, the Route sheet at medium and large (drag), scrub the
// gradient profile, collapse a leg, a route setting, save the route, share/download GPX, reload → restored.
import path from 'node:path';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { ROOT, collectErrors, mouseDrag, newestZip, project, shot, threePoints, touchDrag, waitForMap, waitForMapStill } from './common.ts';

const SHOTS = path.join(ROOT, 'docs/agents/screenshots/phase4b');
type LngLat = [number, number];
type AppHook = {
  route: { points: LngLat[]; result: { summary: { duration: number; distance: number }; warnings: string[] } | null; error: string | null; busy: boolean };
  ui: { detent: string; sheet: string | null };
};
const app = (page: Page) => page.evaluate(() => {
  const a = (window as unknown as { __app: AppHook }).__app;
  return { points: a.route.points.map((p) => [p[0], p[1]]), result: a.route.result ? { summary: a.route.result.summary, warnings: a.route.result.warnings } : null, error: a.route.error, busy: a.route.busy, detent: a.ui.detent, sheet: a.ui.sheet };
});

async function openApp(page: Page, info: TestInfo): Promise<void> {
  await page.goto('/?e2e');
  if (info.project.name.startsWith('pwa')) {
    await expect(page.getByTestId('no-data')).toBeVisible();
    await page.getByTestId('import-input').setInputFiles(newestZip());
  }
  await waitForMap(page, 120_000);
}

/** Puts the points in the part of the map above the medium sheet, then taps/clicks them one by one. Before every
 * tap the points are framed again and the map must stand still: after the second point the new route is fitted
 * into the free area (a camera animation), which would move the next point away from where it was projected. */
async function tapPoints(page: Page, points: LngLat[], touch: boolean): Promise<void> {
  const frame = () =>
    page.evaluate((pts) => {
      const map = (window as unknown as { __map: import('maplibre-gl').Map }).__map;
      const h = map.getContainer().clientHeight;
      const lons = pts.map((p) => p[0]);
      const lats = pts.map((p) => p[1]);
      // desktop layout (≥ 900 px): the panel covers the left 404 px, nothing covers the bottom
      const wide = innerWidth >= 900;
      map.stop();
      map.setPadding({ top: 0, bottom: 0, left: 0, right: 0 });
      map.fitBounds([[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]], {
        // phone: above the medium sheet and the Plan / Locate buttons that ride on it
        padding: wide ? { top: 140, bottom: 120, left: 480, right: 140 } : { top: 170, bottom: Math.round(h * 0.56) + 80, left: 70, right: 70 },
        animate: false,
      });
    }, points);
  for (const p of points) {
    await waitForMapStill(page);
    await frame();
    await waitForMap(page);
    const xy = await project(page, p);
    if (touch) await page.touchscreen.tap(xy.x, xy.y);
    else await page.mouse.click(xy.x, xy.y);
    await page.waitForTimeout(200);
  }
}

const summaryText = (page: Page) => page.getByTestId('route-summary').innerText();

test('route: plan, drag, undo/redo, sheet, profile, directions, settings, save, share, reload', async ({ page, isMobile }, info) => {
  const touch = isMobile;
  // desktop layout (≥ 900 px): a floating panel with the same contents instead of the sheet with detents
  const wide = (page.viewportSize()?.width ?? 0) >= 900;
  const log = collectErrors(page);
  // iPhone: the Web Share API with files (Chromium on Linux has none); record the calls
  if (touch) {
    await page.addInitScript(() => {
      const w = window as unknown as { __shared: { name: string; type: string; text: string }[] };
      w.__shared = [];
      Object.assign(navigator, {
        canShare: (d: { files?: File[] }) => !!d.files?.length,
        share: async (d: { files: File[] }) => {
          for (const f of d.files) w.__shared.push({ name: f.name, type: f.type, text: await f.text() });
        },
      });
    });
  }
  await openApp(page, info);
  await expect.poll(() => log.infos.some((t) => t.startsWith('[routing]'))).toBe(true);

  // --- plan 3 points ----------------------------------------------------------------------------------------
  await page.getByTestId('plan-button').click();
  const pts = threePoints();
  await tapPoints(page, pts, touch);
  for (const l of ['A', 'B', 'C']) await expect(page.getByTestId(`marker-${l}`)).toBeVisible();
  await expect(page.getByTestId('route-summary')).toBeVisible();
  if (wide) {
    await expect(page.getByTestId('panel')).toBeVisible();
    await expect(page.getByTestId('tab-route')).toHaveAttribute('aria-checked', 'true');
  } else await expect(page.getByTestId('sheet')).toHaveAttribute('data-detent', 'medium');
  await expect(page.locator('[data-testid^=point-row-]')).toHaveCount(3);
  await expect(page.getByTestId('undo')).toBeVisible();
  await expect.poll(async () => (await app(page)).busy).toBe(false);
  await waitForMapStill(page);
  await shot(page, info, 'route-1-medium', SHOTS);

  // --- drag marker B ------------------------------------------------------------------------------------------
  const before = (await app(page)).points;
  const b = await page.getByTestId('marker-B').boundingBox();
  const from = { x: b!.x + b!.width / 2, y: b!.y + b!.height / 2 };
  const to = { x: from.x + 30, y: from.y - 20 };
  if (touch) await touchDrag(page, from, to, { holdMs: 200 });
  else await mouseDrag(page, from, to);
  await expect.poll(async () => (await app(page)).points[1][0]).not.toBe(before[1][0]);
  const moved = (await app(page)).points;
  expect(moved[0]).toEqual(before[0]);
  expect(moved).toHaveLength(3); // a drag never adds or removes a point
  await expect.poll(async () => (await app(page)).busy).toBe(false);

  // --- undo / redo (keyboard on the desktop, the capsule on the phone) ---------------------------------------
  if (touch) await page.getByTestId('undo').tap();
  else await page.keyboard.press('Control+z');
  await expect.poll(async () => (await app(page)).points[1]).toEqual(before[1]);
  await expect(page.getByTestId('redo')).toBeVisible();
  if (touch) await page.getByTestId('redo').tap();
  else await page.keyboard.press('Control+y');
  await expect.poll(async () => (await app(page)).points[1]).toEqual(moved[1]);
  await expect(page.getByTestId('redo')).toHaveCount(0);

  // --- marker tap: phone opens the point in the sheet (no removal) -------------------------------------------
  if (touch) {
    const c = await page.getByTestId('marker-C').boundingBox();
    await page.touchscreen.tap(c!.x + c!.width / 2, c!.y + c!.height / 2);
    await page.waitForTimeout(100);
    expect((await app(page)).points).toHaveLength(3);
  }

  // --- the sheet to the large detent: drag the handle (touch) or click it (mouse); the desktop panel has none ---
  if (!wide) {
    const handle = page.getByTestId('sheet-handle');
    if (touch) {
      const hb = (await handle.boundingBox())!;
      await touchDrag(page, { x: hb.x + hb.width / 2, y: hb.y + 8 }, { x: hb.x + hb.width / 2, y: 120 }, { steps: 8 });
    } else await handle.click();
    await expect(page.getByTestId('sheet')).toHaveAttribute('data-detent', 'large');
  }
  await page.waitForTimeout(600);
  await shot(page, info, 'route-2-large', SHOTS);

  // --- scrub the gradient profile ---------------------------------------------------------------------------
  const chart = page.getByTestId('profile-chart');
  await chart.scrollIntoViewIfNeeded();
  const cb = (await chart.boundingBox())!;
  const y = cb.y + cb.height / 2;
  const x1 = cb.x + 44 + (cb.width - 60) * 0.2;
  const x2 = cb.x + 44 + (cb.width - 60) * 0.8;
  const readout = page.getByTestId('profile-readout');
  let first: string;
  if (touch) {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x1 - 20, y }] });
    for (let i = 1; i <= 6; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x1 - 20 + (20 * i) / 6, y }] });
    await expect(readout).toBeVisible();
    first = await readout.innerText();
    await expect(page.getByTestId('profile-cursor')).toBeVisible();
    for (let i = 1; i <= 10; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x1 + ((x2 - x1) * i) / 10, y }] });
    await expect(readout).not.toHaveText(first);
    await shot(page, info, 'route-3-profile-scrub', SHOTS);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await cdp.detach();
    // the horizontal drag scrubbed: the sheet did not move
    await expect(page.getByTestId('sheet')).toHaveAttribute('data-detent', 'large');
  } else {
    await page.mouse.move(x1, y);
    await expect(readout).toBeVisible();
    first = await readout.innerText();
    await expect(page.getByTestId('profile-cursor')).toBeVisible();
    await page.mouse.move(x2, y, { steps: 5 });
    await expect(readout).not.toHaveText(first);
    await shot(page, info, 'route-3-profile-scrub', SHOTS);
    await page.mouse.move(cb.x + cb.width / 2, cb.y - 120);
  }
  expect(first).toMatch(/\d+ m/);
  expect(first).toMatch(/at \d/);
  await expect(readout).toHaveCount(0, { timeout: 5000 }); // fades out after the release
  await expect(page.getByTestId('profile-cursor')).toHaveCount(0);

  // steepness colours
  await page.getByTestId('profile-mode').getByRole('radio', { name: 'Steepness' }).click();
  await expect(page.getByTestId('profile-mode').getByRole('radio', { name: 'Steepness' })).toHaveAttribute('aria-checked', 'true');

  // --- collapse a leg ----------------------------------------------------------------------------------------
  const leg = page.getByTestId('leg-A-B');
  await leg.scrollIntoViewIfNeeded();
  await expect(leg).toHaveAttribute('data-collapsed', 'false');
  await expect(leg.locator('.step').first()).toBeVisible();
  await page.getByTestId('leg-toggle-A-B').click();
  await expect(leg).toHaveAttribute('data-collapsed', 'true');
  await expect(leg.locator('.step')).toHaveCount(0);

  // --- route settings: only green runs → the route changes, warns or fails --------------------------------------
  const summaryBefore = await app(page);
  await page.getByTestId('open-route-settings').click();
  await expect(page.getByTestId('route-settings')).toBeVisible();
  await page.waitForTimeout(400);
  await shot(page, info, 'route-4-settings', SHOTS);
  const blue = page.getByTestId('difficulty-easy');
  await expect(blue).toBeChecked();
  await blue.locator('..').click();
  await expect(blue).not.toBeChecked();
  await expect.poll(async () => {
    const s = await app(page);
    if (s.busy) return false;
    return (
      s.error !== null ||
      JSON.stringify(s.result?.summary) !== JSON.stringify(summaryBefore.result?.summary) ||
      (s.result?.warnings.length ?? 0) > (summaryBefore.result?.warnings.length ?? 0)
    );
  }).toBe(true);
  // a preset button: active highlight follows the speeds
  await page.getByTestId('speed-preset').getByRole('radio', { name: 'Confident' }).click();
  await expect(page.getByTestId('speed-preset').getByRole('radio', { name: 'Confident' })).toHaveAttribute('aria-checked', 'true');
  // undo both settings changes. Phone: the large sheet covers the top row, so go to medium first (tap the handle)
  if (touch) {
    await page.getByTestId('sheet-handle').tap();
    await expect(page.getByTestId('sheet')).toHaveAttribute('data-detent', 'medium');
  }
  for (let i = 0; i < 2; i++) {
    if (touch) await page.getByTestId('undo').tap();
    else await page.keyboard.press('Control+z');
  }
  await expect(blue).toBeChecked();
  await expect(page.getByTestId('speed-preset').getByRole('radio', { name: 'Beginner' })).toHaveAttribute('aria-checked', 'true');
  await page.getByTestId('sheet-back').click();
  await expect(page.getByTestId('route-summary')).toBeVisible();

  // --- share / download the GPX ------------------------------------------------------------------------------
  await expect.poll(async () => (await app(page)).busy).toBe(false);
  if (touch) {
    await page.getByTestId('share-gpx').tap();
    await expect.poll(() => page.evaluate(() => (window as unknown as { __shared: unknown[] }).__shared.length)).toBe(1);
    const shared = await page.evaluate(() => (window as unknown as { __shared: { name: string; type: string; text: string }[] }).__shared[0]);
    expect(shared.name).toMatch(/\.gpx$/);
    expect(shared.type).toBe('application/gpx+xml');
    expect(shared.text).toMatch(/^<\?xml/);
    expect(shared.text).toContain('<trkpt');
  } else {
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('share-gpx').click()]);
    expect(download.suggestedFilename()).toMatch(/route\.gpx$/);
  }

  // --- save the route ----------------------------------------------------------------------------------------
  await page.getByTestId('tab-saved').click();
  await expect(page.getByTestId('saved-sheet')).toBeVisible();
  await expect(page.getByTestId('saved-empty')).toBeVisible();
  await page.getByTestId('route-name').fill('E2E route');
  await page.getByTestId('route-folder').fill('Tests');
  await page.getByTestId('save-route').click();
  await expect(page.getByTestId('save-status')).toHaveText('Saved in "Tests".');
  await expect(page.getByTestId('folder-Tests')).toContainText('E2E route');
  await expect(page.getByTestId('save-route')).toHaveText('Save changes');
  await page.waitForTimeout(400);
  await shot(page, info, 'route-5-saved', SHOTS);
  if (!touch) {
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('share-folder').click()]);
    expect(download.suggestedFilename()).toBe('tests.zip');
  }

  // --- reload: route, settings and the saved route are back ----------------------------------------------------
  const saved = await app(page);
  await page.waitForTimeout(400); // the state is saved 150 ms after the last change
  await page.reload();
  await waitForMap(page);
  for (const l of ['A', 'B', 'C']) await expect(page.getByTestId(`marker-${l}`)).toBeVisible();
  await expect.poll(async () => (await app(page)).points).toEqual(saved.points);
  await expect(page.getByTestId('saved-sheet')).toBeVisible(); // the open sheet is remembered
  await expect(page.getByTestId('folder-Tests')).toContainText('E2E route');
  await page.getByTestId('tab-route').click();
  await expect(page.getByTestId('route-summary')).toBeVisible();
  await expect(page.locator('#sheet-title')).toHaveText('E2E route');
  await expect(page.getByTestId('undo')).toBeVisible(); // the undo history survives too
  const leg2 = page.getByTestId('leg-A-B');
  await expect(leg2).toHaveAttribute('data-collapsed', 'true'); // collapsed legs are remembered

  // --- clear, then open the saved route again ----------------------------------------------------------------
  await page.getByTestId('clear').click();
  await expect(page.getByTestId('route-empty')).toBeVisible();
  await page.getByTestId('tab-saved').click();
  await page.getByTestId('open-saved').first().click();
  await expect(page.getByTestId('route-summary')).toBeVisible();
  await expect.poll(async () => (await app(page)).points).toEqual(saved.points);

  // --- phone: at the large detent a downward drag at scroll position 0 moves the sheet (scroll handoff) --------
  if (touch) {
    await page.getByTestId('sheet-handle').tap();
    await expect(page.getByTestId('sheet')).toHaveAttribute('data-detent', 'large');
    await page.getByTestId('sheet-body').evaluate((el) => (el.scrollTop = 0));
    const body = (await page.getByTestId('route-summary').boundingBox())!;
    await touchDrag(page, { x: body.x + body.width / 2, y: body.y + 20 }, { x: body.x + body.width / 2, y: body.y + 320 }, { steps: 10 });
    await expect(page.getByTestId('sheet')).toHaveAttribute('data-detent', 'medium');

    // swipe a saved route to the left → Delete; the toast offers Undo
    await page.getByTestId('tab-saved').tap();
    await page.getByTestId('sheet-handle').tap(); // large: the list is below the visible part of the medium sheet
    await expect(page.getByTestId('sheet')).toHaveAttribute('data-detent', 'large');
    const row = page.locator('[data-testid^=saved-row-]').first();
    await row.scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    const rb = (await row.boundingBox())!;
    await touchDrag(page, { x: rb.x + rb.width - 30, y: rb.y + rb.height / 2 }, { x: rb.x + 10, y: rb.y + rb.height / 2 }, { steps: 10 });
    await expect(page.getByTestId('saved-empty')).toBeVisible();
    await expect(page.getByTestId('toast')).toContainText('Route deleted');
    await page.getByTestId('toast').getByRole('button', { name: 'Undo' }).tap();
    await expect(page.getByTestId('folder-Tests')).toContainText('E2E route');
  } else {
    // desktop: delete button, P and Esc
    await page.getByTestId('tab-saved').click();
    await page.getByTestId('saved-delete').first().click();
    await expect(page.getByTestId('saved-empty')).toBeVisible();
    await page.getByTestId('toast').getByRole('button', { name: 'Undo' }).click();
    await expect(page.getByTestId('folder-Tests')).toContainText('E2E route');
    await page.locator('body').click({ position: { x: wide ? 640 : 5, y: wide ? 500 : 400 } }); // focus out of the sheet, on the map
    const plan = page.getByTestId('plan-button');
    const wasOn = (await plan.getAttribute('aria-pressed')) === 'true';
    if (!wide) {
      await page.keyboard.press('Escape'); // closes the sheet first
      await expect(page.getByTestId('sheet')).toHaveCount(0);
    }
    await page.keyboard.press('p');
    await expect(plan).toHaveAttribute('aria-pressed', String(!wasOn));
    await page.keyboard.press('p');
    await page.keyboard.press('Escape'); // then leaves plan mode
    await expect(plan).toHaveAttribute('aria-pressed', 'false');
  }

  expect(log.errors).toEqual([]);
});
