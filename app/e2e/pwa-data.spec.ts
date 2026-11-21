// Phase 5 (PWA build): offline start with the service worker, import errors, the Data screen (storage, persist,
// delete), the update prompt. Screenshots: docs/agents/screenshots/phase5/.
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { ROOT, addPoints, collectErrors, expectMapNotBlank, newestZip, routePoints, shot, waitForMap, waitForMapStill } from './common.ts';

const SHOTS = path.join(ROOT, 'docs/agents/screenshots/phase5');
const isWide = (page: Page) => (page.viewportSize()?.width ?? 0) >= 900;

async function tap(page: Page, testid: string, touch: boolean): Promise<void> {
  const el = page.getByTestId(testid);
  if (touch) await el.tap();
  else await el.click();
}

async function importZip(page: Page, file: string): Promise<void> {
  await page.getByTestId('import-input').setInputFiles(file);
  await waitForMap(page, 120_000);
}

/** Waits until the service worker is active and controls this page. */
async function waitForServiceWorker(page: Page): Promise<void> {
  await page.waitForFunction(async () => {
    const reg = await navigator.serviceWorker.getRegistration();
    return !!reg?.active && !!navigator.serviceWorker.controller;
  }, undefined, { timeout: 30_000 });
}

async function openData(page: Page, touch: boolean): Promise<void> {
  await tap(page, 'menu-button', touch);
  await expect(page.getByTestId('menu')).toBeVisible();
  await tap(page, 'menu-row-data', touch);
  await expect(page.getByTestId('menu')).toHaveAttribute('data-page', 'data');
}

/** A copy of the small data ZIP with one byte changed inside a tile file: the checksum check must catch it. */
function damagedZip(): string {
  const src = fs.readdirSync(path.join(ROOT, 'build/pwa-map-data')).filter((n) => /-z12\.zip$/.test(n)).sort().pop();
  const bytes = fs.readFileSync(src ? path.join(ROOT, 'build/pwa-map-data', src) : newestZip());
  bytes[Math.floor(bytes.length / 2)] ^= 0xff;
  const out = path.join(os.tmpdir(), 'openskimap-damaged.zip');
  fs.writeFileSync(out, bytes);
  return out;
}

function notAZip(): string {
  const out = path.join(os.tmpdir(), 'holiday-photos.zip');
  fs.writeFileSync(out, 'This is a text file with a .zip name, not a data file.');
  return out;
}

test('offline start: after the first visit the app, map and routing work without network', async ({ page, context, isMobile }, info) => {
  const log = collectErrors(page);
  await page.goto('/?e2e');
  await expect(page.getByTestId('no-data')).toBeVisible();
  await waitForServiceWorker(page);
  await importZip(page, newestZip());
  await expect.poll(() => log.infos.some((t) => t.startsWith('[routing]'))).toBe(true);

  // airplane mode, then start the app again
  await context.setOffline(true);
  expect(await page.evaluate(() => navigator.onLine)).toBe(false);
  await page.reload();
  await waitForMap(page, 60_000);
  await expect(page.getByTestId('no-data')).toHaveCount(0);
  await expectMapNotBlank(page);
  // the page really came from the service worker cache
  expect(await page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);

  // routing works from the data in OPFS
  // (not the "[routing]" log line: it can come before this line runs, see lessons.md)
  await expect.poll(() => page.evaluate(() => (window as unknown as { __app: { routingReady: boolean } }).__app.routingReady)).toBe(true);
  await page.getByTestId('plan-button').click();
  await addPoints(page, routePoints(), isMobile);
  await expect(page.getByTestId('route-summary')).toContainText('km');
  await waitForMapStill(page);
  await shot(page, info, 'offline-route', SHOTS);

  // search works offline (local names), and says why there is no online search
  if (!isWide(page)) {
    await tap(page, 'search-button', isMobile);
    await expect(page.getByTestId('search-overlay')).toBeVisible();
  }
  await page.getByTestId('search-input').fill('zzqqxx');
  await expect(page.getByTestId('search-footnote')).toBeVisible();

  await context.setOffline(false);
  // only the service worker's own update check may fail while offline
  expect(log.errors.filter((e) => !/service ?worker|sw\.js|Failed to fetch|ERR_INTERNET_DISCONNECTED/i.test(e))).toEqual([]);
});

test('import errors: wrong file and damaged file get a clear message; the first-run screen explains the steps', async ({ page, isMobile }, info) => {
  const log = collectErrors(page);
  await page.goto('/?e2e');
  await expect(page.getByTestId('no-data')).toBeVisible();
  await expect(page.getByTestId('first-run-steps')).toContainText('AirDrop');
  await expect(page.getByTestId('first-run-steps')).toContainText('npm run build:pwa-map-data');
  await shot(page, info, 'first-run', SHOTS);

  await page.getByTestId('import-input').setInputFiles(notAZip());
  await expect(page.getByTestId('import-error')).toHaveAttribute('data-code', 'not-data');
  await expect(page.getByTestId('import-error-title')).toHaveText('Wrong file');
  await expect(page.getByTestId('import-error')).toContainText('This is not a data file for this app.');
  await shot(page, info, 'error-wrong-file', SHOTS);

  await page.getByTestId('import-input').setInputFiles(damagedZip());
  await expect(page.getByTestId('import-error')).toHaveAttribute('data-code', 'damaged', { timeout: 90_000 });
  await expect(page.getByTestId('import-error-title')).toHaveText('The file is damaged');
  await shot(page, info, 'error-damaged', SHOTS);
  // nothing half-imported: still the first-run screen, and the import button still works
  await expect(page.getByTestId('no-data')).toBeVisible();
  await expect(page.getByTestId('import-button')).toBeEnabled();
  void isMobile;
  expect(log.errors).toEqual([]);
});

test('data screen: parts, storage, protection; delete data and import again', async ({ page, isMobile }, info) => {
  const log = collectErrors(page);
  const touch = isMobile;
  await page.goto('/?e2e');
  await importZip(page, newestZip());
  await expect.poll(() => log.infos.some((t) => t.startsWith('[routing]'))).toBe(true);

  await openData(page, touch);
  await expect(page.getByTestId('installed-data')).toContainText('Oberstdorf');
  const parts = page.getByTestId('data-parts');
  await expect(parts).toContainText('Base map');
  await expect(parts).toContainText('Terrain');
  await expect(parts).toContainText('Runs and lifts');
  await expect(page.getByTestId('data-total')).toHaveText(/\d+ MB/);
  await expect(page.getByTestId('storage-used')).toHaveText(/\d+ (KB|MB|GB)/);
  await expect(page.getByTestId('storage-persisted')).toHaveText(/On|Off|Unknown/);
  await expect(page.getByTestId('storage-note')).not.toBeEmpty();
  // the "Data imported" toast stays clear of the menu title (4b review): above the tab bar on the phone
  if (!isWide(page) && (await page.getByTestId('toast').count())) await expect(page.getByTestId('toast')).toHaveAttribute('data-placement', 'low');
  await page.waitForTimeout(400);
  await shot(page, info, 'data-screen', SHOTS);
  await page.getByTestId('storage').scrollIntoViewIfNeeded();
  await shot(page, info, 'data-screen-storage', SHOTS);

  // Delete data: asks first; Cancel keeps everything
  await page.getByTestId('delete-data').scrollIntoViewIfNeeded();
  await tap(page, 'delete-data', touch);
  await expect(page.getByTestId('confirm-dialog')).toBeVisible();
  await shot(page, info, 'delete-confirm', SHOTS);
  await tap(page, 'confirm-cancel', touch);
  await expect(page.getByTestId('confirm-dialog')).toHaveCount(0);
  await expect(page.getByTestId('menu')).toHaveAttribute('data-page', 'data');

  await tap(page, 'delete-data', touch);
  await tap(page, 'confirm-ok', touch);
  await expect(page.getByTestId('no-data')).toBeVisible();
  await expect(page.getByTestId('toast')).toContainText('Data deleted');
  const left = await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const dir = await root.getDirectoryHandle('openskimap', { create: true });
    const names: string[] = [];
    for await (const name of (dir as unknown as { keys(): AsyncIterable<string> }).keys()) names.push(name);
    return names;
  });
  expect(left).toEqual([]);
  // still no data after a reload
  await page.reload();
  await expect(page.getByTestId('no-data')).toBeVisible();

  // import again
  await importZip(page, newestZip());
  await expect(page.getByTestId('no-data')).toHaveCount(0);
  expect(log.errors).toEqual([]);
});

test('update prompt: a new version waits until the user taps Reload', async ({ page }, info) => {
  // a private copy of the build, so this test can publish a "new version" of sw.js
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pwa-update-'));
  fs.cpSync(path.join(ROOT, 'app/dist-pwa'), dir, { recursive: true });
  const types: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
  const server = http.createServer((req, res) => {
    const pathname = new URL(req.url ?? '/', 'http://x').pathname;
    const file = path.join(dir, pathname === '/' ? 'index.html' : path.normalize(pathname).replace(/^(\.\.[/\\])+/, ''));
    if (!file.startsWith(dir) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return void res.writeHead(404).end('Not found');
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(fs.readFileSync(file));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const log = collectErrors(page);
    await page.goto(`${base}/?e2e`);
    await expect(page.getByTestId('no-data')).toBeVisible();
    await waitForServiceWorker(page);
    await expect(page.getByTestId('update-prompt')).toHaveCount(0);
    await page.evaluate(() => ((window as unknown as { __before: boolean }).__before = true));

    // publish a new version and let the app find it
    fs.appendFileSync(path.join(dir, 'sw.js'), '\n// new version\n');
    await page.evaluate(async () => void (await (await navigator.serviceWorker.getRegistration())?.update()));
    await expect(page.getByTestId('update-prompt')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('update-prompt')).toContainText('New version available');
    // nothing reloads on its own
    await page.waitForTimeout(1000);
    expect(await page.evaluate(() => (window as unknown as { __before?: boolean }).__before)).toBe(true);
    await shot(page, info, 'update-prompt', SHOTS);

    const reloaded = page.waitForEvent('load', { timeout: 15_000 });
    await page.getByTestId('update-reload').click();
    await reloaded;
    expect(await page.evaluate(() => (window as unknown as { __before?: boolean }).__before)).toBeUndefined();
    await expect(page.getByTestId('no-data')).toBeVisible();
    await expect(page.getByTestId('update-prompt')).toHaveCount(0);
    expect(log.errors).toEqual([]);
  } finally {
    server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
