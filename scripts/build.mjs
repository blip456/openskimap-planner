#!/usr/bin/env node
// Builds everything the tile server and the route planner need from resorts.json.
//
//   npm run build                     full build (downloads at most once per 24h)
//   npm run build -- --only=ski       only re-filter ski data, ski tiles, styles and planner data
//   npm run build -- --refresh        force a new OpenSkiData download (max once per day!)
//   npm run build -- --refresh-basemap  re-extract basemap, terrain and contours
//   npm run build z12                 zoom per build: terrain z12, basemap z12 (min(N, 15)); ski unchanged
//   npm run build -- --terrain-zoom=16 --basemap-zoom=14 --ski-zoom=16   each zoom on its own (overrides z<N>)
//   npm run build z17 -- --yes        skip the question above zoom 16
//   Zoom order: long flags > z<N> > resorts.json settings. Extracts are cached per zoom in build/work/.
//   npm run build -- --region=region.json --out=build/regions/x   one region (scripts/lib/region.mjs) instead of
//                                     resorts.json, written to its own folder. Downloads, caches, fonts and sprites
//                                     stay shared in build/. A resort or region with a `bbox` is built exactly as
//                                     drawn: all runs and lifts that touch the box are kept whole.
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import sharp from 'sharp';
import { VectorTile } from '@mapbox/vector-tile';
import { PbfReader } from 'pbf';

import {
  MERC_HALF,
  bboxIntersects,
  bboxToPolygon,
  bboxUnion,
  bboxValid,
  bufferBbox,
  emptyBbox,
  extendBbox,
  geometryBbox,
  roundBbox,
  tileRange,
} from '../packages/core/src/geo.ts';
import { featureLabel, liftClass, liftDirection, orientUphill, runColor, runKind } from '../packages/core/src/ski.ts';
import { buildBasemapStyle, buildOverlayStyle } from '../packages/core/src/styles/index.ts';
import { slopeSegments } from '../packages/core/src/slope.ts';
import { assignPistes } from '../packages/core/src/piste.ts';
import { PMTiles } from 'pmtiles';
import { openPMTiles } from './lib/pmtiles-file.mjs';
import {
  ArgError,
  CONFIRM_ABOVE_ZOOM,
  estimateTerrain,
  formatBytes,
  parseBuildArgs,
  resolveZoom,
} from './lib/build-args.mjs';
import { RegionError, checkBbox, regionToResort, validateRegion } from './lib/region.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
// everything the build creates lives in build/ (safe to delete; `npm run build` recreates it)
const BUILD = path.join(ROOT, 'build');

let args;
try {
  args = parseBuildArgs(process.argv.slice(2));
} catch (err) {
  if (!(err instanceof ArgError)) throw err;
  console.error(`\nBuild: ${err.message}`);
  process.exit(2);
}
const onlySki = args.only === 'ski';

// output of this build: build/ itself, or the folder of --out (region builds). Downloads, the extract caches, fonts
// and sprites are always shared in build/.
const OUT = args.out ? path.resolve(args.out) : BUILD;
const DIR = {
  raw: path.join(BUILD, 'downloads'),
  cache: path.join(BUILD, 'work'),
  work: path.join(OUT, 'work'),
  tileserver: path.join(OUT, 'tileserver'),
  tsData: path.join(OUT, 'tileserver/data'),
  fonts: path.join(BUILD, 'tileserver/fonts'),
  sprites: path.join(BUILD, 'tileserver/sprites'),
  styles: path.join(OUT, 'tileserver/styles'),
  planner: path.join(OUT, 'planner'),
};

const OSD_BASE = 'https://tiles.openskimap.org';
const OSD_FILES = ['ski_areas', 'runs', 'lifts', 'spots'];
const PROTOMAPS_BUILDS = 'https://build-metadata.protomaps.dev/builds.json';
const PROTOMAPS_BASE = 'https://build.protomaps.com';
const MAPTERHORN_BASE = 'https://download.mapterhorn.com';
const ASSETS_BASE = 'https://raw.githubusercontent.com/protomaps/basemaps-assets/main';
const FONTSTACKS = ['Noto Sans Regular', 'Noto Sans Medium', 'Noto Sans Italic'];
const DAY_MS = 24 * 60 * 60 * 1000;
const BUILD_INFO = path.join(OUT, 'build-info.json');

// ---------------------------------------------------------------------------
// helpers

const t0 = Date.now();
function log(msg) {
  const s = ((Date.now() - t0) / 1000).toFixed(1).padStart(6);
  console.log(`[${s}s] ${msg}`);
}

function run(cmd, cmdArgs, opts = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, cmdArgs, { stdio: opts.quiet ? ['ignore', 'ignore', 'inherit'] : 'inherit' });
    p.on('error', (err) =>
      reject(err.code === 'ENOENT' ? new Error(`'${cmd}' not found. Is it installed and on your PATH?`) : err),
    );
    p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited with code ${code}`))));
  });
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(file, data, pretty = true) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, pretty ? 2 : 0));
}

function hash(value) {
  return crypto.createHash('sha1').update(JSON.stringify(value)).digest('hex').slice(0, 12);
}

async function download(url, file) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(tmp));
  fs.renameSync(tmp, file);
}

async function exists(url) {
  const res = await fetch(url, { method: 'HEAD' });
  return res.ok;
}

async function* readFeatures(file) {
  const rl = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity });
  for await (let line of rl) {
    line = line.trim();
    if (!line.startsWith('{"type":"Feature"')) continue;
    if (line.endsWith(',')) line = line.slice(0, -1);
    yield JSON.parse(line);
  }
}

class FeatureCollectionWriter {
  constructor(file) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    this.fd = fs.openSync(file, 'w');
    this.first = true;
    fs.writeSync(this.fd, '{"type":"FeatureCollection","features":[\n');
  }
  write(feature) {
    fs.writeSync(this.fd, (this.first ? '' : ',\n') + JSON.stringify(feature));
    this.first = false;
  }
  close() {
    fs.writeSync(this.fd, '\n]}\n');
    fs.closeSync(this.fd);
  }
}

// ---------------------------------------------------------------------------
// 1. OpenSkiData download (respecting the once-per-day rule)

async function downloadOpenSkiData() {
  const stampFile = path.join(DIR.raw, 'download.json');
  const stamp = readJson(stampFile, null);
  const haveAll = OSD_FILES.every((f) => fs.existsSync(path.join(DIR.raw, `${f}.geojson`)));

  if (haveAll && !args.refresh) {
    const age = stamp ? Date.now() - Date.parse(stamp.downloadedAt) : Infinity;
    if (age < DAY_MS || Number.isNaN(age)) {
      log(`OpenSkiData: using local copy (downloaded ${stamp?.downloadedAt ?? 'earlier'})`);
      return;
    }
  }

  const meta = await (await fetch(`${OSD_BASE}/metadata.json`)).json();
  if (haveAll && !args.refresh && stamp?.buildFinishedAt === meta.run?.finishedAt) {
    log('OpenSkiData: no newer build available, keeping local copy');
    writeJson(stampFile, { ...stamp, downloadedAt: new Date().toISOString() });
    return;
  }

  log(`OpenSkiData: downloading build from ${meta.run?.finishedAt} (OSM ${meta.source?.openStreetMap?.dataTimestamp})`);
  for (const f of OSD_FILES) {
    log(`  ${f}.geojson`);
    await download(`${OSD_BASE}/geojson/${f}.geojson`, path.join(DIR.raw, `${f}.geojson`));
  }
  writeJson(path.join(DIR.raw, 'metadata.json'), meta);
  writeJson(stampFile, { downloadedAt: new Date().toISOString(), buildFinishedAt: meta.run?.finishedAt });
}

// ---------------------------------------------------------------------------
// 2. Resolve resorts and extract their runs / lifts / spots

function resolveResorts(config) {
  const skiAreas = JSON.parse(fs.readFileSync(path.join(DIR.raw, 'ski_areas.geojson'), 'utf8')).features;
  const byName = new Map();
  for (const f of skiAreas) {
    const name = f.properties.name;
    if (!name) continue;
    if (!byName.has(name)) byName.set(name, []);
    byName.get(name).push(f);
  }

  return config.resorts.map((resort) => {
    if (resort.bbox) {
      // a drawn box: no ski area lookup and no margin; everything that touches the box is kept
      let bbox;
      try {
        bbox = checkBbox(resort.bbox);
      } catch (err) {
        throw new Error(`Resort "${resort.id}": ${err.message}`);
      }
      return { ...resort, exactBbox: bbox, ids: new Set(), roughBbox: bbox, margin: 0, skiAreaFeatures: skiAreas };
    }
    const ids = new Set();
    let rough = emptyBbox();
    for (const entry of resort.skiAreas ?? []) {
      let matches;
      if (typeof entry === 'object' && entry.id) {
        matches = skiAreas.filter((f) => f.properties.id === entry.id);
      } else {
        matches = byName.get(entry) ?? [];
      }
      if (matches.length === 0) {
        const needle = String(entry).toLowerCase();
        const tokens = needle.split(/[^\p{L}\p{N}]+/u).filter((t) => t.length > 3);
        const suggestions = skiAreas
          .filter((f) => tokens.some((t) => f.properties.name?.toLowerCase().includes(t)))
          .slice(0, 10)
          .map((f) => `    "${f.properties.name}" (${f.properties.places?.[0]?.localized?.en?.country ?? '?'})`);
        throw new Error(
          `Ski area "${JSON.stringify(entry)}" not found for resort "${resort.id}".` +
            (suggestions.length ? `\n  Did you mean:\n${suggestions.join('\n')}` : ''),
        );
      }
      if (matches.length > 1) {
        const list = matches
          .map((f) => `    { "id": "${f.properties.id}" }  // ${f.properties.places?.[0]?.localized?.en?.locality ?? ''}, ${f.properties.places?.[0]?.localized?.en?.country ?? ''}`)
          .join('\n');
        throw new Error(`Ski area name "${entry}" is ambiguous. Use one of these instead:\n${list}`);
      }
      const f = matches[0];
      ids.add(f.properties.id);
      rough = bboxUnion(rough, geometryBbox(f.geometry));
    }
    const margin = resort.marginKm ?? 2;
    return { ...resort, ids, roughBbox: bufferBbox(rough, margin + 10), margin, skiAreaFeatures: skiAreas };
  });
}

function slimFeature(layer, f) {
  const p = f.properties;
  const loc = p.places?.[0]?.localized?.en ?? {};
  const base = {
    id: p.id,
    name: p.name ?? null,
    ref: p.ref ?? null,
    status: p.status ?? null,
    skiAreaIds: (p.skiAreas ?? []).map((s) => s.properties?.id).filter(Boolean),
    // details for the planner's info card (not written to the tiles)
    skiAreas: (p.skiAreas ?? []).map((s) => ({ id: s.properties?.id, name: s.properties?.name ?? null })).filter((s) => s.id),
    place: { country: loc.country ?? null, region: loc.region ?? null, locality: loc.locality ?? null },
    sources: (p.sources ?? []).map((s) => ({ type: s.type, id: String(s.id) })),
    websites: p.websites ?? [],
    wikidataID: p.wikidataID ?? null,
    description: p.description ?? null,
  };
  let props;
  if (layer === 'runs') {
    props = {
      ...base,
      uses: p.uses ?? [],
      kind: runKind(p.uses),
      difficulty: p.difficulty ?? null,
      color: runColor(p.difficulty),
      oneway: p.oneway ?? null,
      grooming: p.grooming ?? null,
      lit: p.lit ?? null,
      gladed: p.gladed ?? null,
      patrolled: p.patrolled ?? null,
      snowmaking: p.snowmaking ?? null,
    };
  } else if (layer === 'lifts') {
    props = {
      ...base,
      liftType: p.liftType ?? null,
      liftClass: liftClass(p.liftType),
      direction: liftDirection(p),
      oneway: p.oneway ?? null,
      duration: p.duration ?? null,
      capacity: p.capacity ?? null,
      occupancy: p.occupancy ?? null,
      bubble: p.bubble ?? null,
      heating: p.heating ?? null,
      detachable: p.detachable ?? null,
      access: p.access ?? null,
      stations: (p.stations ?? []).map((s) => ({
        coordinates: s.geometry?.coordinates,
        name: s.properties?.name ?? null,
        position: s.properties?.position ?? null,
        entry: s.properties?.entry ?? null,
        exit: s.properties?.exit ?? null,
      })),
    };
  } else {
    props = {
      ...base,
      spotType: p.spotType ?? null,
      position: p.position ?? null,
      liftId: p.liftId ?? null,
      entry: p.entry ?? null,
      exit: p.exit ?? null,
    };
  }
  props.label = featureLabel(props);
  const geometry =
    layer === 'lifts' && f.geometry.type === 'LineString'
      ? { type: 'LineString', coordinates: orientUphill(f.geometry.coordinates) }
      : f.geometry;
  return { type: 'Feature', geometry, properties: props };
}

async function extractResorts(resorts) {
  for (const r of resorts) {
    r.candidates = { runs: [], lifts: [], spots: [] };
    r.linkedBbox = emptyBbox();
  }

  for (const layer of ['runs', 'lifts', 'spots']) {
    log(`Filtering ${layer}…`);
    for await (const f of readFeatures(path.join(DIR.raw, `${layer}.geojson`))) {
      const fb = geometryBbox(f.geometry);
      for (const r of resorts) {
        if (!bboxIntersects(fb, r.roughBbox)) continue;
        const linked = (f.properties.skiAreas ?? []).some((s) => r.ids.has(s.properties?.id));
        if (linked && layer !== 'spots') extendBbox(r.linkedBbox, [[fb[0], fb[1]], [fb[2], fb[3]]]);
        r.candidates[layer].push({ feature: slimFeature(layer, f), bbox: fb });
      }
    }
  }

  for (const r of resorts) {
    if (r.exactBbox) {
      r.bbox = r.exactBbox;
    } else {
      if (!bboxValid(r.linkedBbox)) throw new Error(`Resort "${r.id}" has no runs or lifts linked to its ski areas.`);
      r.bbox = roundBbox(bufferBbox(r.linkedBbox, r.margin));
    }
    r.features = {};
    for (const layer of ['runs', 'lifts', 'spots']) {
      r.features[layer] = r.candidates[layer].filter((c) => bboxIntersects(c.bbox, r.bbox)).map((c) => c.feature);
    }
    if (r.exactBbox && r.features.runs.length + r.features.lifts.length === 0) {
      throw new Error(`Resort "${r.id}": there are no runs or lifts in this box. Draw it around a ski area.`);
    }
    assignPistes(r.features.runs);
    r.skiAreaLabels = r.skiAreaFeatures
      .filter((f) => f.properties.name && bboxIntersects(geometryBbox(f.geometry), r.bbox))
      .filter((f) => f.properties.activities?.includes('downhill') || r.ids.has(f.properties.id))
      .map((f) => {
        const b = geometryBbox(f.geometry);
        const coords = f.geometry.type === 'Point' ? f.geometry.coordinates : [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2];
        return {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: coords },
          properties: { id: f.properties.id, name: f.properties.name },
        };
      });
    delete r.candidates;
    delete r.skiAreaFeatures;
    delete r.exactBbox;
    const c = r.features;
    log(`  ${r.name}: ${c.runs.length} runs, ${c.lifts.length} lifts, ${c.spots.length} spots, bbox ${r.bbox.join(',')}`);
  }
}

// ---------------------------------------------------------------------------
// 3. Ski vector tiles + planner data

const TILE_DROP = new Set([
  'uses', 'stations', 'skiAreaIds', 'skiAreas', 'place', 'sources', 'websites', 'wikidataID', 'description',
]);

const to2d = (c) => (typeof c[0] === 'number' ? [c[0], c[1]] : c.map(to2d));
const flatten = (geometry) => ({ type: geometry.type, coordinates: to2d(geometry.coordinates) });

async function buildSkiTiles(resorts, settings) {
  const dir = path.join(DIR.work, 'ski');
  const writers = {};
  const seen = {};
  for (const layer of ['runs', 'lifts', 'spots', 'ski_areas_labels', 'run_slopes']) {
    writers[layer] = new FeatureCollectionWriter(path.join(dir, `${layer}.geojson`));
    seen[layer] = new Set();
  }

  // downhill runs cut into ~50 m slices coloured by their measured gradient ("colour by steepness")
  const writeSlopes = (f) => {
    const p = f.properties;
    if (p.kind !== 'downhill' || f.geometry.type !== 'LineString' || seen.run_slopes.has(p.id)) return;
    seen.run_slopes.add(p.id);
    for (const seg of slopeSegments(f.geometry.coordinates)) {
      writers.run_slopes.write({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: seg.coordinates.map((c) => [c[0], c[1]]) },
        properties: { id: p.id, slope: Math.round(seg.slope * 100), cls: seg.cls, difficulty: p.difficulty ?? 'unknown' },
      });
    }
  };

  const writeOnce = (layer, f) => {
    if (seen[layer].has(f.properties.id)) return;
    seen[layer].add(f.properties.id);
    const properties = {};
    for (const [k, v] of Object.entries(f.properties)) {
      if (!TILE_DROP.has(k) && v !== null && v !== '') properties[k] = v;
    }
    writers[layer].write({ type: 'Feature', geometry: flatten(f.geometry), properties });
  };

  for (const r of resorts) {
    for (const layer of ['runs', 'lifts', 'spots']) for (const f of r.features[layer]) writeOnce(layer, f);
    for (const f of r.skiAreaLabels) writeOnce('ski_areas_labels', f);
    for (const f of r.features.runs) writeSlopes(f);
  }
  Object.values(writers).forEach((w) => w.close());

  log('Building ski tiles with tippecanoe…');
  fs.mkdirSync(DIR.tsData, { recursive: true });
  await run(
    'tippecanoe',
    [
      '-o', path.join(DIR.tsData, 'ski.pmtiles'),
      '--force', '--quiet',
      '-Z', '8',
      '-z', String(settings.skiMaxZoom ?? 16),
      '-r1',
      '--no-feature-limit',
      '--no-tile-size-limit',
      '--no-tiny-polygon-reduction',
      '--name=OpenSkiData',
      '--attribution=OpenSkiData / OpenSkiMap.org, © OpenStreetMap contributors',
      ...['runs', 'lifts', 'spots', 'ski_areas_labels', 'run_slopes'].flatMap((l) => ['-L', `${l}:${path.join(dir, `${l}.geojson`)}`]),
    ],
  );
}

// Named places (villages, peaks, huts, restaurants, hotels, ...) from the basemap, for the planner search.
const SKIP_POI_KINDS = new Set([
  'boundary_stone', 'protected_area', 'nature_reserve', 'administrative', 'drainage_basin', 'residential',
  'industrial', 'commercial', 'wetland', 'forest', 'meadow', 'grassland', 'grass', 'scree', 'bare_rock', 'tree',
  'bench', 'vending_machine', 'recycling', 'platform', 'stop', 'parking_entrance', 'military', 'construction',
  'unclassified', 'tertiary', 'secondary', 'pedestrian', 'farmyard', 'agrarian', 'hunting_stand', 'yes',
]);

async function extractPlaces(resorts) {
  const file = path.join(DIR.tsData, 'basemap.pmtiles');
  if (!fs.existsSync(file)) {
    for (const r of resorts) r.places = [];
    log('Search places: basemap not built yet, skipping villages/POIs');
    return;
  }
  const archive = openPMTiles(file);
  const z = Math.min(15, (await archive.getHeader()).maxZoom);
  for (const r of resorts) {
    const found = new Map();
    const t = tileRange(r.bbox, z);
    for (let x = t.x0; x <= t.x1; x++) {
      for (let y = t.y0; y <= t.y1; y++) {
        const tile = await archive.getZxy(z, x, y);
        if (!tile?.data) continue;
        const vt = new VectorTile(new PbfReader(new Uint8Array(tile.data)));
        for (const layerName of ['places', 'pois']) {
          const layer = vt.layers[layerName];
          if (!layer) continue;
          for (let i = 0; i < layer.length; i++) {
            const f = layer.feature(i);
            const p = f.properties;
            if (!p.name || f.type !== 1) continue;
            const kind = layerName === 'places' ? String(p.kind ?? 'place') : String(p.kind ?? 'poi');
            if (SKIP_POI_KINDS.has(kind)) continue;
            const [lon, lat] = f.toGeoJSON(x, y, z).geometry.coordinates;
            if (lon < r.bbox[0] || lon > r.bbox[2] || lat < r.bbox[1] || lat > r.bbox[3]) continue;
            const key = `${p.name}|${kind}|${lon.toFixed(3)}|${lat.toFixed(3)}`;
            if (found.has(key)) continue;
            found.set(key, {
              name: String(p.name),
              kind,
              coordinates: [Number(lon.toFixed(6)), Number(lat.toFixed(6))],
              ...(p.elevation ? { elevation: Math.round(Number(p.elevation)) } : {}),
            });
          }
        }
      }
    }
    r.places = [
      ...r.skiAreaLabels.map((f) => ({ name: f.properties.name, kind: 'ski_area', coordinates: f.geometry.coordinates })),
      ...found.values(),
    ];
    log(`  ${r.name}: ${r.places.length} searchable places`);
  }
  await archive.close();
}

function writePlannerData(resorts, zoom) {
  fs.mkdirSync(DIR.planner, { recursive: true });
  const index = resorts.map((r) => ({
    id: r.id,
    name: r.name,
    bbox: r.bbox,
    center: [(r.bbox[0] + r.bbox[2]) / 2, (r.bbox[1] + r.bbox[3]) / 2],
  }));
  writeJson(path.join(DIR.planner, 'resorts.json'), index);
  for (const r of resorts) {
    writeJson(
      path.join(DIR.planner, `${r.id}.json`),
      {
        id: r.id,
        name: r.name,
        bbox: r.bbox,
        builtAt: new Date().toISOString(),
        source: readJson(path.join(DIR.raw, 'metadata.json'), {})?.source ?? null,
        zoom,
        runs: r.features.runs.filter((f) => f.geometry.type === 'LineString'),
        runAreas: r.features.runs.filter((f) => f.geometry.type !== 'LineString'),
        lifts: r.features.lifts.filter((f) => f.geometry.type === 'LineString'),
        spots: r.features.spots,
        places: r.places ?? [],
      },
      false,
    );
  }
  log(`Planner data written for ${resorts.length} resort(s)`);
}

// ---------------------------------------------------------------------------
// 4. Basemap + terrain extracts

function writeRegion(resorts) {
  const region = {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: {},
        geometry: { type: 'MultiPolygon', coordinates: resorts.map((r) => bboxToPolygon(r.bbox)) },
      },
    ],
  };
  const file = path.join(DIR.work, 'region.geojson');
  writeJson(file, region);
  return { file, hash: hash(region) };
}

// Extracts are cached per zoom: build/work/<kind>/z<N>/<region hash>.pmtiles. The files in build/tileserver/data
// are hard links to (or copies of) the selected cache entry, so switching back to an earlier zoom needs no download.
function linkOrCopy(src, dst) {
  if (path.resolve(src) === path.resolve(dst)) return;
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.rmSync(dst, { force: true });
  try {
    fs.linkSync(src, dst);
  } catch {
    fs.copyFileSync(src, dst);
  }
}

// Shared by basemap, terrain and contours: use the file in tileserver/data if it matches, else the cache, else build.
async function useCached({ label, out, cache, upToDate, refresh, build }) {
  if (!refresh && fs.existsSync(out) && upToDate) {
    if (!fs.existsSync(cache)) linkOrCopy(out, cache); // adopt files from an older build into the cache
    log(`${label}: up to date`);
    return false;
  }
  if (!refresh && fs.existsSync(cache)) {
    log(`${label}: reusing stored extract ${path.relative(BUILD, cache)}`);
    linkOrCopy(cache, out);
    return true;
  }
  fs.mkdirSync(path.dirname(cache), { recursive: true });
  const tmp = cache.replace(/\.pmtiles$/, '.tmp.pmtiles'); // tippecanoe decides the format from the extension
  fs.rmSync(tmp, { force: true });
  try {
    await build(tmp);
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    try {
      fs.rmdirSync(path.dirname(cache)); // only succeeds when empty
    } catch {}
    throw err;
  }
  fs.renameSync(tmp, cache);
  linkOrCopy(cache, out);
  return true;
}

async function extractBasemap(region, settings, state) {
  const zoom = settings.basemapMaxZoom ?? 15;
  const key = hash([region.hash, zoom]);
  const cache = path.join(DIR.cache, 'basemap', `z${zoom}`, `${region.hash}.pmtiles`);
  const metaFile = `${cache}.json`;
  const changed = await useCached({
    label: `Basemap z${zoom}`,
    out: path.join(DIR.tsData, 'basemap.pmtiles'),
    cache,
    upToDate: state.basemap === key,
    refresh: args.refreshBasemap,
    build: async (tmp) => {
      const builds = await (await fetch(PROTOMAPS_BUILDS)).json();
      const latest = builds.map((b) => b.key).sort().at(-1);
      log(`Basemap: extracting Protomaps build ${latest} (z0-${zoom})…`);
      await run('pmtiles', [
        'extract', `${PROTOMAPS_BASE}/${latest}`, tmp,
        `--region=${region.file}`,
        `--maxzoom=${zoom}`,
        '--download-threads=8',
      ]);
      writeJson(metaFile, { build: latest });
    },
  });
  state.basemap = key;
  state.basemapBuild = readJson(metaFile, null)?.build ?? state.basemapBuild ?? null;
  return changed;
}

async function confirm(question) {
  if (args.yes) return true;
  if (!process.stdin.isTTY) {
    throw new Error('This needs your confirmation, but there is no terminal to ask. Run it again with --yes to continue.');
  }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise((resolve) => rl.question(`${question} [y/N] `, resolve));
  rl.close();
  return /^y(es)?$/i.test(answer.trim());
}

// Which Mapterhorn high-resolution files (zoom 13 and up) exist for the region, and how deep they go.
async function findHighResPieces(resorts, maxZoom) {
  const names = new Set();
  for (const r of resorts) {
    const t = tileRange(r.bbox, 6);
    for (let x = t.x0; x <= t.x1; x++) for (let y = t.y0; y <= t.y1; y++) names.add(`6-${x}-${y}`);
  }
  const pieces = [];
  for (const name of names) {
    const url = `${MAPTERHORN_BASE}/${name}.pmtiles`;
    if (!(await exists(url))) {
      log(`Terrain: no high-resolution data (${name}); the zoom 12 data is used there`);
      continue;
    }
    const header = await new PMTiles(url).getHeader();
    const zoom = Math.min(maxZoom, header.maxZoom);
    if (zoom < maxZoom) log(`Terrain: high-resolution data ${name} only goes up to zoom ${header.maxZoom}; using ${zoom} there`);
    pieces.push({ name, url, zoom });
  }
  return pieces;
}

async function extractTerrain(resorts, region, settings, state) {
  const requested = settings.terrainMaxZoom ?? 14;
  const key = hash([region.hash, requested]);
  const cache = path.join(DIR.cache, 'terrain', `z${requested}`, `${region.hash}.pmtiles`);
  const out = path.join(DIR.tsData, 'terrain.pmtiles');
  const changed = await useCached({
    label: `Terrain z${requested}`,
    out,
    cache,
    upToDate: state.terrain === key,
    refresh: args.refreshBasemap,
    build: async (tmp) => {
      // what exists: planet file up to zoom 12, high-resolution files for zoom 13 and up (only some regions)
      const pieces = requested > 12 ? await findHighResPieces(resorts, requested) : [];
      const effective = pieces.length ? Math.max(12, ...pieces.map((p) => p.zoom)) : Math.min(12, requested);
      if (requested > 12 && effective < requested) {
        log(`Terrain: requested zoom ${requested}, the highest available for this region is ${effective}`);
      }
      const est = estimateTerrain(resorts.map((r) => r.bbox), effective);
      log(`Terrain: about ${est.tiles.toLocaleString('en')} tiles to download, roughly ${formatBytes(est.bytes)} (zoom 0-${effective})`);
      if (effective > CONFIRM_ABOVE_ZOOM && !(await confirm(`Terrain zoom ${effective} is big (about ${formatBytes(est.bytes)}). Continue?`))) {
        throw new Error('Cancelled. Choose a lower zoom (for example z16) or use --yes.');
      }

      const work = path.join(DIR.work, `terrain-tmp-z${requested}`);
      fs.rmSync(work, { recursive: true, force: true });
      fs.mkdirSync(work, { recursive: true });
      try {
        log(`Terrain: extracting Mapterhorn z0-${Math.min(12, requested)}…`);
        const parts = [path.join(work, 'planet.pmtiles')];
        await run('pmtiles', [
          'extract', `${MAPTERHORN_BASE}/planet.pmtiles`, parts[0],
          `--region=${region.file}`, `--maxzoom=${Math.min(12, requested)}`, '--download-threads=8',
        ]);
        for (const piece of pieces) {
          log(`Terrain: extracting high-resolution ${piece.name} z13-${piece.zoom}…`);
          const file = path.join(work, `${piece.name}.pmtiles`);
          await run('pmtiles', [
            'extract', piece.url, file, `--region=${region.file}`, `--maxzoom=${piece.zoom}`, '--download-threads=8',
          ]);
          parts.push(file);
        }
        if (parts.length === 1) fs.copyFileSync(parts[0], tmp);
        else await run('pmtiles', ['merge', ...parts, tmp]);
      } finally {
        fs.rmSync(work, { recursive: true, force: true });
      }
    },
  });
  // old layout: loose parts directly in build/work/terrain (the cache now holds the merged file)
  if (fs.existsSync(cache)) {
    for (const f of ['planet.pmtiles', ...fs.readdirSync(path.dirname(path.dirname(cache))).filter((n) => /^\d+-\d+-\d+\.pmtiles$/.test(n))]) {
      fs.rmSync(path.join(DIR.cache, 'terrain', f), { force: true });
    }
  }
  state.terrain = key;
  return changed;
}

// ---------------------------------------------------------------------------
// 5. Contour lines (Mapterhorn DEM -> GDAL contours -> tippecanoe)

function boxBlur(grid, w, h, nodata) {
  const out = new Float32Array(grid.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (grid[i] === nodata) {
        out[i] = nodata;
        continue;
      }
      let sum = 0;
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= w) continue;
          const v = grid[yy * w + xx];
          if (v === nodata) continue;
          sum += v;
          n++;
        }
      }
      out[i] = sum / n;
    }
  }
  return out;
}

async function buildDem(archive, bbox, z, file) {
  const t = tileRange(bbox, z);
  const NODATA = -9999;
  let tileSize = null;
  let grid = null;
  let w = 0;
  let h = 0;

  for (let ty = t.y0; ty <= t.y1; ty++) {
    for (let tx = t.x0; tx <= t.x1; tx++) {
      const tile = await archive.getZxy(z, tx, ty);
      if (!tile?.data) continue;
      const { data, info } = await sharp(Buffer.from(tile.data))
        .removeAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      if (!grid) {
        tileSize = info.width;
        w = (t.x1 - t.x0 + 1) * tileSize;
        h = (t.y1 - t.y0 + 1) * tileSize;
        grid = new Float32Array(w * h).fill(NODATA);
      }
      const ox = (tx - t.x0) * tileSize;
      const oy = (ty - t.y0) * tileSize;
      for (let py = 0; py < tileSize; py++) {
        for (let px = 0; px < tileSize; px++) {
          const s = (py * tileSize + px) * 3;
          grid[(oy + py) * w + ox + px] = data[s] * 256 + data[s + 1] + data[s + 2] / 256 - 32768;
        }
      }
    }
  }
  if (!grid) return null;

  grid = boxBlur(boxBlur(grid, w, h, NODATA), w, h, NODATA);

  fs.writeFileSync(`${file}.bil`, Buffer.from(grid.buffer));
  fs.writeFileSync(
    `${file}.hdr`,
    [`NROWS ${h}`, `NCOLS ${w}`, 'NBANDS 1', 'NBITS 32', 'PIXELTYPE FLOAT', 'BYTEORDER I', 'LAYOUT BIL', `NODATA ${NODATA}`].join('\n') + '\n',
  );
  const n = 2 ** z;
  const ulx = (t.x0 / n) * 2 * MERC_HALF - MERC_HALF;
  const lrx = ((t.x1 + 1) / n) * 2 * MERC_HALF - MERC_HALF;
  const uly = MERC_HALF - (t.y0 / n) * 2 * MERC_HALF;
  const lry = MERC_HALF - ((t.y1 + 1) / n) * 2 * MERC_HALF;
  await run('gdal_translate', [
    '-q', '-of', 'GTiff', '-a_srs', 'EPSG:3857',
    '-a_ullr', String(ulx), String(uly), String(lrx), String(lry),
    '-a_nodata', String(NODATA),
    `${file}.bil`, `${file}.tif`,
  ]);
  return `${file}.tif`;
}

async function buildContours(resorts, settings, state) {
  const out = path.join(DIR.tsData, 'contours.pmtiles');
  const terrain = path.join(DIR.tsData, 'terrain.pmtiles');
  const interval = settings.contourInterval ?? 20;
  const index = settings.contourIndexInterval ?? 100;
  // the contours only depend on the terrain extract (its key holds region + zoom) and the intervals
  const key = hash([state.terrain, interval, index]);
  if (!fs.existsSync(terrain)) throw new Error('terrain.pmtiles missing; cannot build contours');
  await useCached({
    label: 'Contours',
    out,
    cache: path.join(DIR.cache, 'contours-cache', `${key}.pmtiles`),
    upToDate: state.contours === key,
    refresh: args.refreshBasemap,
    build: (tmp) => buildContoursFile(resorts, interval, index, terrain, tmp),
  });
  state.contours = key;
}

async function buildContoursFile(resorts, interval, index, terrain, out) {
  const dir = path.join(DIR.work, 'contours');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });

  const archive = openPMTiles(terrain);
  const header = await archive.getHeader();
  const z = Math.min(13, header.maxZoom);
  const writer = new FeatureCollectionWriter(path.join(dir, 'contours.geojson'));
  let count = 0;

  for (const r of resorts) {
    log(`Contours: ${r.name} (DEM zoom ${z}, every ${interval} m)…`);
    const base = path.join(dir, r.id);
    const tif = await buildDem(archive, r.bbox, z, base);
    if (!tif) {
      log(`  no terrain data for ${r.id}, skipping`);
      continue;
    }
    await run('gdal_contour', ['-q', '-a', 'ele', '-i', String(interval), '-f', 'GPKG', tif, `${base}-3857.gpkg`]);
    await run('ogr2ogr', ['-f', 'GeoJSONSeq', '-t_srs', 'EPSG:4326', '-lco', 'RS=NO', `${base}.geojsonl`, `${base}-3857.gpkg`]);

    for await (const line of readline.createInterface({ input: fs.createReadStream(`${base}.geojsonl`) })) {
      if (!line.trim()) continue;
      const f = JSON.parse(line);
      const ele = Math.round(f.properties.ele);
      const idx = ele % index === 0 ? 1 : 0;
      writer.write({
        type: 'Feature',
        tippecanoe: { minzoom: idx ? 11 : 13 },
        geometry: f.geometry,
        properties: { ele, idx },
      });
      count++;
    }
  }
  writer.close();
  await archive.close();

  log(`Contours: tiling ${count} lines…`);
  await run('tippecanoe', [
    '-o', out, '--force', '--quiet',
    '-Z', '11', '-z', '15',
    '-l', 'contours',
    '--no-feature-limit', '--no-tile-size-limit',
    '--simplification=4',
    '--name=Contours (Mapterhorn)',
    '--attribution=© Mapterhorn',
    path.join(dir, 'contours.geojson'),
  ]);
}

// ---------------------------------------------------------------------------
// 6. Fonts, sprites, styles, tileserver config

async function downloadAssets() {
  const jobs = [];
  for (const stack of FONTSTACKS) {
    for (let start = 0; start < 65536; start += 256) {
      const range = `${start}-${start + 255}.pbf`;
      const file = path.join(DIR.fonts, stack, range);
      if (!fs.existsSync(file)) jobs.push([`${ASSETS_BASE}/fonts/${encodeURIComponent(stack)}/${range}`, file]);
    }
  }
  for (const name of ['light.json', 'light.png', 'light@2x.json', 'light@2x.png']) {
    const file = path.join(DIR.sprites, name);
    if (!fs.existsSync(file)) jobs.push([`${ASSETS_BASE}/sprites/v4/${name}`, file]);
  }
  if (jobs.length === 0) {
    log('Fonts & sprites: present');
    return;
  }
  log(`Fonts & sprites: downloading ${jobs.length} files…`);
  let failed = 0;
  const queue = [...jobs];
  await Promise.all(
    Array.from({ length: 16 }, async () => {
      while (queue.length) {
        const [url, file] = queue.shift();
        try {
          await download(url, file);
        } catch {
          failed++;
        }
      }
    }),
  );
  if (failed) log(`  ${failed} files could not be downloaded (usually unused glyph ranges)`);
}

function writeStylesAndConfig(resorts, settings) {
  const bounds = resorts.map((r) => r.bbox).reduce(bboxUnion);
  const has = (f) => fs.existsSync(path.join(DIR.tsData, f));
  const hasBasemap = has('basemap.pmtiles');
  const hasTerrain = has('terrain.pmtiles');
  const hasContours = has('contours.pmtiles');

  fs.mkdirSync(DIR.styles, { recursive: true });
  const styles = {
    'ski-overlay': {
      style: 'ski-overlay.json',
      tilejson: { type: 'overlay', bounds, format: 'png' },
    },
  };
  writeJson(path.join(DIR.styles, 'ski-overlay.json'), buildOverlayStyle({ bounds }));
  writeJson(path.join(DIR.styles, 'ski-overlay-steepness.json'), buildOverlayStyle({ bounds, colorBy: 'slope' }));
  styles['ski-overlay-steepness'] = { style: 'ski-overlay-steepness.json', tilejson: { type: 'overlay', bounds, format: 'png' } };

  if (hasBasemap) {
    const language = settings.language ?? 'en';
    writeJson(path.join(DIR.styles, 'ski-basemap.json'), buildBasemapStyle({ language, bounds, hasTerrain, hasContours }));
    writeJson(
      path.join(DIR.styles, 'ski-basemap-steepness.json'),
      buildBasemapStyle({ language, bounds, hasTerrain, hasContours, colorBy: 'slope' }),
    );
    styles['ski-basemap'] = { style: 'ski-basemap.json', tilejson: { type: 'baselayer', bounds, format: 'jpg' } };
    styles['ski-basemap-steepness'] = { style: 'ski-basemap-steepness.json', tilejson: { type: 'baselayer', bounds, format: 'jpg' } };
  } else {
    log('Basemap missing: only the overlay style will be available (run a full build)');
  }

  const data = { ski: { pmtiles: 'ski.pmtiles' } };
  if (hasBasemap) data.basemap = { pmtiles: 'basemap.pmtiles' };
  if (hasTerrain) data.terrain = { pmtiles: 'terrain.pmtiles', encoding: 'terrarium', tileSize: 512 };
  if (hasContours) data.contours = { pmtiles: 'contours.pmtiles' };

  writeJson(path.join(DIR.tileserver, 'config.json'), {
    options: {
      paths: {
        root: '',
        fonts: 'fonts',
        sprites: 'sprites',
        styles: 'styles',
        pmtiles: 'data',
        mbtiles: 'data',
      },
      formatOptions: {
        jpeg: { quality: 88, progressive: false },
        png: { compressionLevel: 6 },
      },
      allowedHosts: 'localhost,127.0.0.1',
      maxScaleFactor: 3,
      maxSize: 2048,
      tileMargin: 64,
      serveAllFonts: true,
      serveStaticMaps: true,
      staticAttributionText:
        "OpenSkiData / OpenSkiMap.org, © OpenStreetMap contributors, Skimap.org, Who's On First, © Mapterhorn",
    },
    styles,
    data,
  });
  log(`Styles & tileserver config written (${Object.keys(styles).join(', ')})`);
}

// ---------------------------------------------------------------------------

// Zoom levels that were really built, read from the PMTiles headers (terrain can be lower than requested).
async function readActualZoom() {
  const zoom = {};
  for (const name of ['terrain', 'basemap', 'ski', 'contours']) {
    const file = path.join(DIR.tsData, `${name}.pmtiles`);
    if (!fs.existsSync(file)) {
      zoom[name] = null;
      continue;
    }
    const archive = openPMTiles(file);
    zoom[name] = (await archive.getHeader()).maxZoom;
    await archive.close();
  }
  return zoom;
}

async function writeBuildInfo(requested, state) {
  const meta = readJson(path.join(DIR.raw, 'metadata.json'), {});
  const actual = await readActualZoom();
  const info = {
    builtAt: new Date().toISOString(),
    // zoom levels really built (read from the PMTiles files); `requested` is what was asked for
    zoom: { terrain: actual.terrain, basemap: actual.basemap, ski: actual.ski, contours: actual.contours },
    requested,
    source: {
      openSkiData: { finishedAt: meta.run?.finishedAt ?? null, openStreetMapTimestamp: meta.source?.openStreetMap?.dataTimestamp ?? null },
      protomaps: { build: state.basemapBuild ?? null },
      mapterhorn: true,
    },
  };
  writeJson(BUILD_INFO, info);
  state.zoom = info.zoom;
  state.requestedZoom = requested;
  return info;
}

/** resorts.json, or with --region one region with the settings of resorts.json (its own zoom wins). */
function loadConfig() {
  const config = readJson(path.join(ROOT, 'resorts.json'), null);
  if (!args.region) {
    if (!config?.resorts?.length) throw new Error('resorts.json has no resorts');
    return config;
  }
  const raw = readJson(path.resolve(args.region), null);
  if (!raw) throw new Error(`Cannot read the region file ${args.region}`);
  let region;
  try {
    region = validateRegion(raw);
  } catch (err) {
    if (err instanceof RegionError) throw new Error(`Region file ${args.region}: ${err.message}`);
    throw err;
  }
  const settings = { ...(config?.settings ?? {}) };
  if (region.zoom?.terrain) settings.terrainMaxZoom = region.zoom.terrain;
  if (region.zoom?.basemap) settings.basemapMaxZoom = region.zoom.basemap;
  if (region.zoom?.ski) settings.skiMaxZoom = region.zoom.ski;
  log(`Region "${region.name}" (${region.bbox ? `box ${region.bbox.join(',')}` : `${region.skiAreas.length} ski area(s)`}) → ${path.relative(ROOT, OUT)}`);
  return { settings, resorts: [regionToResort(region)] };
}

async function main() {
  const config = loadConfig();
  const statePath = path.join(DIR.work, 'state.json');
  const state = readJson(statePath, {});

  // zoom: --terrain-zoom etc. > z<N> > resorts.json
  let zoom;
  try {
    zoom = resolveZoom(args, config.settings ?? {});
  } catch (err) {
    if (err instanceof ArgError) throw new Error(err.message);
    throw err;
  }
  if (onlySki) {
    // only the ski zoom is used; keep the terrain and basemap zoom of the last full build
    zoom.terrain = state.requestedZoom?.terrain ?? zoom.terrain;
    zoom.basemap = state.requestedZoom?.basemap ?? zoom.basemap;
    if (args.zoom.terrain !== null || args.zoom.basemap !== null) log('--only=ski: terrain and basemap zoom are ignored');
  }
  const settings = { ...(config.settings ?? {}), terrainMaxZoom: zoom.terrain, basemapMaxZoom: zoom.basemap, skiMaxZoom: zoom.ski };
  log(`Zoom levels: terrain ${zoom.terrain}, basemap ${zoom.basemap}, ski ${zoom.ski}`);
  if (zoom.basemap < 13 && !onlySki) {
    log('  note: below basemap zoom 13 the map has no huts or restaurants, so the search finds fewer places');
  }

  await downloadOpenSkiData();
  const resorts = resolveResorts(config);
  await extractResorts(resorts);
  await buildSkiTiles(resorts, settings);

  if (!onlySki) {
    const region = writeRegion(resorts);
    await extractBasemap(region, settings, state);
    writeJson(statePath, state);
    await extractTerrain(resorts, region, settings, state);
    writeJson(statePath, state);
    await buildContours(resorts, settings, state);
    writeJson(statePath, state);
    await downloadAssets();
  }

  await extractPlaces(resorts);
  const info = await writeBuildInfo(zoom, state);
  writeJson(statePath, state);
  writePlannerData(resorts, info.zoom);
  writeStylesAndConfig(resorts, settings);
  log(`Done (terrain z${info.zoom.terrain}, basemap z${info.zoom.basemap}, ski z${info.zoom.ski}).`);
}

main().catch((err) => {
  console.error(`\nBuild failed: ${err.message}`);
  process.exit(1);
});
