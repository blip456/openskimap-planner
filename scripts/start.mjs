#!/usr/bin/env node
// Desktop: TileServer GL (for gpx.studio) + the desktop server with the desktop build of the app. Ctrl+C stops both.
// Builds the desktop app first (about 2 s), so it always matches the code.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { launch, npmRun } from './lib/launch.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
if (!fs.existsSync(path.join(ROOT, 'build/regions/default/tileserver/config.json'))) {
  console.error('build/regions/default/tileserver/config.json not found. Run "npm run build" first.');
  process.exit(1);
}
console.log('Building the desktop app (npm run build:desktop)…');
const r = spawnSync('npm', ['run', '--silent', 'build:desktop', '--', '--logLevel', 'warn'], { cwd: ROOT, stdio: 'inherit' });
if (r.status !== 0) process.exit(r.status ?? 1);

launch(
  [
    { name: 'tiles', color: 36, ...npmRun('tiles'), optional: true, hint: 'TileServer GL stopped: the app works, only the gpx.studio links need it.' },
    { name: 'server', color: 35, ...npmRun('server') },
  ],
  { cwd: ROOT },
);
