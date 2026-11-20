// Search: local name index over runs, lifts and places, the ranking used by the search box, and the
// online lookup in OpenStreetMap Nominatim (online mode only, on explicit request).
// Google Maps short links are resolved by the desktop server (planner/search.mjs), not here.
import type { Position, ResortData } from './types.ts';

const LIFT_NAMES: Record<string, string> = {
  gondola: 'Gondola',
  cable_car: 'Cable car',
  mixed_lift: 'Gondola/chair combo',
  chair_lift: 'Chairlift',
  funicular: 'Funicular',
  railway: 'Railway',
  rack_railway: 'Rack railway',
  't-bar': 'T-bar',
  'j-bar': 'J-bar',
  platter: 'Platter lift',
  drag_lift: 'Drag lift',
  rope_tow: 'Rope tow',
  magic_carpet: 'Magic carpet',
};

export interface SearchEntry {
  type: 'run' | 'lift' | 'place';
  name: string;
  /** run kind (downhill, …), lift type name (Gondola, …) or place kind (peak, …) */
  kind: string;
  difficulty?: string | null;
  color?: string;
  elevation?: number | null;
  /** [lon, lat], where the pin goes */
  coordinates: [number, number];
  lines?: [number, number][][];
}

/** A search entry with its normalized name, ready for searchLocal. */
export type IndexedEntry = SearchEntry & { norm: string };

const round = (c: Position | readonly number[]): [number, number] => [Number(c[0].toFixed(5)), Number(c[1].toFixed(5))];

// Compact search index for one resort. Runs with the same name are grouped into one entry.
export function buildSearchIndex(data: Pick<ResortData, 'runs' | 'lifts' | 'places'>): SearchEntry[] {
  const entries: SearchEntry[] = [];

  const runGroups = new Map<string, { p: ResortData['runs'][number]['properties']; lines: Position[][] }>();
  for (const f of data.runs) {
    const p = f.properties;
    if (!p.label) continue;
    const key = `${p.label}|${p.kind}|${p.difficulty ?? ''}`;
    let group = runGroups.get(key);
    if (!group) runGroups.set(key, (group = { p, lines: [] }));
    group.lines.push(f.geometry.coordinates);
  }
  for (const { p, lines } of runGroups.values()) {
    // pin at the highest start point: where you would begin the run
    let start = lines[0][0];
    for (const l of lines) if ((l[0][2] ?? 0) > (start[2] ?? 0)) start = l[0];
    entries.push({
      type: 'run',
      name: p.label,
      kind: p.kind,
      difficulty: p.difficulty ?? null,
      color: p.color,
      coordinates: round(start),
      lines: lines.map((l) => l.map(round)),
    });
  }

  for (const f of data.lifts) {
    const p = f.properties;
    const c = f.geometry.coordinates;
    const bottom = (c[0][2] ?? 0) <= (c[c.length - 1][2] ?? 0) ? c[0] : c[c.length - 1];
    const liftName = LIFT_NAMES[p.liftType as string] as string | undefined;
    entries.push({
      type: 'lift',
      name: p.label || `Unnamed ${liftName?.toLowerCase() ?? 'lift'}`,
      kind: liftName ?? p.liftType ?? 'Lift',
      coordinates: round(bottom),
      lines: [c.map(round)],
    });
  }

  for (const pl of data.places ?? []) {
    entries.push({
      type: 'place',
      name: pl.name,
      kind: pl.kind,
      elevation: pl.elevation ?? null,
      coordinates: round(pl.coordinates),
    });
  }
  return entries;
}

// --- Local search (ranking of the search box) --------------------------------

export const DIFFICULTY_INFO: Record<string, { label: string; color: string }> = {
  novice: { label: 'Green (novice)', color: '#2e9d3a' },
  easy: { label: 'Blue (easy)', color: '#1f6fd6' },
  intermediate: { label: 'Red (intermediate)', color: '#d8251d' },
  advanced: { label: 'Black (advanced)', color: '#111111' },
  expert: { label: 'Black ◆◆ (expert)', color: '#111111' },
  freeride: { label: 'Freeride / ski route', color: '#ef7d00' },
  unknown: { label: 'Unknown difficulty', color: '#7d7d7d' },
};

export const PLACE_KINDS: Record<string, string> = {
  ski_area: 'Ski area',
  locality: 'Village / locality',
  peak: 'Peak',
  saddle: 'Mountain pass',
  hill: 'Hill',
  alpine_hut: 'Mountain hut',
  wilderness_hut: 'Hut',
  shelter: 'Shelter',
  restaurant: 'Restaurant',
  cafe: 'Café',
  biergarten: 'Beer garden',
  bar: 'Bar',
  pub: 'Pub',
  fast_food: 'Fast food',
  hotel: 'Hotel',
  guest_house: 'Guest house',
  apartment: 'Apartment',
  chalet: 'Chalet',
  hostel: 'Hostel',
  bus_stop: 'Bus stop',
  bus_station: 'Bus station',
  station: 'Station',
  parking: 'Parking',
  ski_school: 'Ski school',
  ski_rental: 'Ski rental',
  ski: 'Ski shop',
  winter_sports: 'Winter sports',
  viewpoint: 'Viewpoint',
  information: 'Information',
  place_of_worship: 'Church / chapel',
  ticket: 'Tickets',
};

/** Score bonus per entry type (runs, lifts) or place kind. */
export const SEARCH_BOOST: Record<string, number> = {
  ski_area: 45,
  locality: 35,
  lift: 30,
  run: 30,
  peak: 25,
  alpine_hut: 25,
  restaurant: 18,
  cafe: 15,
  biergarten: 15,
  hotel: 12,
  guest_house: 10,
  bus_stop: 8,
  ski_school: 12,
  ski_rental: 10,
  parking: -15,
  toilets: -25,
  information: -15,
};

/** Lower case, "ß" → "ss", accents removed: "Söllereck" → "sollereck". */
export const normalize = (s: unknown): string =>
  String(s)
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/\p{M}/gu, '');

export function prepareSearchIndex(entries: readonly SearchEntry[]): IndexedEntry[] {
  return entries.map((e) => ({ ...e, norm: normalize(e.name) }));
}

const humanize = (s: unknown): string =>
  String(s ?? '')
    .replaceAll('_', ' ')
    .replace(/^\w/, (c) => c.toUpperCase());

/** Second line of a search result ("Blue (easy) run · pin at the top"). */
export function entrySub(e: SearchEntry): string {
  if (e.type === 'run') {
    if (e.kind === 'downhill') return `${DIFFICULTY_INFO[e.difficulty ?? 'unknown']?.label ?? 'Run'} run · pin at the top`;
    if (e.kind === 'nordic') return 'Cross-country trail';
    if (e.kind === 'connection') return 'Connection path';
    return humanize(e.kind);
  }
  if (e.type === 'lift') return `${e.kind} · pin at the bottom station`;
  const kind = PLACE_KINDS[e.kind] ?? humanize(e.kind);
  return e.elevation ? `${kind} · ${e.elevation} m` : kind;
}

/** Best (at most `limit`) entries for a typed query. Every word must match. */
export function searchLocal<T extends IndexedEntry>(index: readonly T[], query: unknown, limit = 10): T[] {
  const tokens = normalize(query).split(/\s+/).filter(Boolean);
  if (!tokens.length) return [];
  const joined = tokens.join(' ');
  const scored: [number, T][] = [];
  for (const e of index) {
    let score = 0;
    for (const t of tokens) {
      const i = e.norm.indexOf(t);
      if (i < 0) {
        score = -1;
        break;
      }
      // a match right after a piste/lift number ("30 kanzelwandbahn") counts as a match at the start
      const afterRef = i > 0 && /^[\d\s,]+$/.test(e.norm.slice(0, i));
      score += i === 0 || afterRef ? 100 : /[\s\-/(,.'\d]/.test(e.norm[i - 1]) ? 60 : 15;
    }
    if (score < 0) continue;
    if (e.norm === joined) score += 80;
    score += SEARCH_BOOST[e.type === 'place' ? e.kind : e.type] ?? 0;
    score -= e.name.length * 0.3;
    scored.push([score, e]);
  }
  scored.sort((a, b) => b[0] - a[0]);
  const seen = new Set<string>();
  const out: T[] = [];
  for (const [, e] of scored) {
    const key = `${e.type}|${e.kind}|${e.norm}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
    if (out.length >= limit) break;
  }
  return out;
}

// --- Online geocoding (OpenStreetMap Nominatim, only on explicit request) ------

export class SearchError extends Error {}

export interface GeocodeHit {
  name: string;
  /** full address */
  sub: string;
  kind: string;
  lat: number;
  lon: number;
}

export interface GeocodeOptions {
  /** Extra request headers. A server should identify itself with a User-Agent (Nominatim policy);
   * browsers send their own User-Agent and Referer. */
  headers?: Record<string, string>;
  /** fetch implementation (for tests) */
  fetch?: typeof fetch;
}

const geocodeCache = new Map<string, GeocodeHit[]>();
let lastRequest = 0;

/** Look a text up in Nominatim. Waits so that there is at most one request per second. */
export async function geocode(query: unknown, viewbox?: readonly number[] | null, options: GeocodeOptions = {}): Promise<GeocodeHit[]> {
  const q = String(query ?? '')
    .trim()
    .slice(0, 200);
  if (q.length < 2) return [];
  const key = `${q}|${viewbox?.join(',') ?? ''}`;
  const cached = geocodeCache.get(key);
  if (cached) return cached;

  // Nominatim usage policy: max 1 request per second.
  const wait = lastRequest + 1100 - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastRequest = Date.now();

  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.search = new URLSearchParams({
    q,
    format: 'jsonv2',
    limit: '8',
    'accept-language': 'de,en',
    ...(viewbox ? { viewbox: viewbox.join(','), bounded: '0' } : {}),
  }).toString();
  const doFetch = options.fetch ?? fetch;
  let res: Response;
  try {
    res = await doFetch(url, { headers: options.headers, signal: AbortSignal.timeout(10000) });
  } catch {
    throw new SearchError('Online search is unavailable (are you online?)');
  }
  if (!res.ok) throw new SearchError(`Online search failed (${res.status})`);
  const rows = (await res.json()) as { name?: string; display_name: string; type: string; lat: string; lon: string }[];
  const hits = rows.map((r) => ({
    name: r.name || r.display_name.split(',')[0],
    sub: r.display_name,
    kind: r.type,
    lat: Number(r.lat),
    lon: Number(r.lon),
  }));
  geocodeCache.set(key, hits);
  return hits;
}
