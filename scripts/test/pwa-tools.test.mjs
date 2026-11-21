// Phase 5 tools: icons from the logo, HTTPS for the phone (mkcert), Vercel config.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { ICONS, logoVariants } from '../icons.mjs';
import { MKCERT_MISSING, certHosts, ensureCert, findMkcert, lanAddresses, phoneHelp } from '../lib/phone-https.mjs';

const ROOT = path.resolve(import.meta.dirname, '../..');

test('icons: every icon exists in app/public with the right size (run npm run icons after changing the logo)', async () => {
  const logo = fs.readFileSync(path.join(ROOT, 'app/public/logo.svg'), 'utf8');
  const v = logoVariants(logo);
  assert.ok(!/rx="114"/.test(v.fullBleed), 'full-bleed icon has no rounded corners');
  assert.match(v.maskable, /scale\(0\.72\)/);
  for (const icon of ICONS) {
    const meta = await sharp(path.join(ROOT, 'app/public', icon.file)).metadata();
    assert.equal(meta.width, icon.size, icon.file);
    assert.equal(meta.height, icon.size, icon.file);
    if (icon.opaque) assert.equal(meta.hasAlpha, false, `${icon.file} must be opaque (iOS shows black behind transparent icons)`);
  }
});

test('phone https: LAN addresses skip loopback, link-local and IPv6', () => {
  const nets = {
    lo: [{ address: '127.0.0.1', family: 'IPv4', internal: true }],
    en0: [
      { address: '192.168.1.20', family: 'IPv4', internal: false },
      { address: 'fe80::1', family: 'IPv6', internal: false },
    ],
    awdl: [{ address: '169.254.3.4', family: 'IPv4', internal: false }],
  };
  assert.deepEqual(lanAddresses(nets), ['192.168.1.20']);
  assert.deepEqual(certHosts('Peters-MacBook.local', ['192.168.1.20']), ['localhost', '127.0.0.1', '::1', 'Peters-MacBook.local', '192.168.1.20']);
});

test('phone https: a clear message when mkcert is missing', () => {
  const missing = () => ({ error: Object.assign(new Error('spawn mkcert ENOENT'), { code: 'ENOENT' }), status: null });
  assert.equal(findMkcert(missing), null);
  assert.match(MKCERT_MISSING, /brew install mkcert/);
  assert.match(MKCERT_MISSING, /mkcert -install/);
});

test('phone https: the certificate is made once per list of names', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'certs-'));
  const calls = [];
  const run = (cmd, args) => {
    calls.push(args);
    fs.writeFileSync(args[1], 'cert');
    fs.writeFileSync(args[3], 'key');
    return { status: 0, stdout: '', stderr: '' };
  };
  const a = ensureCert(dir, ['localhost', '192.168.1.20'], run);
  assert.equal(a.created, true);
  assert.deepEqual(calls[0].slice(4), ['localhost', '192.168.1.20']);
  assert.equal(ensureCert(dir, ['localhost', '192.168.1.20'], run).created, false);
  assert.equal(ensureCert(dir, ['localhost', '10.0.0.5'], run).created, true); // other Wi-Fi
  assert.throws(() => ensureCert(dir, ['x'], () => ({ status: 1, stderr: 'no CA' })), /no CA/);
  fs.rmSync(dir, { recursive: true });
});

test('phone https: help text has the LAN URLs and the trust steps', () => {
  const text = phoneHelp({ port: 5174, hosts: ['localhost', '127.0.0.1', '::1', 'mac.local', '192.168.1.20'], caRoot: '/ca' });
  assert.match(text, /https:\/\/mac\.local:5174\//);
  assert.match(text, /https:\/\/192\.168\.1\.20:5174\//);
  assert.ok(!text.includes('https://localhost'));
  assert.match(text, /\/ca\/rootCA\.pem/);
  assert.match(text, /Certificate Trust Settings/);
});

test('vercel.json: PWA build, SPA fallback, cache headers, manifest type, no functions', () => {
  const v = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
  assert.equal(v.buildCommand, 'npm run build:pwa');
  assert.equal(v.outputDirectory, 'app/dist-pwa');
  assert.equal(v.functions, undefined);
  assert.ok(!fs.existsSync(path.join(ROOT, 'api')), 'no serverless functions folder');
  const header = (source, key) => v.headers.find((h) => h.source === source)?.headers.find((x) => x.key === key)?.value;
  for (const src of ['/sw.js', '/index.html', '/', '/manifest.webmanifest']) assert.equal(header(src, 'Cache-Control'), 'no-cache', src);
  assert.match(header('/assets/(.*)', 'Cache-Control'), /max-age=31536000, immutable/);
  assert.equal(header('/manifest.webmanifest', 'Content-Type'), 'application/manifest+json');
  // SPA fallback for app paths, but not for missing assets / the service worker
  const re = new RegExp(`^${v.rewrites[0].source.replace('/(', '/(')}$`);
  assert.equal(v.rewrites[0].destination, '/index.html');
  assert.ok(re.test('/some/page'));
  assert.ok(!re.test('/assets/index-abc.js'));
  assert.ok(!re.test('/sw.js'));
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.ok(pkg.scripts['build:pwa'], 'build:pwa script exists');
});
