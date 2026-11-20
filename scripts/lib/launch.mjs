// Starts several commands together with coloured prefixes; when one stops (or on Ctrl+C) all stop.
// Commands marked `optional` may stop alone (e.g. TileServer GL, only needed for gpx.studio links).
// Each command runs in its own process group, so stopping it also stops what `npm run` started below it.
import { spawn } from 'node:child_process';

export function launch(commands, { cwd }) {
  const children = [];
  let stopping = false;
  const shutdown = (code) => {
    if (stopping) return;
    stopping = true;
    for (const c of children) if (c.exitCode === null) killGroup(c);
    setTimeout(() => process.exit(code), 500);
  };
  for (const { name, cmd, args, color, env, optional = false, hint } of commands) {
    const child = spawn(cmd, args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ...env },
      detached: process.platform !== 'win32',
    });
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
      if (stopping) return;
      console.log(`${prefix}exited with code ${code}`);
      if (optional) {
        if (hint) console.log(`${prefix}${hint}`);
        return;
      }
      shutdown(code ?? 0);
    });
    children.push(child);
  }
  process.on('SIGINT', () => shutdown(0));
  process.on('SIGTERM', () => shutdown(0));
}

function killGroup(child) {
  try {
    if (process.platform === 'win32') child.kill('SIGTERM');
    else process.kill(-child.pid, 'SIGTERM');
  } catch {
    // already gone
  }
}

export const npmRun = (script, extra = []) => ({ cmd: 'npm', args: ['run', '--silent', script, ...(extra.length ? ['--', ...extra] : [])] });
