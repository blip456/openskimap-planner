// Desktop only: the "Build region" page (Menu → Build region). Checks the search and the save dialog in a real
// browser against the desktop server. It never starts a real build (that takes minutes and downloads data): the
// test stops at the "Save this region?" dialog and cancels it.
import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { ROOT, collectErrors, waitForMap } from './common.ts';

test('desktop: Build region — search a ski area, size estimate, save dialog', async ({ page }) => {
  const log = collectErrors(page);
  await page.goto('/?e2e');
  await waitForMap(page);

  await page.getByTestId('menu-button').click();
  await page.getByTestId('menu-row-regions').click();
  const builder = page.getByTestId('region-builder');
  await expect(builder).toBeVisible();

  await page.getByTestId('region-mode-search').click();
  await page.getByTestId('region-search').fill('Nebelhorn');
  const result = page.getByTestId('region-result').filter({ hasText: 'Nebelhorn' }).first();
  await expect(result).toBeVisible();
  await result.click();
  await expect(result).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('region-picked')).toContainText('Nebelhorn');

  const estimate = page.getByTestId('region-estimate');
  await expect(estimate).toContainText('km');
  await expect(estimate).toContainText('Terrain');

  await page.getByTestId('region-name').fill('E2E test region');
  await expect(page.getByTestId('region-build')).toBeEnabled();
  await page.getByTestId('region-build').click();

  const dialog = page.getByTestId('region-save-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('Save this region?');
  await expect(page.getByTestId('region-build-status')).toHaveCount(0);

  // stop here: cancel without building
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId('region-build-status')).toHaveCount(0);

  // clean up: the section lists the items, and the confirm dialog is cancelled here. A test never deletes real files.
  await expect(page.getByTestId('region-cleanup')).toBeVisible();
  await expect(page.getByTestId('cleanup-downloads')).not.toBeChecked();
  await page.getByTestId('cleanup-downloads').check();
  await page.getByTestId('cleanup-run').click();
  await expect(page.getByText('Delete these files?')).toBeVisible();
  await expect(page.getByText('This cannot be undone')).toBeVisible();
  await page.getByTestId('confirm-cancel').click();
  await expect(page.getByText('Delete these files?')).toBeHidden();
  await expect(page.getByTestId('cleanup-result')).toHaveCount(0);

  expect(log.errors).toEqual([]);
});

// Deleting one region from the list: the test makes its own fixture (a ZIP and a region folder with a unique name,
// both removed again at the end) and deletes it through the page. No other file is touched.
test('desktop: delete one region (its ZIP and build folder) from the list', async ({ page }) => {
  const id = 'e2e-delete-fixture';
  const zip = path.join(ROOT, 'build/pwa-map-data', `${id}-2026-11-21-z14.zip`);
  const folder = path.join(ROOT, 'build/regions', id);
  fs.mkdirSync(path.join(folder, 'planner'), { recursive: true });
  fs.writeFileSync(path.join(folder, 'planner', 'fixture.json'), '{}');
  fs.writeFileSync(zip, 'PK fixture');
  try {
    const log = collectErrors(page);
    await page.goto('/?e2e');
    await waitForMap(page);
    await page.getByTestId('menu-button').click();
    await page.getByTestId('menu-row-regions').click();
    await expect(page.getByTestId('region-builder')).toBeVisible();

    await page.getByTestId(`zip-delete-${id}-2026-11-21-z14.zip`).click();
    await expect(page.getByText(`Delete region “${id}”?`)).toBeVisible();
    await page.getByTestId('confirm-ok').click();

    await expect(page.getByTestId('cleanup-result')).toContainText(`Deleted ${id}-2026-11-21-z14.zip`);
    expect(fs.existsSync(zip)).toBe(false);
    expect(fs.existsSync(folder)).toBe(false);
    expect(log.errors).toEqual([]);
  } finally {
    fs.rmSync(zip, { force: true });
    fs.rmSync(folder, { recursive: true, force: true });
  }
});
