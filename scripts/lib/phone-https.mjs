// HTTPS on the local network for testing on the iPhone (`npm run dev:pwa -- --phone`, `npm run preview:pwa -- --phone`).
// Location, storage and the service worker need HTTPS (or localhost, which the phone cannot use for the Mac).
// The certificate comes from mkcert (https://github.com/FiloSottile/mkcert): it creates a local certificate
// authority once; the iPhone trusts it after you install its root certificate (see phoneHelp()).
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** IPv4 addresses of this computer on the local network (not loopback, not link-local). */
export function lanAddresses(interfaces = os.networkInterfaces()) {
  const out = [];
  for (const list of Object.values(interfaces)) {
    for (const a of list ?? []) {
      const v4 = a.family === 'IPv4' || a.family === 4;
      if (v4 && !a.internal && !a.address.startsWith('169.254.')) out.push(a.address);
    }
  }
  return [...new Set(out)];
}

/** Names the certificate must cover: localhost, the Bonjour name (<host>.local) and the LAN addresses. */
export function certHosts(hostname = os.hostname(), addresses = lanAddresses()) {
  const short = hostname.replace(/\.local$/i, '').split('.')[0];
  const names = ['localhost', '127.0.0.1', '::1'];
  if (short) names.push(`${short}.local`);
  return [...new Set([...names, ...addresses])];
}

/** Path of the mkcert program, or null when it is not installed. */
export function findMkcert(run = spawnSync) {
  const r = run('mkcert', ['-help'], { encoding: 'utf8' });
  return r.error || r.status === null ? null : 'mkcert';
}

export const MKCERT_MISSING = [
  'mkcert is not installed. It makes the HTTPS certificate the iPhone needs.',
  '',
  'On the Mac (once):',
  '  brew install mkcert',
  '  mkcert -install',
  '',
  'Then run the command again. Without --phone, the app runs on http://localhost only.',
].join('\n');

/**
 * Makes (or reuses) a certificate for `hosts` in `dir`. A new one is made when the list of names changed, e.g.
 * on another Wi-Fi network. Returns { cert, key } file paths. Throws with a clear message when mkcert fails.
 */
export function ensureCert(dir, hosts, run = spawnSync) {
  fs.mkdirSync(dir, { recursive: true });
  const cert = path.join(dir, 'phone-cert.pem');
  const key = path.join(dir, 'phone-key.pem');
  const list = path.join(dir, 'phone-hosts.txt');
  const want = hosts.join(' ');
  if (fs.existsSync(cert) && fs.existsSync(key) && fs.existsSync(list) && fs.readFileSync(list, 'utf8') === want) return { cert, key, created: false };
  const r = run('mkcert', ['-cert-file', cert, '-key-file', key, ...hosts], { encoding: 'utf8' });
  if (r.error || r.status !== 0) {
    throw new Error(`mkcert could not make the certificate:\n${(r.stderr || r.error?.message || '').trim()}`);
  }
  fs.writeFileSync(list, want);
  return { cert, key, created: true };
}

/** Folder of mkcert's root certificate (rootCA.pem), or null. */
export function mkcertCaRoot(run = spawnSync) {
  const r = run('mkcert', ['-CAROOT'], { encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : null;
}

/** What to print: the URLs to open on the iPhone and the one-time trust steps. */
export function phoneHelp({ port, hosts, caRoot }) {
  const urls = hosts.filter((h) => h !== 'localhost' && h !== '127.0.0.1' && h !== '::1').map((h) => `  https://${h}:${port}/`);
  return [
    '',
    'Open on your iPhone (same Wi-Fi as this computer):',
    ...(urls.length ? urls : ['  (no network address found: is Wi-Fi on?)']),
    '',
    'First time only, so the iPhone trusts the certificate:',
    `  1. Send ${caRoot ? path.join(caRoot, 'rootCA.pem') : 'rootCA.pem (folder: mkcert -CAROOT)'} to the iPhone with AirDrop.`,
    '  2. iPhone: Settings › General › VPN & Device Management › install the "mkcert" profile.',
    '  3. iPhone: Settings › General › About › Certificate Trust Settings › turn on full trust for mkcert.',
    '',
  ].join('\n');
}
