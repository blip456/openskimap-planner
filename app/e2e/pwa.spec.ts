// PWA build served statically: no data → import the real data ZIP into OPFS → map + route from local data.
import { expect, test } from '@playwright/test';
import { addPoints, collectErrors, expectMapNotBlank, newestZip, routePoints, shot, waitForMap, waitForMapStill } from './common.ts';

test('pwa: import the data ZIP, map renders from OPFS, route works', async ({ page, isMobile }, info) => {
  const log = collectErrors(page);
  await page.goto('/?e2e');
  await expect(page.getByTestId('no-data')).toBeVisible();
  await expect(page.getByTestId('import-from-build')).toHaveCount(0); // dev-only button is not in the build
  await expect(page.getByTestId('dev-overlay')).toHaveCount(0);
  await shot(page, info, '1-no-data');

  await page.getByTestId('import-input').setInputFiles(newestZip());
  await expect(page.getByTestId('import-progress')).toBeVisible();
  await shot(page, info, '2-importing');
  await waitForMap(page, 120_000);
  await expectMapNotBlank(page);
  await shot(page, info, '3-map');
  const imported = log.infos.find((t) => t.startsWith('[import]'));
  console.log(imported);

  await page.getByTestId('plan-button').click();
  await expect.poll(() => log.infos.some((t) => t.startsWith('[routing]'))).toBe(true);
  await addPoints(page, routePoints(), isMobile);
  await expect(page.getByTestId('route-summary')).toBeVisible();
  await expect(page.getByTestId('route-summary')).toContainText('km');
  await waitForMapStill(page);
  await shot(page, info, '4-route');
  console.log(log.infos.find((t) => t.startsWith('[routing]')));

  // the data stays in OPFS: a reload goes straight to the map
  await page.reload();
  await waitForMap(page);
  await expect(page.getByTestId('no-data')).toHaveCount(0);

  expect(log.errors).toEqual([]);
});
