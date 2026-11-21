#!/usr/bin/env node
// npm run tiles — TileServer GL (port 8080) for the resorts.json map: build/regions/<resort id>/tileserver/config.json.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { defaultMapDir } from './lib/map-folder.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const config = path.join(defaultMapDir(path.join(ROOT, 'build'), ROOT), 'tileserver/config.json');
if (!fs.existsSync(config)) {
  console.error(`${path.relative(ROOT, config)} not found. Run "npm run build" first.`);
  process.exit(1);
}
const child = spawn('tileserver-gl', ['--config', config, '--bind', '127.0.0.1', '--port', '8080'], { stdio: 'inherit', cwd: ROOT });
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill(sig));
child.on('exit', (code) => process.exit(code ?? 0));
