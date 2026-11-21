/// <reference types="vitest/config" />
// Vite config for both builds. The target comes from the mode: `--mode pwa` or `--mode desktop` (default desktop).
// See docs/pwa-plan.md §2.1 and docs/agents/decisions.md (phase 3).
import fs from 'node:fs';
import path from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { VitePWA, type VitePWAOptions } from 'vite-plugin-pwa';

const APP = import.meta.dirname;
const ROOT = path.resolve(APP, '..');
const DESKTOP_SERVER = process.env.DESKTOP_SERVER_URL ?? 'http://127.0.0.1:8081';
const VERSION = (JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as { version: string }).version;

type Target = 'pwa' | 'desktop';

function targetOf(mode: string): Target {
  if (mode === 'pwa' || mode === 'desktop') return mode;
  return process.env.VITE_TARGET === 'pwa' ? 'pwa' : 'desktop';
}

/** Newest data ZIP in build/pwa/ (by modification time), or null. */
export function newestDataZip(dir = path.join(ROOT, 'build/pwa')): { file: string; size: number } | null {
  if (!fs.existsSync(dir)) return null;
  const zips = fs
    .readdirSync(dir)
    .filter((n) => n.endsWith('.zip'))
    .map((n) => ({ file: path.join(dir, n), stat: fs.statSync(path.join(dir, n)) }))
    .sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs);
  return zips[0] ? { file: zips[0].file, size: zips[0].stat.size } : null;
}

/** Dev server only: GET /__dev/pwa-data serves the newest ZIP from build/pwa/ ("Load data from build/"). */
function devDataZip(): Plugin {
  return {
    name: 'dev-data-zip',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__dev/pwa-data', (req, res) => {
        const zip = newestDataZip();
        if (!zip) {
          res.statusCode = 404;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: 'No data ZIP in build/pwa/. Run npm run build:pwa-data first.' }));
          return;
        }
        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Length', String(zip.size));
        res.setHeader('X-File-Name', path.basename(zip.file));
        res.setHeader('Cache-Control', 'no-store');
        if (req.method === 'HEAD') return void res.end();
        fs.createReadStream(zip.file).pipe(res);
      });
    },
  };
}

/** Name shown by the app (no-data screen, title) and on the home screen. */
export const APP_NAME = 'Ski route planner';
export const APP_SHORT_NAME = 'Ski planner';
/** Light / dark page colour (tokens.css --bg-grouped) */
export const THEME = { light: '#f2f2f7', dark: '#1c1c1e' };

/** Hosts the app talks to only in online mode. The service worker never caches them (network only). */
export const ONLINE_ONLY_HOSTS = [
  'tile.openstreetmap.org',
  'tiles.opensnowmap.org',
  'tiles.openfreemap.org',
  'tiles.mapterhorn.com',
  'protomaps.github.io',
  'nominatim.openstreetmap.org',
];

export function onlineOnlyPattern(): RegExp {
  return new RegExp(`^https://(${ONLINE_ONLY_HOSTS.map((h) => h.replace(/\./g, '\\.')).join('|')})/`);
}

/**
 * Service worker + web app manifest, PWA build only (docs/pwa-plan.md §6, phase 5). The worker precaches the app
 * shell (HTML, JS incl. the MapLibre, routing and import workers, CSS, icons, manifest). It never caches the
 * imported data: that lives in OPFS and is read as files, not fetched. Online maps and Nominatim are network only.
 * Updates wait for the user ("New version available · Reload", see src/lib/pwa/register.ts).
 */
export function pwaOptions(): Partial<VitePWAOptions> {
  return {
    registerType: 'prompt',
    injectRegister: false, // src/lib/pwa/register.ts registers it (with workbox-window)
    filename: 'sw.js',
    manifestFilename: 'manifest.webmanifest',
    manifest: {
      id: '/',
      name: APP_NAME,
      short_name: APP_SHORT_NAME,
      description: 'Plan ski routes on the piste map, also offline.',
      lang: 'en',
      start_url: '/',
      scope: '/',
      display: 'standalone',
      orientation: 'any',
      background_color: THEME.light,
      theme_color: THEME.light,
      icons: [
        { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
        { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
        { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        { src: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' },
      ],
    },
    workbox: {
      globPatterns: ['**/*.{html,js,mjs,css,svg,png,webmanifest,woff2}'],
      // MapLibre makes the main chunk ~1.3 MB
      maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
      navigateFallback: '/index.html',
      navigateFallbackDenylist: [/^\/__dev\//, /^\/api\//, /^\/data\//],
      cleanupOutdatedCaches: true,
      clientsClaim: true, // the first visit is controlled at once, so the next start works offline
      skipWaiting: false, // updates wait for "Reload"
      runtimeCaching: [
        {
          // a RegExp, not a function: Workbox writes the pattern into sw.js as text (a closure would lose the list)
          urlPattern: onlineOnlyPattern(),
          handler: 'NetworkOnly',
        },
      ],
    },
    devOptions: { enabled: false }, // no worker in dev:pwa (hot reload)
  };
}

/** HTTPS certificate from `scripts/dev-pwa.mjs --phone` (mkcert), or undefined for plain http. */
function phoneHttps(): { cert: Buffer; key: Buffer } | undefined {
  const cert = process.env.PWA_HTTPS_CERT;
  const key = process.env.PWA_HTTPS_KEY;
  return cert && key ? { cert: fs.readFileSync(cert), key: fs.readFileSync(key) } : undefined;
}

export default defineConfig(({ mode }) => {
  const target = targetOf(mode);
  return {
    root: APP,
    publicDir: path.join(APP, 'public'),
    plugins: [svelte(), devDataZip(), ...(target === 'pwa' ? [VitePWA(pwaOptions())] : [])],
    resolve: { alias: { '@core': path.join(ROOT, 'packages/core/src') } },
    define: { 'import.meta.env.VITE_TARGET': JSON.stringify(target), 'import.meta.env.VITE_APP_VERSION': JSON.stringify(VERSION) },
    worker: { format: 'es' },
    build: {
      outDir: path.join(APP, target === 'pwa' ? 'dist' : 'dist-desktop'),
      emptyOutDir: true,
      target: 'es2022',
      sourcemap: target === 'desktop',
      chunkSizeWarningLimit: 1500, // MapLibre alone is ~1 MB minified
    },
    server: {
      port: target === 'pwa' ? 5174 : 5173,
      strictPort: true,
      https: phoneHttps(),
      fs: { allow: [ROOT] },
      proxy:
        target === 'desktop'
          ? { '/api': DESKTOP_SERVER, '/data': DESKTOP_SERVER }
          : undefined,
    },
    preview: { port: target === 'pwa' ? 4174 : 4173, strictPort: true, https: phoneHttps() },
    test: {
      root: APP,
      include: ['test/**/*.test.ts'],
      environment: 'node',
    },
  };
});
