/// <reference types="vitest/config" />
// Vite config for both builds. The target comes from the mode: `--mode pwa` or `--mode desktop` (default desktop).
// See docs/pwa-plan.md §2.1 and docs/agents/decisions.md (phase 3).
import fs from 'node:fs';
import path from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

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

export default defineConfig(({ mode }) => {
  const target = targetOf(mode);
  return {
    root: APP,
    publicDir: path.join(APP, 'public'),
    plugins: [svelte(), devDataZip()],
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
      fs: { allow: [ROOT] },
      proxy:
        target === 'desktop'
          ? { '/api': DESKTOP_SERVER, '/data': DESKTOP_SERVER }
          : undefined,
    },
    preview: { port: target === 'pwa' ? 4174 : 4173, strictPort: true },
    test: {
      root: APP,
      include: ['test/**/*.test.ts'],
      environment: 'node',
    },
  };
});
