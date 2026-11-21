// Phase 7: the main screens in light and dark, with an axe accessibility check on each (serious and critical
// problems fail the test), the landscape phone layout, the 36 px desktop toolbar, keyboard focus, reduced motion and
// the solid surfaces (Solid interface, Reduce transparency, Increase contrast).
// Screenshots: docs/agents/screenshots/phase7/ (iPhone portrait + landscape, wide 1280 and 1440, light + dark).
import path from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { ROOT, collectErrors, exploreTargets, newestZip, shot, threePoints, waitForMap, waitForMapStill } from './common.ts';

const SHOTS = path.join(ROOT, 'docs/agents/screenshots/phase7');
type LngLat = [number, number];
type MapHook = import('maplibre-gl').Map;
type AppHook = { route: { setPoints: (p: LngLat[]) => boolean; busy: boolean; result: unknown }; ui: { detent: string } };

/** serious and critical axe findings, as short lines (rule, impact, first targets) */
async function axe(page: Page, screen: string): Promise<string[]> {
  const r = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    // the map canvas is a picture; its route points are reachable as buttons and in the Route sheet list
    .exclude('.maplibregl-canvas-container')
    .analyze();
  return r.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .flatMap((v) =>
      v.nodes.map((n) => {
        const d = n.any[0]?.data as { fgColor?: string; bgColor?: string; contrastRatio?: number } | undefined;
        const colours = d?.fgColor ? ` ${d.fgColor} on ${d.bgColor} = ${d.contrastRatio}` : '';
        return `${screen}: ${v.id} (${v.impact}) ${n.target.join(' ')}${colours}`;
      }),
    );
}

/** screenshot in light and dark, with an axe run in each */
async function both(page: Page, info: TestInfo, name: string, found: string[], prefix = ''): Promise<void> {
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.waitForTimeout(250);
    await shot(page, info, `${prefix}${name}-${scheme}`, SHOTS);
    found.push(...(await axe(page, `${prefix}${name} ${scheme}`)));
  }
  await page.emulateMedia({ colorScheme: 'light' });
}

/** blurred surfaces on screen: count and share of the viewport (visible part, after clip-path) */
async function glassBudget(page: Page): Promise<{ count: number; share: number }> {
  return page.evaluate(() => {
    let area = 0;
    let count = 0;
    for (const el of Array.from(document.querySelectorAll('body *')) as HTMLElement[]) {
      const cs = getComputedStyle(el);
      if (!cs.backdropFilter || cs.backdropFilter === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') continue;
      const r = el.getBoundingClientRect();
      // the sheet is one tall element clipped to the detent: use the clipped part (its parent's clip-path)
      let bottom = Math.min(r.bottom, innerHeight);
      const clipOwner = el.closest('[data-testid=sheet], [data-testid=info-sheet]') as HTMLElement | null;
      if (clipOwner) {
        const m = /inset\(0px 0px ([\d.]+)px/.exec(getComputedStyle(clipOwner).clipPath);
        if (m) bottom = Math.min(bottom, clipOwner.getBoundingClientRect().bottom - Number(m[1]));
      }
      const h = Math.max(0, bottom - Math.max(0, r.top));
      const w = Math.max(0, Math.min(r.right, innerWidth) - Math.max(0, r.left));
      if (w * h > 0) {
        if (new URLSearchParams(location.search).has('debug-glass')) console.log('[glass-el]', el.className, Math.round(w), Math.round(h));
        count++;
        area += w * h;
      }
    }
    return { count, share: Math.round((100 * area) / (innerWidth * innerHeight)) / 100 };
  });
}

async function openApp(page: Page, info: TestInfo): Promise<void> {
  await page.goto(process.env.DEBUG_GLASS ? '/?e2e&debug-glass' : '/?e2e');
  if (info.project.name.startsWith('pwa')) {
    await expect(page.getByTestId('no-data')).toBeVisible();
    await page.getByTestId('import-input').setInputFiles(newestZip());
  }
  await waitForMap(page, 120_000);
}

async function setRoute(page: Page): Promise<void> {
  const pts = threePoints();
  await page.evaluate((p) => (window as unknown as { __app: AppHook }).__app.route.setPoints(p as LngLat[]), pts);
  await expect(page.getByTestId('route-summary')).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __app: AppHook }).__app.route.busy)).toBe(false);
  await waitForMapStill(page);
}

async function press(page: Page, testid: string, touch: boolean): Promise<void> {
  if (touch) await page.getByTestId(testid).tap();
  else await page.getByTestId(testid).click();
}

test('screens in light and dark, with axe on each', async ({ page, isMobile }, info) => {
  test.skip(!info.project.name.startsWith('desktop'), 'the desktop build has the same screens without an import');
  const touch = isMobile;
  const wide = (page.viewportSize()?.width ?? 0) >= 900;
  const log = collectErrors(page);
  if (process.env.DEBUG_GLASS) page.on('console', (m) => m.text().startsWith('[glass-el]') && console.log(m.text()));
  const found: string[] = [];
  await openApp(page, info);
  await expect.poll(() => log.infos.some((t) => t.startsWith('[routing]'))).toBe(true);

  // map (iPhone: no sheet; desktop: the panel with the empty Route tab)
  await both(page, info, 'map', found);
  // glass budget (spec §5): at most 6 blurred surfaces at rest, small ones only
  const atRest = await glassBudget(page);
  console.log(`[glass] ${info.project.name} map: ${JSON.stringify(atRest)}`);
  expect(atRest.count).toBeLessThanOrEqual(wide ? 7 : 6); // desktop: + the panel header (decisions.md)
  expect(atRest.share).toBeLessThanOrEqual(0.3);

  // route, medium (iPhone) / panel (desktop)
  await setRoute(page);
  if (!wide) await expect(page.getByTestId('sheet')).toHaveAttribute('data-detent', 'medium');
  await page.waitForTimeout(400);
  await both(page, info, 'route-medium', found);
  const withSheet = await glassBudget(page);
  console.log(`[glass] ${info.project.name} route medium: ${JSON.stringify(withSheet)}`);
  expect(withSheet.count).toBeLessThanOrEqual(9);
  if (wide) {
    // desktop toolbar with a mouse: 36 px capsules (spec §3.11)
    for (const id of ['plan-button', 'panel-toggle', 'terrain-button', 'undo-redo', 'locate-button']) {
      expect((await page.getByTestId(id).boundingBox())!.height, id).toBe(36);
    }
  } else {
    await press(page, 'sheet-handle', touch);
    await expect(page.getByTestId('sheet')).toHaveAttribute('data-detent', 'large');
    await page.waitForTimeout(600);
    await both(page, info, 'route-large', found);
    await press(page, 'sheet-handle', touch);
    await expect(page.getByTestId('sheet')).toHaveAttribute('data-detent', 'medium');
  }

  // Map sheet / tab
  await press(page, 'tab-map', touch);
  await page.waitForTimeout(400);
  await both(page, info, 'map-sheet', found);
  if (wide) {
    // 1440 × 900 too (spec §3.11)
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForTimeout(400);
    await both(page, info, 'map-sheet', found, '1440-');
    await press(page, 'tab-route', touch);
    await page.waitForTimeout(300);
    await both(page, info, 'route', found, '1440-');
    await page.setViewportSize({ width: 1280, height: 800 });
  } else await press(page, 'tab-map', touch); // closes the sheet

  // search, then the info card of the result
  const { lift } = exploreTargets();
  if (!wide) await press(page, 'search-button', touch);
  await page.getByTestId('search-input').fill(lift.name);
  await expect(page.getByTestId('search-result').first()).toBeVisible();
  await both(page, info, 'search', found);
  if (touch) await page.getByTestId('search-result').first().tap();
  else await page.keyboard.press('Enter');
  await expect(page.getByTestId('info-card')).toBeVisible();
  await waitForMapStill(page);
  await both(page, info, 'info-card', found);
  await press(page, 'info-close', touch);

  // menu
  await press(page, 'menu-button', touch);
  await expect(page.getByTestId('menu')).toBeVisible();
  await page.waitForTimeout(500);
  await both(page, info, 'menu', found);
  await page.keyboard.press('Escape');

  expect(found, found.join('\n')).toEqual([]);
  expect(log.errors).toEqual([]);
});

test('data screen in light and dark (PWA), with axe', async ({ page }, info) => {
  test.skip(!info.project.name.startsWith('pwa'), 'Data is only in the PWA');
  const found: string[] = [];
  await openApp(page, info);
  await page.getByTestId('menu-button').click();
  await page.getByTestId('menu-row-data').click();
  await expect(page.getByTestId('menu')).toHaveAttribute('data-page', 'data');
  await page.waitForTimeout(500);
  await both(page, info, 'data-screen', found);
  expect(found, found.join('\n')).toEqual([]);
});

test('landscape phone: left panel, no tab bar, touch-sized buttons', async ({ browser }, info) => {
  test.skip(info.project.name !== 'desktop-iphone', 'one landscape run is enough (same app in both builds)');
  const context = await browser.newContext({ viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true, baseURL: info.project.use.baseURL });
  const page = await context.newPage();
  const log = collectErrors(page);
  const found: string[] = [];
  await openApp(page, info);
  // the panel (360 wide) replaces the sheets; no tab bar
  const box = (await page.getByTestId('panel').boundingBox())!;
  expect(box.x).toBe(8);
  expect(box.width).toBe(360);
  await expect(page.getByTestId('search-button')).toHaveCount(0);
  for (const id of ['plan-button', 'locate-button', 'terrain-button', 'panel-toggle']) {
    expect((await page.getByTestId(id).boundingBox())!.height, id).toBeGreaterThanOrEqual(44);
  }
  // map padding: the panel's right edge
  expect(await page.evaluate(() => (window as unknown as { __map: MapHook }).__map.getPadding().left)).toBe(368);
  await both(page, info, 'map', found, 'landscape-');
  await setRoute(page);
  await both(page, info, 'route', found, 'landscape-');
  // the info card shows in the panel (no tab selected)
  const { lift } = exploreTargets();
  await page.getByTestId('search-input').fill(lift.name);
  await page.getByTestId('search-result').first().tap();
  await expect(page.getByTestId('info-panel')).toBeVisible();
  await expect(page.locator('[data-testid=panel-tabs] [aria-checked=true]')).toHaveCount(0);
  await waitForMapStill(page);
  await both(page, info, 'info-card', found, 'landscape-');
  await page.getByTestId('tab-route').tap();
  await expect(page.getByTestId('info-panel')).toHaveCount(0);
  // hide the panel: the map gets the full width, the menu button moves to the map
  await page.getByTestId('panel-toggle').tap();
  await expect(page.getByTestId('panel')).toHaveCount(0);
  await expect(page.getByTestId('menu-button')).toBeVisible();
  await page.getByTestId('menu-button').tap();
  await expect(page.getByTestId('menu')).toBeVisible();
  await page.waitForTimeout(500);
  await both(page, info, 'menu', found, 'landscape-');
  expect(found, found.join('\n')).toEqual([]);
  expect(log.errors).toEqual([]);
  await context.close();
});

test('reduced motion, solid surfaces and keyboard focus', async ({ page, isMobile }, info) => {
  test.skip(!info.project.name.startsWith('desktop'), 'same CSS in both builds');
  const touch = isMobile;
  const wide = (page.viewportSize()?.width ?? 0) >= 900;
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openApp(page, info);
  const map = () => page.evaluate(() => {
    const m = (window as unknown as { __map: MapHook }).__map;
    return { pitch: m.getPitch(), moving: m.isMoving() };
  });

  // map: 3D jumps instead of flying (no camera animation)
  await press(page, 'terrain-button', touch);
  await page.waitForTimeout(50);
  expect((await map()).pitch).toBeGreaterThan(55);
  await press(page, 'terrain-button', touch);
  await page.waitForTimeout(50);
  expect((await map()).pitch).toBe(0);

  if (!wide) {
    // sheet: fades instead of sliding (no transform transition, no spring)
    await press(page, 'tab-route', touch);
    const sheet = page.getByTestId('sheet');
    await expect(sheet).toBeVisible();
    const t = await sheet.evaluate((el) => getComputedStyle(el).transitionProperty);
    expect(t).toBe('opacity');
    await press(page, 'tab-route', touch);
  }

  // Reduce transparency (Chrome supports the media feature; Safari users have the Solid interface switch)
  const glass = page.locator(wide ? '[data-testid=panel] header' : 'nav.tabs');
  const filter = () => glass.evaluate((el) => getComputedStyle(el).backdropFilter);
  expect(await filter()).toContain('blur');
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-transparency', value: 'reduce' }] });
  expect(await filter()).toBe('none');
  await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-contrast', value: 'more' }] });
  expect(await filter()).toBe('none');
  await cdp.send('Emulation.setEmulatedMedia', { features: [] });
  expect(await filter()).toContain('blur');
  await cdp.detach();

  if (wide) {
    // keyboard: a visible focus ring, and the panel tabs move with the arrow keys (radio group)
    await page.getByTestId('tab-route').focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByTestId('tab-saved')).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByTestId('tab-saved')).toBeFocused();
    const ring = await page.getByTestId('tab-saved').evaluate((el) => {
      const s = getComputedStyle(el);
      return { style: s.outlineStyle, width: parseFloat(s.outlineWidth) };
    });
    expect(ring.style).toBe('solid');
    expect(ring.width).toBeGreaterThanOrEqual(2);
    await page.keyboard.press('ArrowLeft');
    await expect(page.getByTestId('tab-route')).toHaveAttribute('aria-checked', 'true');
  }
});
