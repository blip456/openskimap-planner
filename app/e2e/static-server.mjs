// Serves a built app folder statically (like Vercel will), for the PWA smoke tests. Usage: node static-server.mjs <dir> <port>
import http from 'node:http';
import path from 'node:path';
import { safeJoin, sendFile } from '../../server/files.mjs';

const [dir, port] = [path.resolve(process.argv[2] ?? 'app/dist-pwa'), Number(process.argv[3] ?? 4175)];
http
  .createServer((req, res) => {
    const pathname = new URL(req.url ?? '/', 'http://x').pathname;
    const file = safeJoin(dir, pathname === '/' ? 'index.html' : pathname);
    if (file && sendFile(req, res, file)) return;
    res.writeHead(404).end('Not found');
  })
  .listen(port, '127.0.0.1', () => console.log(`static ${dir} on http://127.0.0.1:${port}`));
