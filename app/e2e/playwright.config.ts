// Smoke tests of both builds in Chromium (desktop window and iPhone size). Run with `npm run test:e2e`, which
// builds both targets first. Screenshots go to docs/agents/screenshots/phase3/ and phase4b/.
import os from 'node:os';
import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';

const DESKTOP_PORT = 8093;
const PWA_PORT = 4175;
const iphone = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true };
const wide = { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 };

export default defineConfig({
  testDir: '.',
  outputDir: path.join(os.tmpdir(), 'openskimap-e2e-results'),
  timeout: 180_000,
  expect: { timeout: 60_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    ...devices['Desktop Chrome'],
    // WebGL in headless Chromium without a GPU
    launchOptions: { args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] },
  },
  projects: [
    { name: 'desktop-wide', testMatch: ['desktop.spec.ts', 'route.spec.ts', 'explore.spec.ts', 'location.spec.ts'], use: { ...wide, baseURL: `http://127.0.0.1:${DESKTOP_PORT}` } },
    { name: 'desktop-iphone', testMatch: ['desktop.spec.ts', 'route.spec.ts', 'explore.spec.ts', 'location.spec.ts'], use: { ...iphone, baseURL: `http://127.0.0.1:${DESKTOP_PORT}` } },
    { name: 'pwa-wide', testMatch: ['pwa.spec.ts', 'pwa-data.spec.ts', 'route.spec.ts', 'explore.spec.ts', 'location.spec.ts'], use: { ...wide, baseURL: `http://127.0.0.1:${PWA_PORT}` } },
    { name: 'pwa-iphone', testMatch: ['pwa.spec.ts', 'pwa-data.spec.ts', 'route.spec.ts', 'explore.spec.ts', 'location.spec.ts'], use: { ...iphone, baseURL: `http://127.0.0.1:${PWA_PORT}` } },
  ],
  webServer: [
    {
      command: `node server/server.mjs`,
      cwd: '../..',
      env: { PORT: String(DESKTOP_PORT), PLANNER_SERVER_ROUTES: '0' },
      url: `http://127.0.0.1:${DESKTOP_PORT}/api/capabilities`,
      reuseExistingServer: false,
    },
    {
      command: `node app/e2e/static-server.mjs app/dist ${PWA_PORT}`,
      cwd: '../..',
      url: `http://127.0.0.1:${PWA_PORT}/`,
      reuseExistingServer: false,
    },
  ],
});
