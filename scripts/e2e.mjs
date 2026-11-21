#!/usr/bin/env node
// npm run test:e2e — builds both targets, checks that dev-only code is not in the PWA bundle, then runs the
// Playwright smoke tests (app/e2e/). Extra arguments go to Playwright, e.g. `npm run test:e2e -- --project=pwa-iphone`.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const run = (cmd, args) => {
  const r = spawnSync(cmd, args, { cwd: ROOT, stdio: 'inherit' });
  if (r.status !== 0) process.exit(r.status ?? 1);
};

if (!fs.existsSync(path.join(ROOT, 'build/planner/resorts.json')) || !fs.readdirSync(path.join(ROOT, 'build/pwa')).some((n) => n.endsWith('.zip'))) {
  console.error('The smoke tests need real data: run npm run build and npm run build:pwa-data first.');
  process.exit(1);
}
run('npm', ['run', '--silent', 'build:desktop']);
run('npm', ['run', '--silent', 'build:pwa']);

// dev-only helpers (dev overlay, "Load data from build/") must be tree-shaken out of production bundles
for (const dist of ['app/dist', 'app/dist-desktop']) {
  const assets = path.join(ROOT, dist, 'assets');
  for (const f of fs.readdirSync(assets).filter((n) => n.endsWith('.js'))) {
    const text = fs.readFileSync(path.join(assets, f), 'utf8');
    for (const needle of ['__dev/pwa-data', 'Dev tools', 'Load data from build/']) {
      if (text.includes(needle)) {
        console.error(`${dist}/assets/${f} contains dev-only code ("${needle}")`);
        process.exit(1);
      }
    }
  }
}
console.log('Production bundles contain no dev-only code.');

// the desktop build must never have a service worker or a web app manifest (phase 5)
for (const f of ['sw.js', 'manifest.webmanifest']) {
  if (fs.existsSync(path.join(ROOT, 'app/dist-desktop', f))) {
    console.error(`app/dist-desktop/${f} exists: the desktop build must not have a service worker`);
    process.exit(1);
  }
  if (!fs.existsSync(path.join(ROOT, 'app/dist', f))) {
    console.error(`app/dist/${f} is missing: the PWA build needs it`);
    process.exit(1);
  }
}
for (const f of fs.readdirSync(path.join(ROOT, 'app/dist-desktop/assets')).filter((n) => n.endsWith('.js'))) {
  if (/workbox|serviceWorker\.register/.test(fs.readFileSync(path.join(ROOT, 'app/dist-desktop/assets', f), 'utf8'))) {
    console.error(`app/dist-desktop/assets/${f} contains service worker code`);
    process.exit(1);
  }
}
console.log('Only the PWA build has a service worker.');

run('npx', ['playwright', 'test', '--config', 'app/e2e/playwright.config.ts', '--trace', 'off', ...process.argv.slice(2)]);
