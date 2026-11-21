#!/usr/bin/env node
// Desktop server for the new app (docs/pwa-plan.md §2, §3). No framework. It serves:
//   - the desktop build of the app (app/dist-desktop),
//   - the data files of `npm run build` under /data (PMTiles with HTTP Range, planner JSON, fonts, sprites),
//   - /api/capabilities, /api/routes* (routes in the project folder), /api/resolve (Google Maps short links),
//   - /api/regions*, /api/skiareas, /api/builds*, /api/zips*, /api/cleanup ("Build region": one data ZIP per region, clean-up of region files; region-builds.mjs).
// Routing, search and info cards run in the browser (routing worker); this server does no routing.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { MIME, safeJoin, sendFile } from './files.mjs';
import { DEFAULT_FOLDER, RouteStore, StoreError, slug } from './routes-store.mjs';
import { resolveGoogleLink } from './google-links.mjs';
import { BuildError, RegionBuilds } from './region-builds.mjs';
import { defaultMapDir, defaultMapId } from '../scripts/lib/map-folder.mjs';
import { SearchError } from '../packages/core/src/search.ts';

const ROOT = path.resolve(import.meta.dirname, '..');
const OFF = ['0', 'false', 'no', 'off'];

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const readJson = (file) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
};

/** What the app gets at /api/capabilities (see app/src/lib/platform/index.ts). */
export function capabilities({ mapDir, tileServerUrl, serverRoutes, regionBuilds = false, projectRoot = ROOT }) {
  const resorts = readJson(path.join(mapDir, 'planner/resorts.json'));
  const tilesDir = path.join(mapDir, 'tileserver/data');
  const tiles = ['ski', 'basemap', 'terrain', 'contours'].filter((t) => fs.existsSync(path.join(tilesDir, `${t}.pmtiles`)));
  const settings = readJson(path.join(projectRoot, 'resorts.json'))?.settings ?? {};
  const info = readJson(path.join(mapDir, 'build-info.json'));
  const ok = Array.isArray(resorts) && resorts.length > 0 && tiles.includes('ski') && tiles.includes('basemap');
  return {
    tileServerUrl,
    projectFolderRoutes: serverRoutes,
    googleShortLinks: true,
    regionBuilds,
    data: ok
      ? {
          resorts,
          language: settings.language ?? 'en',
          tiles,
          zoom: info?.zoom ? { terrain: info.zoom.terrain ?? null, basemap: info.zoom.basemap ?? null, ski: info.zoom.ski ?? null } : null,
          builtAt: info?.builtAt ?? null,
        }
      : null,
    ...(ok ? {} : { dataError: `No map data found in build/regions/${defaultMapId(projectRoot)}. Run npm run build first.` }),
  };
}

function send(res, status, body, type = 'application/json; charset=utf-8', extra = {}) {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', ...extra });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

async function readBody(req, limit = 2_000_000) {
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > limit) throw new HttpError(413, 'Request too large');
    chunks.push(c);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    throw new HttpError(400, 'Invalid JSON');
  }
}

/** Validates a saved route sent by the app (the app computed the route and the GPX). */
export function validateRoute(body) {
  const points = body?.points;
  if (!Array.isArray(points) || points.length < 2 || points.length > 25) throw new HttpError(400, 'A route needs 2 to 25 points.');
  for (const p of points) {
    if (!Array.isArray(p) || p.length < 2 || !p.slice(0, 2).every(Number.isFinite)) throw new HttpError(400, 'Invalid point');
  }
  if (typeof body.resort !== 'string' || !/^[\w-]+$/.test(body.resort)) throw new HttpError(400, 'Invalid resort id');
  if (typeof body.gpx !== 'string' || !body.gpx.startsWith('<?xml')) throw new HttpError(400, 'Missing GPX');
  const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
  return {
    id: typeof body.id === 'string' && body.id ? body.id : null,
    name: String(body.name ?? ''),
    folder: body.folder,
    resort: body.resort,
    resortName: String(body.resortName ?? body.resort),
    points: points.map((p) => [p[0], p[1]]),
    options: isObj(body.options) ? body.options : {},
    summary: isObj(body.summary) ? body.summary : {},
    gpx: body.gpx,
  };
}

/** Data files under /data/… → a file in build/ (planner and tiles from the default map folder), or null. Only the four kinds of files the app needs. */
export function dataFile({ buildDir, mapDir }, pathname) {
  const m = /^\/data\/(planner|tiles|fonts|sprites)\/(.+)$/.exec(pathname);
  if (!m) return null;
  const [, kind, rest] = m;
  const dirs = {
    planner: [path.join(mapDir, 'planner'), /^[\w.-]+\.json$/],
    tiles: [path.join(mapDir, 'tileserver/data'), /^[\w-]+\.pmtiles$/],
    fonts: [path.join(buildDir, 'tileserver/fonts'), /^[^/]+\/\d+-\d+\.pbf$/],
    sprites: [path.join(buildDir, 'tileserver/sprites'), /^[\w@.-]+\.(?:json|png)$/],
  };
  const [dir, allowed] = dirs[kind];
  let decoded;
  try {
    decoded = decodeURIComponent(rest);
  } catch {
    return null;
  }
  if (!allowed.test(decoded)) return null;
  return safeJoin(dir, rest);
}

export function createServer({
  appDir = path.join(ROOT, 'app/dist-desktop'),
  buildDir = path.join(ROOT, 'build'),
  /** the resorts.json map (planner data, tiles, build-info.json): build/regions/<resort id>; fonts and sprites stay in buildDir */
  mapDir = defaultMapDir(buildDir, ROOT),
  tileServerUrl = 'http://localhost:8080',
  serverRoutes = true,
  routesDir = path.join(ROOT, 'saved-routes'),
  resolveLink = resolveGoogleLink,
  log = console,
  /** RegionBuilds instance ("Build region" page), or null to turn it off */
  regions = null,
} = {}) {
  let store = null;
  const routeStore = () => (store ??= new RouteStore(routesDir));

  const server = http.createServer(async (req, res) => {
    let url;
    try {
      url = new URL(req.url ?? '/', 'http://localhost');
    } catch {
      return send(res, 400, { error: 'Bad URL' });
    }
    const { pathname } = url;
    const isGet = req.method === 'GET' || req.method === 'HEAD';
    try {
      if (pathname.startsWith('/data/')) {
        if (!isGet) throw new HttpError(405, 'Method not allowed');
        const file = dataFile({ buildDir, mapDir }, pathname);
        if (file && sendFile(req, res, file)) return;
        throw new HttpError(404, 'Not found');
      }

      if (pathname === '/api/capabilities' && isGet) {
        return send(res, 200, capabilities({ mapDir, tileServerUrl, serverRoutes, regionBuilds: regions !== null }));
      }

      if (pathname.startsWith('/api/regions') || pathname.startsWith('/api/skiareas') || pathname.startsWith('/api/builds') || pathname.startsWith('/api/zips') || pathname.startsWith('/api/cleanup')) {
        if (!regions) throw new HttpError(403, 'Region builds are turned off.');
        return await handleRegions(req, res, url, regions);
      }

      if (pathname === '/api/resolve' && isGet) {
        const resort = url.searchParams.get('resort');
        const resorts = readJson(path.join(mapDir, 'planner/resorts.json')) ?? [];
        const viewbox = resorts.find((r) => r.id === resort)?.bbox;
        return send(res, 200, await resolveLink(url.searchParams.get('url'), viewbox));
      }

      if (pathname.startsWith('/api/routes')) {
        if (!serverRoutes) throw new HttpError(403, 'Saving routes in the project folder is turned off.');
        if (pathname === '/api/routes' && isGet) return send(res, 200, { folders: routeStore().list(), defaultFolder: DEFAULT_FOLDER });
        if (pathname === '/api/routes' && req.method === 'POST') {
          const { gpx, ...meta } = routeStore().save(validateRoute(await readBody(req)));
          return send(res, 200, meta);
        }
        if (pathname === '/api/routes/zip' && isGet) {
          const folder = String(url.searchParams.get('folder') ?? DEFAULT_FOLDER);
          return send(res, 200, routeStore().zipFolder(folder), 'application/zip', {
            'Content-Disposition': `attachment; filename="${slug(folder) || 'routes'}.zip"; filename*=UTF-8''${encodeURIComponent(folder)}.zip`,
          });
        }
        const m = pathname.match(/^\/api\/routes\/([a-f0-9]{12})(\.gpx)?$/);
        if (m && isGet) {
          const r = routeStore().get(m[1]);
          if (m[2]) {
            return send(res, 200, r.gpx, 'application/gpx+xml', {
              'Content-Disposition': `attachment; filename="${slug(r.name) || 'ski-route'}.gpx"`,
            });
          }
          const { gpx, ...rest } = r;
          return send(res, 200, rest);
        }
        if (m && req.method === 'DELETE') {
          routeStore().delete(m[1]);
          return send(res, 200, { ok: true });
        }
        throw new HttpError(404, 'Not found');
      }

      if (pathname.startsWith('/api/')) throw new HttpError(404, 'Not found');
      if (!isGet) throw new HttpError(405, 'Method not allowed');

      // the app (desktop build)
      if (!fs.existsSync(path.join(appDir, 'index.html'))) {
        return send(res, 503, 'The desktop app is not built yet. Run npm run build:desktop (npm start does it for you).', 'text/plain; charset=utf-8');
      }
      const file = safeJoin(appDir, pathname === '/' ? 'index.html' : pathname);
      if (!file) throw new HttpError(404, 'Not found');
      // hashed file names under /assets/ never change
      const cacheControl = pathname.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache';
      if (sendFile(req, res, file, { cacheControl })) return;
      // no file extension: an app URL → index.html
      if (!path.extname(pathname)) return void sendFile(req, res, path.join(appDir, 'index.html'), { type: MIME['.html'] });
      throw new HttpError(404, 'Not found');
    } catch (err) {
      if (err instanceof HttpError || err instanceof BuildError) return send(res, err.status, { error: err.message });
      if (err instanceof StoreError || err instanceof SearchError) return send(res, 400, { error: err.message });
      log.error(err);
      send(res, 500, { error: 'Internal error, see the server console' });
    }
  });
  if (regions) server.on('close', () => regions.shutdown());
  return server;
}

/** /api/regions*, /api/skiareas, /api/builds*, /api/zips* ("Build region" page, desktop only). */
async function handleRegions(req, res, url, regions) {
  const { pathname } = url;
  const method = req.method === 'HEAD' ? 'GET' : req.method;

  if (pathname === '/api/regions/defaults' && method === 'GET') return send(res, 200, regions.defaults());
  if (pathname === '/api/skiareas' && method === 'GET') return send(res, 200, { results: regions.search(url.searchParams.get('q')) });
  if (pathname === '/api/regions/estimate' && method === 'POST') return send(res, 200, regions.estimate(await readBody(req)));
  if (pathname === '/api/regions' && method === 'GET') return send(res, 200, { regions: regions.listRegions() });
  if (pathname === '/api/regions' && method === 'POST') return send(res, 200, regions.saveRegion(await readBody(req)));
  const rm = /^\/api\/regions\/([a-z0-9][a-z0-9-]*)$/.exec(pathname);
  if (rm && method === 'DELETE') {
    regions.deleteRegion(rm[1]);
    return send(res, 200, { ok: true });
  }

  if (pathname === '/api/builds' && method === 'POST') {
    const body = await readBody(req);
    return send(res, 200, regions.start(body.region, { save: body.save === true }));
  }
  if (pathname === '/api/builds/current' && method === 'GET') return send(res, 200, { build: regions.status(), lines: regions.lines() });
  if (pathname === '/api/builds/current' && method === 'DELETE') return send(res, 200, regions.cancel());
  if (pathname === '/api/builds/current/events' && method === 'GET') {
    // server-sent events: the current status and every output line, then live updates
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    const write = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
    write('hello', { build: regions.status(), lines: regions.lines() });
    const off = regions.subscribe(write);
    const ping = setInterval(() => res.write(': ping\n\n'), 15000);
    req.on('close', () => {
      clearInterval(ping);
      off();
    });
    return;
  }

  if (pathname === '/api/cleanup' && method === 'GET') return send(res, 200, { items: regions.cleanupItems() });
  if (pathname === '/api/cleanup' && method === 'POST') return send(res, 200, regions.cleanup((await readBody(req)).keys));
  if (pathname === '/api/zips' && method === 'GET') return send(res, 200, { zips: regions.zips() });
  const zm = /^\/api\/zips\/([^/]+)$/.exec(pathname);
  if (zm && method === 'GET') {
    let name;
    try {
      name = decodeURIComponent(zm[1]);
    } catch {
      throw new HttpError(400, 'Bad file name');
    }
    const file = regions.zipFile(name);
    if (!file || !sendFile(req, res, file, { type: 'application/zip', headers: { 'Content-Disposition': `attachment; filename="${name}"` } })) {
      throw new HttpError(404, 'Not found');
    }
    return;
  }
  if (zm && method === 'DELETE') {
    let name;
    try {
      name = decodeURIComponent(zm[1]);
    } catch {
      throw new HttpError(400, 'Bad file name');
    }
    return send(res, 200, regions.deleteRegionZip(name));
  }
  throw new HttpError(404, 'Not found');
}

if (import.meta.main) {
  const port = Number(process.env.PORT ?? process.env.DESKTOP_PORT ?? 8081);
  const host = process.env.HOST ?? '127.0.0.1';
  const serverRoutes = !OFF.includes(String(process.env.PLANNER_SERVER_ROUTES ?? '1').toLowerCase());
  const regionBuilds = !OFF.includes(String(process.env.PLANNER_REGION_BUILDS ?? '1').toLowerCase());
  const regions = regionBuilds ? new RegionBuilds() : null;
  const server = createServer({
    tileServerUrl: process.env.TILESERVER_URL ?? 'http://localhost:8080',
    serverRoutes,
    routesDir: process.env.ROUTES_DIR ?? path.join(ROOT, 'saved-routes'),
    appDir: process.env.APP_DIR ? path.resolve(process.env.APP_DIR) : undefined,
    regions,
  });
  // stop a running region build together with the server
  for (const sig of ['SIGINT', 'SIGTERM']) {
    process.on(sig, () => {
      regions?.shutdown();
      process.exit(0);
    });
  }
  server.listen(port, host, () => {
    console.log(`Desktop server: http://localhost:${port}`);
    if (!fs.existsSync(path.join(defaultMapDir(path.join(ROOT, 'build'), ROOT), 'planner/resorts.json'))) console.log('No map data yet: run npm run build first.');
  });
}
