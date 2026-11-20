// Command line handling for the data build: zoom levels (`z<N>`, `--terrain-zoom=` ...), flags, tile estimate.
// Pure functions, tested in scripts/test/build-args.test.mjs.
import { tileRange } from '../../packages/core/src/geo.ts';

export const TERRAIN_ZOOM_RANGE = [1, 18];
export const BASEMAP_ZOOM_RANGE = [1, 15]; // Protomaps has no data above 15
export const SKI_ZOOM_RANGE = [8, 18]; // the ski tiles start at zoom 8
export const BASEMAP_NATIVE_MAX = 15;
export const CONFIRM_ABOVE_ZOOM = 16;

/**
 * Average size of one terrain tile (512 px WebP), measured on the Oberstdorf z14 extract:
 * 150-156 KB for zoom 12-14, 120-260 KB below. Higher zooms are assumed to be the same. Rough on purpose.
 */
export const AVG_TERRAIN_TILE_BYTES = 155_000;

const FLAGS = new Set(['only', 'refresh', 'refresh-basemap', 'yes']);
const ZOOM_FLAGS = { 'terrain-zoom': 'terrain', 'basemap-zoom': 'basemap', 'ski-zoom': 'ski' };
const ZOOM_RANGES = { terrain: TERRAIN_ZOOM_RANGE, basemap: BASEMAP_ZOOM_RANGE, ski: SKI_ZOOM_RANGE };

export class ArgError extends Error {}

function parseZoomValue(label, text, [min, max]) {
  if (!/^\d+$/.test(text)) throw new ArgError(`${label}: "${text}" is not a whole number. Use a number from ${min} to ${max}.`);
  const n = Number(text);
  if (n < min || n > max) throw new ArgError(`${label}: ${n} is out of range. Use a number from ${min} to ${max}.`);
  return n;
}

/**
 * Parses process.argv.slice(2).
 * Returns { only, refresh, refreshBasemap, yes, zoom: { terrain, basemap, ski } } where each zoom is a number
 * or null (null = use resorts.json). `z<N>` gives terrain N and basemap min(N, 15); long flags override it.
 */
export function parseBuildArgs(argv) {
  const out = { only: null, refresh: false, refreshBasemap: false, yes: false, shortZoom: null, zoom: { terrain: null, basemap: null, ski: null } };
  const longZoom = {};
  for (const arg of argv) {
    if (/^z/i.test(arg) && !arg.startsWith('--')) {
      if (!/^z\d+$/.test(arg)) throw new ArgError(`Unknown zoom "${arg}". Write it like z12 (a number from ${TERRAIN_ZOOM_RANGE[0]} to ${TERRAIN_ZOOM_RANGE[1]}).`);
      if (out.shortZoom !== null) throw new ArgError(`Zoom given twice (${out.shortZoom} and ${arg}). Use only one z<N>.`);
      out.shortZoom = parseZoomValue(`Zoom ${arg}`, arg.slice(1), TERRAIN_ZOOM_RANGE);
      continue;
    }
    if (!arg.startsWith('--')) throw new ArgError(`Unknown argument "${arg}". Use z<N> (for example z12) or --terrain-zoom=, --basemap-zoom=, --ski-zoom=.`);
    const eq = arg.indexOf('=');
    const key = arg.slice(2, eq < 0 ? undefined : eq);
    const value = eq < 0 ? null : arg.slice(eq + 1);
    if (key in ZOOM_FLAGS) {
      if (value === null || value === '') throw new ArgError(`--${key} needs a number, for example --${key}=${key === 'ski-zoom' ? 16 : 14}.`);
      const which = ZOOM_FLAGS[key];
      longZoom[which] = parseZoomValue(`--${key}`, value, ZOOM_RANGES[which]);
    } else if (FLAGS.has(key)) {
      if (key === 'only') {
        if (value !== 'ski') throw new ArgError('--only only supports --only=ski.');
        out.only = 'ski';
      } else if (value !== null) {
        throw new ArgError(`--${key} does not take a value.`);
      } else {
        out[key === 'refresh-basemap' ? 'refreshBasemap' : key] = true;
      }
    } else {
      throw new ArgError(`Unknown option --${key}.`);
    }
  }
  if (out.shortZoom !== null) {
    out.zoom.terrain = out.shortZoom;
    out.zoom.basemap = Math.min(out.shortZoom, BASEMAP_NATIVE_MAX);
  }
  for (const k of Object.keys(longZoom)) out.zoom[k] = longZoom[k];
  return out;
}

/** Zoom levels to build: command line first, then resorts.json settings, then the defaults. */
export function resolveZoom(parsed, settings = {}) {
  const pick = (cli, setting, fallback, [min, max]) => {
    const v = cli ?? setting ?? fallback;
    if (!Number.isInteger(v) || v < min || v > max) throw new ArgError(`resorts.json: zoom ${v} is out of range (${min}-${max}).`);
    return v;
  };
  return {
    terrain: pick(parsed.zoom.terrain, settings.terrainMaxZoom, 14, TERRAIN_ZOOM_RANGE),
    basemap: pick(parsed.zoom.basemap, settings.basemapMaxZoom, 15, BASEMAP_ZOOM_RANGE),
    ski: pick(parsed.zoom.ski, settings.skiMaxZoom, 16, SKI_ZOOM_RANGE),
  };
}

/** Number of tiles of one zoom level that cover the given bboxes (a resort can overlap another, so this is an upper bound). */
export function countTiles(bboxes, z) {
  let n = 0;
  for (const bbox of bboxes) {
    const t = tileRange(bbox, z);
    n += (t.x1 - t.x0 + 1) * (t.y1 - t.y0 + 1);
  }
  return n;
}

/** Estimate for terrain zoom 0..maxZoom: { perZoom: [{ z, tiles }], tiles, bytes }. */
export function estimateTerrain(bboxes, maxZoom, avgTileBytes = AVG_TERRAIN_TILE_BYTES) {
  const perZoom = [];
  let tiles = 0;
  for (let z = 0; z <= maxZoom; z++) {
    const n = countTiles(bboxes, z);
    perZoom.push({ z, tiles: n });
    tiles += n;
  }
  return { perZoom, tiles, bytes: tiles * avgTileBytes };
}

export function formatBytes(n) {
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(2)} GB`;
  if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${n} B`;
}
