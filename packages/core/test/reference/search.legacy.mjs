// Search support: local name index, Google Maps link resolving and (opt-in) online geocoding.
import { isGoogleMapsLink, parseGoogleMapsUrl } from './geoparse.legacy.mjs';

const LIFT_NAMES = {
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

const round = (c) => [Number(c[0].toFixed(5)), Number(c[1].toFixed(5))];

// Compact search index for one resort. Runs with the same name are grouped into one entry.
export function buildSearchIndex(data) {
  const entries = [];

  const runGroups = new Map();
  for (const f of data.runs) {
    const p = f.properties;
    if (!p.label) continue;
    const key = `${p.label}|${p.kind}|${p.difficulty ?? ''}`;
    if (!runGroups.has(key)) runGroups.set(key, { p, lines: [] });
    runGroups.get(key).lines.push(f.geometry.coordinates);
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
    const bottom = (c[0][2] ?? 0) <= (c.at(-1)[2] ?? 0) ? c[0] : c.at(-1);
    entries.push({
      type: 'lift',
      name: p.label || `Unnamed ${LIFT_NAMES[p.liftType]?.toLowerCase() ?? 'lift'}`,
      kind: LIFT_NAMES[p.liftType] ?? p.liftType ?? 'Lift',
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

// --- Google Maps links ------------------------------------------------------

const ALLOWED_HOSTS = /^(?:maps\.app\.goo\.gl|goo\.gl|g\.co|consent\.google\.com|(?:www\.|maps\.)?google\.[a-z.]{2,6})$/i;
// A full browser user agent makes the shortener answer with a JavaScript page instead of a plain redirect.
const BROWSER_HEADERS = { 'User-Agent': 'Mozilla/5.0', 'Accept-Language': 'en,de;q=0.8' };

export class SearchError extends Error {}

export async function resolveGoogleLink(input, viewbox) {
  const text = String(input ?? '').trim();
  if (!isGoogleMapsLink(text)) throw new SearchError('Not a Google Maps link');

  let url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
  let best = null;
  for (let hop = 0; hop < 8; hop++) {
    if (!['http:', 'https:'].includes(url.protocol) || !ALLOWED_HOSTS.test(url.hostname)) break;
    if (url.hostname === 'consent.google.com') {
      const next = url.searchParams.get('continue');
      if (!next) break;
      url = new URL(next);
      continue;
    }
    const parsed = parseGoogleMapsUrl(url.href);
    if (parsed?.lat != null && parsed.precise) return { ...parsed, source: 'google' };
    if (parsed) {
      best = {
        lat: parsed.lat ?? best?.lat ?? null,
        lon: parsed.lon ?? best?.lon ?? null,
        precise: false,
        label: parsed.label ?? best?.label ?? null,
        query: parsed.query ?? best?.query ?? null,
      };
    }
    let res;
    try {
      res = await fetch(url, { redirect: 'manual', headers: BROWSER_HEADERS, signal: AbortSignal.timeout(8000) });
    } catch {
      throw new SearchError('Could not reach Google to resolve the link (are you online?)');
    }
    const location = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && location) {
      url = new URL(location, url);
      continue;
    }
    if (res.status === 404) throw new SearchError('This Google Maps link does not exist (404)');
    break;
  }

  if (best?.lat != null) return { ...best, source: 'google', approximate: true };
  const query = best?.query ?? best?.label;
  if (query) {
    // Shared "address" links contain no coordinates; look the address up in OpenStreetMap instead.
    const hits = await geocode(query, viewbox);
    if (hits.length) return { ...hits[0], label: best?.label ?? hits[0].name, query, precise: false, approximate: true, source: 'nominatim' };
    throw new SearchError(`The link only contains the address "${query}", which OpenStreetMap could not find.`);
  }
  throw new SearchError('No location found in this link');
}

// --- Online geocoding (OpenStreetMap Nominatim, only on explicit request) ------

const cache = new Map();
let lastRequest = 0;

export async function geocode(query, viewbox) {
  const q = String(query ?? '').trim().slice(0, 200);
  if (q.length < 2) return [];
  const key = `${q}|${viewbox?.join(',') ?? ''}`;
  if (cache.has(key)) return cache.get(key);

  // Nominatim usage policy: max 1 request per second, identify the application.
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
  });
  let res;
  try {
    res = await fetch(url, {
      headers: { 'User-Agent': 'openskimap-local-planner/0.1 (personal local use)' },
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    throw new SearchError('Online search is unavailable (are you online?)');
  }
  if (!res.ok) throw new SearchError(`Online search failed (${res.status})`);
  const hits = (await res.json()).map((r) => ({
    name: r.name || r.display_name.split(',')[0],
    sub: r.display_name,
    kind: r.type,
    lat: Number(r.lat),
    lon: Number(r.lon),
  }));
  cache.set(key, hits);
  return hits;
}
