#!/usr/bin/env node
// npm run dev:pwa [-- --phone]      Vite dev server of the PWA (http://localhost:5174). No service worker.
// npm run preview:pwa [-- --phone]  builds the PWA, then serves app/dist-pwa with the service worker (http://localhost:4174).
//
// --phone: HTTPS on the local network with a certificate from mkcert, so the iPhone can open it (plan §2.1).
// Other arguments go to Vite.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { MKCERT_MISSING, certHosts, ensureCert, findMkcert, mkcertCaRoot, phoneHelp } from './lib/phone-https.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
const preview = args.includes('--preview');
const phone = args.includes('--phone');
const rest = args.filter((a) => a !== '--preview' && a !== '--phone');
const port = preview ? 4174 : 5174;

const env = { ...process.env };
const viteArgs = [...(preview ? ['preview'] : []), '--config', 'app/vite.config.ts', '--mode', 'pwa', ...rest];

if (phone) {
  if (!findMkcert()) {
    console.error(`\n${MKCERT_MISSING}\n`);
    process.exit(1);
  }
  const hosts = certHosts();
  let files;
  try {
    files = ensureCert(path.join(ROOT, 'build/certs'), hosts);
  } catch (err) {
    console.error(`\n${err.message}\n\nRun "mkcert -install" once, then try again.\n`);
    process.exit(1);
  }
  if (files.created) console.log(`Made a new certificate for: ${hosts.join(', ')}`);
  env.PWA_HTTPS_CERT = files.cert;
  env.PWA_HTTPS_KEY = files.key;
  viteArgs.push('--host', '0.0.0.0');
  console.log(phoneHelp({ port, hosts, caRoot: mkcertCaRoot() }));
  if (!preview) console.log('Note: the service worker is off in dev:pwa. Use "npm run preview:pwa -- --phone" to test install and offline.\n');
}

const child = spawn(process.execPath, [path.join(ROOT, 'node_modules/vite/bin/vite.js'), ...viteArgs], { cwd: ROOT, env, stdio: 'inherit' });
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill(sig));
child.on('exit', (code) => process.exit(code ?? 0));
