#!/usr/bin/env node
// npm run dev:desktop — Vite dev server (hot reload, http://localhost:5173) + desktop server (data and API on
// 8081, proxied by Vite) + TileServer GL (gpx.studio links). Ctrl+C stops all three. See docs/pwa-plan.md §2.1.
import fs from 'node:fs';
import path from 'node:path';
import { launch } from './lib/launch.mjs';
import { defaultMapDir } from './lib/map-folder.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const commands = [
  { name: 'vite', color: 32, cmd: 'npx', args: ['vite', '--config', 'app/vite.config.ts', '--mode', 'desktop'] },
  { name: 'server', color: 35, cmd: 'node', args: ['server/server.mjs'] },
];
if (fs.existsSync(path.join(defaultMapDir(path.join(ROOT, 'build'), ROOT), 'tileserver/config.json'))) {
  commands.push({ name: 'tiles', color: 36, cmd: 'node', args: ['scripts/tiles.mjs'], optional: true, hint: 'TileServer GL stopped: the app works, only the gpx.studio links need it.' });
} else {
  console.warn('No map data (tileserver/config.json): TileServer GL is not started. Run "npm run build" for map data.');
}
launch(commands, { cwd: ROOT });
