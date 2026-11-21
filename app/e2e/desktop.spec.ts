// Desktop build + desktop server: map from the server's PMTiles, plan mode, a route from the routing worker.
import { expect, test } from '@playwright/test';
import { addPoints, collectErrors, expectMapNotBlank, routePoints, shot, waitForMap, waitForMapStill } from './common.ts';

test('desktop: map renders, plan mode, route between two points', async ({ page, isMobile }, info) => {
  const log = collectErrors(page);
  await page.goto('/?e2e');
  await waitForMap(page);
  await expectMapNotBlank(page);
  await shot(page, info, '1-map');

  await page.getByTestId('plan-button').click();
  await expect(page.getByTestId('plan-button')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('mode-pill')).toBeVisible();

  await expect.poll(() => log.infos.some((t) => t.startsWith('[routing]'))).toBe(true);
  await addPoints(page, routePoints(), isMobile);
  await expect(page.getByTestId('marker-A')).toBeVisible();
  await expect(page.getByTestId('marker-B')).toBeVisible();
  const summary = page.getByTestId('route-summary');
  await expect(summary).toBeVisible();
  await expect(summary).toContainText('km');
  await waitForMapStill(page);
  await shot(page, info, '2-route');

  // the desktop build never registers a service worker and has no web app manifest (phase 5)
  expect(await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length)).toBe(0);
  expect(await page.locator('link[rel=manifest]').count()).toBe(0);
  const sw = await page.request.get('/sw.js');
  expect(sw.status() === 404 || !(await sw.text()).includes('workbox')).toBe(true);

  console.log(log.infos.find((t) => t.startsWith('[routing]')));
  expect(log.errors).toEqual([]);
});
