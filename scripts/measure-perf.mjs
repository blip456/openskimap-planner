#!/usr/bin/env node
// Performance numbers for the handover (phase 7): bundle sizes (gzip), time to the first map picture, routing worker
// start-up, and the frame rate while the map pans with and without a sheet open (glass and solid interface).
// Usage: npm run build:desktop && node scripts/measure-perf.mjs
// Runs the desktop build in headless Chromium with software WebGL (no GPU here), so frame rates are only useful
// compared with each other, not as real iPhone numbers.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { chromium } from '@playwright/test';

const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = 8097;

function bundleSizes(dir) {
  const assets = path.join(ROOT, dir, 'assets');
  if (!fs.existsSync(assets)) return null;
  const rows = fs
    .readdirSync(assets)
    .filter((n) => /\.(m?js|css)$/.test(n))
    .map((n) => {
      const buf = fs.readFileSync(path.join(assets, n));
      return { file: n, kb: Math.round(buf.length / 1024), gzipKb: Math.round(zlib.gzipSync(buf, { level: 9 }).length / 1024) };
    })
    .sort((a, b) => b.kb - a.kb);
  return rows;
}

for (const dir of ['app/dist-pwa', 'app/dist-desktop']) {
  const rows = bundleSizes(dir);
  if (!rows) continue;
  console.log(`\n${dir}/assets (KB, gzip KB):`);
  for (const r of rows) console.log(`  ${r.file.padEnd(44)} ${String(r.kb).padStart(6)} ${String(r.gzipKb).padStart(6)}`);
}

const server = spawn(process.execPath, ['server/server.mjs'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), PLANNER_SERVER_ROUTES: '0' }, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 800));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });

/** frames per second while the map pans for 2 s (requestAnimationFrame intervals) */
async function panFps(page) {
  return page.evaluate(
    () =>
      new Promise((resolve) => {
        const map = window.__map;
        const times = [];
        let run = true;
        const tick = (t) => {
          times.push(t);
          if (run) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
        map.panBy([300, 120], { duration: 2000, easing: (x) => x });
        setTimeout(() => {
          run = false;
          map.panBy([-300, -120], { animate: false });
          const gaps = times.slice(1).map((t, i) => t - times[i]).sort((a, b) => a - b);
          resolve({ fps: Math.round((1000 * gaps.length) / (times[times.length - 1] - times[0])), p95ms: Math.round(gaps[Math.floor(gaps.length * 0.95)]) });
        }, 2000);
      }),
  );
}

async function run(name, viewport, touch) {
  const page = await browser.newPage({ viewport, isMobile: touch, hasTouch: touch });
  let workerMs = null;
  page.on('console', (m) => {
    const hit = /ready in (\d+) ms/.exec(m.text());
    if (hit) workerMs = Number(hit[1]);
  });
  await page.goto(`http://127.0.0.1:${PORT}/?e2e`);
  await page.waitForFunction(() => window.__map?.loaded() && window.__map.areTilesLoaded(), null, { timeout: 120_000 });
  const firstMap = await page.evaluate(() => Math.round(performance.now()));
  await page.waitForFunction(() => window.__app?.routingReady, null, { timeout: 60_000 }).catch(() => {});
  await page.waitForTimeout(500);
  const results = { firstMapMs: firstMap, workerReadyMs: workerMs };
  results.panNoSheet = await panFps(page);
  if (touch) {
    await page.getByTestId('tab-map').tap();
    await page.waitForTimeout(800);
    results.panSheetGlass = await panFps(page);
    await page.evaluate(() => document.documentElement.setAttribute('data-solid', ''));
    await page.waitForTimeout(300);
    results.panSheetSolid = await panFps(page);
  }
  console.log(`\n${name}:`, JSON.stringify(results));
  await page.close();
}

try {
  await run('iPhone 390 × 844 (touch)', { width: 390, height: 844 }, true);
  await run('wide 1280 × 800 (mouse)', { width: 1280, height: 800 }, false);
} finally {
  await browser.close();
  server.kill();
}
