#!/usr/bin/env node
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { DEFAULT_OPTIONS, RouteError, SPEED_PRESETS, SkiNetwork, toGpx } from './graph.mjs';
import { SearchError, buildSearchIndex, geocode, resolveGoogleLink } from './search.mjs';
import { featureDetails } from './feature-info.mjs';
import { buildSkiAreas } from './ski-areas.mjs';
import { DEFAULT_FOLDER, RouteStore, StoreError, slug } from './routes-store.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const DATA = path.join(ROOT, 'build/planner');
const PUBLIC = path.join(ROOT, 'planner/public');
const PORT = Number(process.env.PLANNER_PORT ?? 8081);
const HOST = process.env.PLANNER_HOST ?? '127.0.0.1';
const TILESERVER_URL = process.env.TILESERVER_URL ?? 'http://localhost:8080';
// Saving routes in the project folder is for local use. Set PLANNER_SERVER_ROUTES=0 when hosting the site:
// visitors then only save routes in their own browser.
const SERVER_ROUTES = !['0', 'false', 'no', 'off'].includes(String(process.env.PLANNER_SERVER_ROUTES ?? '1').toLowerCase());
const store = SERVER_ROUTES ? new RouteStore(process.env.ROUTES_DIR ?? path.join(ROOT, 'saved-routes')) : null;

const STATIC = {
  '/': path.join(PUBLIC, 'index.html'),
  '/app.js': path.join(PUBLIC, 'app.js'),
  '/style.css': path.join(PUBLIC, 'style.css'),
  '/geoparse.js': path.join(PUBLIC, 'geoparse.js'),
  '/zip.js': path.join(PUBLIC, 'zip.js'),
  '/route-stores.js': path.join(PUBLIC, 'route-stores.js'),
  '/icon.svg': path.join(PUBLIC, 'icon.svg'),
  '/favicon.svg': path.join(PUBLIC, 'icon.svg'),
  '/favicon.ico': path.join(PUBLIC, 'favicon.ico'),
  '/apple-touch-icon.png': path.join(PUBLIC, 'apple-touch-icon.png'),
  '/icon-192.png': path.join(PUBLIC, 'icon-192.png'),
  '/icon-512.png': path.join(PUBLIC, 'icon-512.png'),
  '/manifest.webmanifest': path.join(PUBLIC, 'manifest.webmanifest'),
};
// MapLibre GL JS ships as ES modules (main, shared and worker files), served from node_modules.
const VENDOR = path.join(ROOT, 'node_modules/maplibre-gl/dist');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
};

function staticFile(pathname) {
  if (STATIC[pathname]) return STATIC[pathname];
  const m = pathname.match(/^\/vendor\/(maplibre-gl[\w.-]*\.(?:mjs|css|map))$/);
  return m ? path.join(VENDOR, m[1]) : null;
}

// Networks are cached and rebuilt automatically when `npm run build` rewrites the data file.
const cache = new Map();
function resortData(id) {
  if (!/^[\w-]+$/.test(id)) throw new RouteError('Invalid resort id');
  const file = path.join(DATA, `${id}.json`);
  if (!fs.existsSync(file)) throw new RouteError(`Unknown resort "${id}". Run npm run build first.`);
  const mtime = fs.statSync(file).mtimeMs;
  const hit = cache.get(id);
  if (hit && hit.mtime === mtime) return hit;
  const t = Date.now();
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  const net = new SkiNetwork(data);
  const searchIndex = buildSearchIndex(data);
  console.log(`Loaded ${id}: ${net.nodes.length} nodes, ${net.edges.length} edges, ${searchIndex.length} search entries (${Date.now() - t} ms)`);
  const entry = { mtime, net, searchIndex, data, bbox: data.bbox, skiAreas: null };
  cache.set(id, entry);
  return entry;
}

const network = (id) => resortData(id).net;

function resortViewbox(id) {
  try {
    return id ? resortData(id).bbox : undefined;
  } catch {
    return undefined;
  }
}

function send(res, status, body, type = 'application/json; charset=utf-8', extra = {}) {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', ...extra });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

async function readBody(req, limit = 1_000_000) {
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > limit) throw new RouteError('Request too large');
    chunks.push(c);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

function validatePoints(points) {
  if (!Array.isArray(points) || points.length < 2 || points.length > 25) {
    throw new RouteError('Provide between 2 and 25 points.');
  }
  return points.map((p) => {
    if (!Array.isArray(p) || p.length < 2 || !p.every(Number.isFinite)) throw new RouteError('Invalid point');
    return [p[0], p[1]];
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);
  try {
    const file = req.method === 'GET' ? staticFile(url.pathname) : null;
    if (file && fs.existsSync(file)) {
      return send(res, 200, fs.readFileSync(file), MIME[path.extname(file)] ?? 'application/octet-stream');
    }

    if (req.method === 'GET' && url.pathname === '/api/config') {
      const resorts = JSON.parse(fs.readFileSync(path.join(DATA, 'resorts.json'), 'utf8'));
      return send(res, 200, {
        tileserver: TILESERVER_URL,
        resorts,
        defaults: DEFAULT_OPTIONS,
        speedPresets: SPEED_PRESETS,
        serverRoutes: SERVER_ROUTES,
      });
    }

    if (req.method === 'GET' && url.pathname === '/api/search-index') {
      return send(res, 200, resortData(String(url.searchParams.get('resort') ?? '')).searchIndex);
    }

    if (req.method === 'GET' && url.pathname === '/api/ski-areas') {
      const entry = resortData(String(url.searchParams.get('resort') ?? ''));
      entry.skiAreas ??= buildSkiAreas(entry.data);
      return send(res, 200, entry.skiAreas);
    }

    if (req.method === 'GET' && url.pathname === '/api/feature') {
      const id = String(url.searchParams.get('id') ?? '');
      const preferred = String(url.searchParams.get('resort') ?? '');
      // the tiles contain all resorts, so fall back to the other resorts if needed
      const ids = JSON.parse(fs.readFileSync(path.join(DATA, 'resorts.json'), 'utf8')).map((r) => r.id);
      for (const resortId of [preferred, ...ids.filter((r) => r !== preferred)]) {
        if (!resortId) continue;
        const details = featureDetails(resortData(resortId).data, id);
        if (details) return send(res, 200, details);
      }
      return send(res, 404, { error: 'Feature not found' });
    }

    if (req.method === 'GET' && url.pathname === '/api/resolve') {
      const result = await resolveGoogleLink(url.searchParams.get('url'), resortViewbox(url.searchParams.get('resort')));
      return send(res, 200, result);
    }

    if (req.method === 'GET' && url.pathname === '/api/geocode') {
      const hits = await geocode(url.searchParams.get('q'), resortViewbox(url.searchParams.get('resort')));
      return send(res, 200, hits);
    }

    // --- saved routes in the project folder (optional) ----------------------
    if (url.pathname.startsWith('/api/routes') && !SERVER_ROUTES) {
      return send(res, 403, { error: 'Saving routes on the server is turned off. Routes are saved in your browser.' });
    }
    if (url.pathname === '/api/routes' && req.method === 'GET') {
      return send(res, 200, { folders: store.list(), defaultFolder: DEFAULT_FOLDER });
    }

    if (url.pathname === '/api/routes' && req.method === 'POST') {
      const body = await readBody(req);
      const resortId = String(body.resort ?? '');
      const net = network(resortId);
      const points = validatePoints(body.points);
      const options = body.options ?? {};
      const name = String(body.name || `${net.name} ski route`).slice(0, 120);
      const result = net.route(points, options); // throws if there is no valid route
      const saved = store.save({
        id: body.id || null,
        name,
        folder: body.folder,
        resort: resortId,
        resortName: net.name,
        points,
        options,
        summary: { ...result.summary, legs: result.legs.length },
        gpx: toGpx(name, result),
      });
      const { gpx, ...meta } = saved;
      return send(res, 200, meta);
    }

    if (url.pathname === '/api/routes/zip' && req.method === 'GET') {
      const folder = String(url.searchParams.get('folder') ?? DEFAULT_FOLDER);
      const data = store.zipFolder(folder);
      return send(res, 200, data, 'application/zip', {
        'Content-Disposition': `attachment; filename="${slug(folder) || 'routes'}.zip"; filename*=UTF-8''${encodeURIComponent(folder)}.zip`,
      });
    }

    const routeMatch = url.pathname.match(/^\/api\/routes\/([a-f0-9]{12})(\.gpx)?$/);
    if (routeMatch && req.method === 'GET') {
      const r = store.get(routeMatch[1]);
      if (routeMatch[2]) {
        return send(res, 200, r.gpx, 'application/gpx+xml', {
          'Content-Disposition': `attachment; filename="${slug(r.name) || 'ski-route'}.gpx"`,
        });
      }
      const { gpx, ...rest } = r;
      return send(res, 200, rest);
    }
    if (routeMatch && req.method === 'DELETE') {
      store.delete(routeMatch[1]);
      return send(res, 200, { ok: true });
    }

    if (req.method === 'POST' && url.pathname === '/api/route') {
      const body = await readBody(req);
      const net = network(String(body.resort ?? ''));
      const t = Date.now();
      const result = net.route(validatePoints(body.points), body.options ?? {});
      const name = String(body.name || `${net.name} ski route`).slice(0, 120);
      return send(res, 200, { ...result, name, gpx: toGpx(name, result), ms: Date.now() - t });
    }

    send(res, 404, { error: 'Not found' });
  } catch (err) {
    if (err instanceof RouteError || err instanceof SearchError || err instanceof StoreError || err instanceof SyntaxError) {
      return send(res, 400, { error: err.message });
    }
    console.error(err);
    send(res, 500, { error: 'Internal error, see the planner console' });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Ski route planner: http://localhost:${PORT}`);
  console.log(`Using tiles from:  ${TILESERVER_URL}`);
});
