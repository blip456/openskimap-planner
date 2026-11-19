#!/usr/bin/env node
// Starts the tile server and the route planner together. Ctrl+C stops both.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
if (!fs.existsSync(path.join(ROOT, 'build/tileserver/config.json'))) {
  console.error('build/tileserver/config.json not found. Run "npm run build" first.');
  process.exit(1);
}

const children = [];
function start(name, script, color) {
  const child = spawn('npm', ['run', '--silent', script], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  const prefix = `\x1b[${color}m[${name}]\x1b[0m `;
  const forward = (stream, out) => {
    let buf = '';
    stream.on('data', (d) => {
      buf += d;
      const lines = buf.split('\n');
      buf = lines.pop();
      // tileserver-gl's native deps print a harmless duplicate-class warning on macOS
      for (const line of lines) if (!line.startsWith('objc[')) out.write(prefix + line + '\n');
    });
  };
  forward(child.stdout, process.stdout);
  forward(child.stderr, process.stderr);
  child.on('exit', (code) => {
    console.log(`${prefix}exited with code ${code}`);
    shutdown(code ?? 0);
  });
  children.push(child);
}

let stopping = false;
function shutdown(code) {
  if (stopping) return;
  stopping = true;
  for (const c of children) c.kill('SIGTERM');
  setTimeout(() => process.exit(code), 500);
}
process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

start('tiles', 'tiles', 36);
start('planner', 'planner', 35);
