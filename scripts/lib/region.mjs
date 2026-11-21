// One region for a single data ZIP ("Build region" on the desktop). Pure helpers shared by the build scripts and the
// desktop server; tested in scripts/test/region.test.mjs.
//
// A region is either a box drawn on the map (`bbox`, built exactly as drawn, no margin) or a list of ski areas
// (`skiAreas`, the area comes from their runs and lifts plus `marginKm`, like a resort in resorts.json):
//   { "id": "lech", "name": "Lech", "bbox": [10.1, 47.1, 10.3, 47.3], "zoom": { "terrain": 14, "basemap": 15, "ski": 16 } }
//   { "id": "ifen", "name": "Ifen", "skiAreas": [{ "id": "abc…", "name": "Skigebiet Ifen" }], "marginKm": 2 }
import { BASEMAP_ZOOM_RANGE, SKI_ZOOM_RANGE, TERRAIN_ZOOM_RANGE, countTiles, estimateTerrain } from './build-args.mjs';
import { bboxUnion, bboxValid, bufferBbox, emptyBbox, geometryBbox, roundBbox } from '../../packages/core/src/geo.ts';

/** Largest box side in degrees (about 220 km north-south). Bigger boxes are refused: the download would be huge. */
export const MAX_SPAN_DEG = 2;
export const MAX_MARGIN_KM = 20;
export const MAX_SKI_AREAS = 30;

export class RegionError extends Error {}

const ID_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;

/** "Lech – Zürs am Arlberg" → "lech-zurs-am-arlberg" */
export function slugify(text) {
  return String(text ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63)
    .replace(/-+$/, '');
}

function checkZoom(label, v, [min, max]) {
  if (v === undefined || v === null) return undefined;
  if (!Number.isInteger(v) || v < min || v > max) throw new RegionError(`${label} zoom must be a whole number from ${min} to ${max}.`);
  return v;
}

/** Checks a bbox [west, south, east, north] and returns it rounded to 5 decimals (about 1 m). */
export function checkBbox(bbox) {
  if (!Array.isArray(bbox) || bbox.length !== 4 || !bbox.every(Number.isFinite)) {
    throw new RegionError('The box needs four numbers: west, south, east, north.');
  }
  const [w, s, e, n] = bbox;
  if (w < -180 || e > 180 || s < -85 || n > 85) throw new RegionError('The box is outside the map (longitude -180..180, latitude -85..85).');
  if (w >= e || s >= n) throw new RegionError('The box is empty: west must be smaller than east and south smaller than north.');
  if (e - w > MAX_SPAN_DEG || n - s > MAX_SPAN_DEG) {
    throw new RegionError(`The box is too big (at most ${MAX_SPAN_DEG}° on each side). Draw a smaller box.`);
  }
  return bbox.map((v) => Math.round(v * 1e5) / 1e5);
}

/** Checks a region sent by the app or read from regions.json. Returns a clean copy; throws RegionError. */
export function validateRegion(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new RegionError('Invalid region.');
  const name = String(input.name ?? '').trim();
  if (!name) throw new RegionError('Give the region a name.');
  if (name.length > 100) throw new RegionError('The name is too long (at most 100 characters).');
  const id = String(input.id ?? '').trim() || slugify(name);
  if (!ID_RE.test(id)) throw new RegionError('The id may only have lowercase letters, digits and dashes (for example "lech-zurs").');

  const hasBbox = input.bbox !== undefined && input.bbox !== null;
  const hasAreas = Array.isArray(input.skiAreas) && input.skiAreas.length > 0;
  if (hasBbox === hasAreas) throw new RegionError('A region needs either a box or a list of ski areas (not both).');

  const out = { id, name };
  if (hasBbox) {
    out.bbox = checkBbox(input.bbox);
  } else {
    if (input.skiAreas.length > MAX_SKI_AREAS) throw new RegionError(`Pick at most ${MAX_SKI_AREAS} ski areas.`);
    out.skiAreas = input.skiAreas.map((a) => {
      if (typeof a === 'string' && a.trim()) return a.trim();
      if (a && typeof a === 'object' && typeof a.id === 'string' && /^[\w-]+$/.test(a.id)) {
        return a.name ? { id: a.id, name: String(a.name) } : { id: a.id };
      }
      throw new RegionError('Invalid ski area in the list.');
    });
    const margin = input.marginKm ?? 2;
    if (!Number.isFinite(margin) || margin < 0 || margin > MAX_MARGIN_KM) throw new RegionError(`The margin must be from 0 to ${MAX_MARGIN_KM} km.`);
    out.marginKm = margin;
  }

  if (input.zoom !== undefined && input.zoom !== null) {
    if (typeof input.zoom !== 'object') throw new RegionError('Invalid zoom.');
    const zoom = {
      terrain: checkZoom('Terrain', input.zoom.terrain, TERRAIN_ZOOM_RANGE),
      basemap: checkZoom('Basemap', input.zoom.basemap, BASEMAP_ZOOM_RANGE),
      ski: checkZoom('Ski', input.zoom.ski, SKI_ZOOM_RANGE),
    };
    for (const k of Object.keys(zoom)) if (zoom[k] === undefined) delete zoom[k];
    if (Object.keys(zoom).length) out.zoom = zoom;
  }
  return out;
}

/** The resort entry the data build uses for a region (same shape as a resorts.json resort). */
export function regionToResort(region) {
  const { zoom, ...resort } = region;
  return resort;
}

/** Command line for scripts/build-pwa-data.mjs. */
export function regionBuildArgs(region, { regionFile, outDir }) {
  const args = [`--region=${regionFile}`, `--out=${outDir}`, '--yes'];
  if (region.zoom?.terrain) args.push(`--terrain-zoom=${region.zoom.terrain}`);
  if (region.zoom?.basemap) args.push(`--basemap-zoom=${region.zoom.basemap}`);
  if (region.zoom?.ski) args.push(`--ski-zoom=${region.zoom.ski}`);
  return args;
}

/** ZIP name prefix of a region build: build/pwa/<id>-YYYY-MM-DD-z14.zip */
export const regionZipPrefix = (region) => region.id;

// --- ski areas (OpenSkiData ski_areas.geojson) ---

const fold = (s) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase();

/** What the app needs to show and pick a ski area. */
export function skiAreaSummary(f) {
  const p = f.properties ?? {};
  const loc = p.places?.[0]?.localized?.en ?? {};
  const runs = p.statistics?.runs?.byActivity?.downhill?.byDifficulty ?? {};
  const downhillKm = Object.values(runs).reduce((s, d) => s + (d?.lengthInKm ?? 0), 0);
  return {
    id: p.id,
    name: p.name ?? null,
    country: loc.country ?? null,
    region: loc.region ?? null,
    locality: loc.locality ?? null,
    activities: p.activities ?? [],
    status: p.status ?? null,
    downhillKm: Math.round(downhillKm),
    bbox: f.geometry ? roundBbox(geometryBbox(f.geometry)) : null,
  };
}

/**
 * Ski areas whose name matches every word of the query (accents and case ignored). Areas with downhill runs come
 * first, then by name match quality and size.
 */
export function searchSkiAreas(features, query, limit = 20) {
  const words = fold(query).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  if (!words.length) return [];
  const hits = [];
  for (const f of features) {
    const name = fold(f.properties?.name);
    if (!name || !words.every((w) => name.includes(w))) continue;
    const s = skiAreaSummary(f);
    const score = (s.activities.includes('downhill') ? 0 : 1000) + (name.startsWith(words[0]) ? 0 : 100) - Math.min(99, s.downhillKm / 5);
    hits.push({ s, score });
  }
  hits.sort((a, b) => a.score - b.score || String(a.s.name).localeCompare(String(b.s.name)));
  return hits.slice(0, limit).map((h) => h.s);
}

/**
 * The area a region will cover, for the preview and the size estimate. For ski areas this is their outline plus the
 * margin; the real build uses their runs and lifts, which can reach a little further.
 */
export function regionBbox(region, skiAreaFeatures = []) {
  if (region.bbox) return region.bbox;
  const byId = new Map(skiAreaFeatures.map((f) => [f.properties?.id, f]));
  const byName = new Map(skiAreaFeatures.map((f) => [f.properties?.name, f]));
  let b = emptyBbox();
  for (const a of region.skiAreas ?? []) {
    const f = typeof a === 'string' ? byName.get(a) : byId.get(a.id);
    if (f?.geometry) b = bboxUnion(b, geometryBbox(f.geometry));
  }
  if (!bboxValid(b)) return null;
  return roundBbox(bufferBbox(b, region.marginKm ?? 2));
}

/** Rough size of a region build: terrain tiles and bytes, basemap tiles, and the box size in km. */
export function estimateRegion(bbox, zoom) {
  const terrain = estimateTerrain([bbox], zoom.terrain);
  const midLat = ((bbox[1] + bbox[3]) / 2) * (Math.PI / 180);
  const widthKm = (bbox[2] - bbox[0]) * 111.32 * Math.cos(midLat);
  const heightKm = (bbox[3] - bbox[1]) * 110.57;
  let basemapTiles = 0;
  for (let z = 0; z <= zoom.basemap; z++) basemapTiles += countTiles([bbox], z);
  return {
    bbox,
    widthKm: Math.round(widthKm * 10) / 10,
    heightKm: Math.round(heightKm * 10) / 10,
    terrainTiles: terrain.tiles,
    terrainBytes: terrain.bytes,
    basemapTiles,
  };
}
