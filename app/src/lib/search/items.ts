// Search result rows (old planner: runSearch, coordinateItem, googleItem, onlineItem, entrySub/entryIcon).
// Pure, unit-tested. What a query is: coordinates, a Google Maps link (full links are read here, short links need
// the desktop server), or a name for the local search. "Search online" only appears in online mode.
import { isGoogleMapsLink, isShortLink, parseCoordinates, parseGoogleMapsUrl, type GoogleMapsLocation } from '@core/geoparse.ts';
import { entrySub, type GeocodeHit, type SearchEntry } from '@core/search.ts';
import { CONNECTION_COLOR, LIFT_COLOR } from '@core/ski.ts';
import type { PinData } from '../explore/info-card.ts';

export type SearchIcon = 'mountainSnow' | 'cableCar' | 'house' | 'crosshair' | 'mapPin' | 'globe' | 'loader' | 'triangleAlert' | 'search';

export interface SearchItem {
  key: string;
  title: string;
  sub: string;
  icon: SearchIcon;
  /** tile colour (CSS colour or var()) */
  color: string;
  /** picking it drops a pin here */
  pin?: PinData;
  /** picking it searches this text online */
  online?: string;
  /** not pickable (messages: no matches, resolving…, errors) */
  disabled?: boolean;
  error?: boolean;
}

export type Query =
  | { kind: 'empty' }
  | { kind: 'coords'; lat: number; lon: number }
  /** `local`: what the link itself says; `precise`: the link has exact coordinates (no server needed) */
  | { kind: 'google'; text: string; local: GoogleMapsLocation | null; precise: boolean; short: boolean }
  | { kind: 'text'; text: string };

export function classifyQuery(input: string): Query {
  const text = input.trim();
  if (!text) return { kind: 'empty' };
  const coords = parseCoordinates(text);
  if (coords) return { kind: 'coords', lat: coords.lat, lon: coords.lon };
  if (isGoogleMapsLink(text)) {
    const short = isShortLink(text);
    const local = short ? null : parseGoogleMapsUrl(text);
    return { kind: 'google', text, local, precise: !!(local && local.lat != null && local.precise), short };
  }
  return { kind: 'text', text };
}

const PLACE_HOUSE = new Set(['locality', 'alpine_hut', 'wilderness_hut', 'shelter', 'hotel', 'guest_house', 'apartment', 'chalet', 'hostel', 'restaurant', 'cafe']);

/** One local search hit as a row. Runs pin at the top, lifts at the bottom station (the index decides). */
export function entryItem(e: SearchEntry): SearchItem {
  const sub = entrySub(e);
  const base = { key: `${e.type}:${e.kind}:${e.name}`, title: e.name, sub, pin: { lat: e.coordinates[1], lon: e.coordinates[0], title: e.name, sub: sub.split(' · pin')[0], lines: e.lines } };
  if (e.type === 'run') return { ...base, icon: 'mountainSnow', color: e.kind === 'downhill' ? (e.color ?? 'var(--piste-unknown)') : CONNECTION_COLOR };
  if (e.type === 'lift') return { ...base, icon: 'cableCar', color: LIFT_COLOR };
  return { ...base, icon: PLACE_HOUSE.has(e.kind) ? 'house' : 'mountainSnow', color: 'var(--gray)' };
}

export function coordinateItem(lat: number, lon: number, extra: { title?: string; sub?: string; pinSub?: string | null; approximate?: string | null; icon?: SearchIcon; color?: string } = {}): SearchItem {
  return {
    key: `coords:${lat},${lon}`,
    title: extra.title ?? `${lat.toFixed(5)}, ${lon.toFixed(5)}`,
    sub: extra.sub ?? 'Coordinates · drop a pin',
    icon: extra.icon ?? 'crosshair',
    color: extra.color ?? 'var(--teal)',
    pin: { lat, lon, title: extra.title ?? 'Coordinates', sub: extra.pinSub ?? null, approximate: extra.approximate ?? null },
  };
}

/** What the desktop server's /api/resolve answers (or a full link read locally). */
export interface GoogleResult {
  lat: number;
  lon: number;
  label?: string | null;
  query?: string | null;
  precise?: boolean;
  approximate?: boolean;
  source?: string;
}

export function googleItem(r: GoogleResult): SearchItem {
  const title = r.label || r.query || 'Google Maps location';
  let sub = `Google Maps · ${r.lat.toFixed(5)}, ${r.lon.toFixed(5)}`;
  let note: string | null = null;
  if (r.source === 'nominatim') {
    sub = 'Address from the link, located with OpenStreetMap';
    note = 'Approximate: the link had no coordinates, so the address was looked up in OpenStreetMap.';
  } else if (r.approximate || r.precise === false) {
    note = 'Approximate: taken from the map view of the link.';
  }
  return coordinateItem(r.lat, r.lon, { title, sub, pinSub: r.query && r.query !== title ? r.query : 'Google Maps link', approximate: note, icon: 'mapPin', color: 'var(--red)' });
}

export function onlineItem(text: string): SearchItem {
  return { key: `online:${text}`, title: `Search online for “${text}”`, sub: 'Uses OpenStreetMap (online mode)', icon: 'globe', color: 'var(--accent)', online: text };
}

export function geocodeItem(h: GeocodeHit): SearchItem {
  return { key: `geo:${h.lat},${h.lon}:${h.name}`, title: h.name, sub: h.sub, icon: 'globe', color: 'var(--gray)', pin: { lat: h.lat, lon: h.lon, title: h.name, sub: h.sub } };
}

export const message = (title: string, sub = '', opts: { error?: boolean; icon?: SearchIcon } = {}): SearchItem => ({
  key: `msg:${title}`,
  title,
  sub,
  icon: opts.icon ?? (opts.error ? 'triangleAlert' : 'search'),
  color: opts.error ? 'var(--red)' : 'var(--gray)',
  disabled: true,
  error: opts.error,
});

export const NO_MATCHES = message('No matches', 'Try another name, coordinates or a Google Maps link');
export const RESOLVING = message('Resolving Google Maps link…', 'Following the link to find its location', { icon: 'loader' });
export const OFFLINE_HINT = 'Online search is off. Turn on online mode in Settings.';
export const NO_NETWORK_HINT = 'No internet right now, so online search is not available.';
export const SHORT_LINK_OFFLINE_HINT = 'Short Google Maps links need internet and online mode. Paste the long address instead.';
export const SHORT_LINK_HINT = 'Short Google Maps links (maps.app.goo.gl) only work in the desktop app. Open the link in a browser and paste the long address from there.';

/** Rows for a name search: local hits, then "Search online" (online mode, 3+ letters), or "No matches". */
/**
 * Rows for a text search. The "Search online" row needs online mode AND a network (`network`, default true); without
 * matches a footnote says why there is no online search.
 */
export function textItems(text: string, hits: readonly SearchEntry[], online: boolean, network = true): { items: SearchItem[]; footnote: string | null } {
  const items = hits.map(entryItem);
  if (online && network && text.trim().length >= 3) items.push(onlineItem(text.trim()));
  if (!items.length) items.push(NO_MATCHES);
  const footnote = hits.length ? null : !online ? OFFLINE_HINT : !network ? NO_NETWORK_HINT : null;
  return { items, footnote };
}

/** Index of the next pickable row (↑/↓ wrap around); -1 when there is none. */
export function moveActive(items: readonly SearchItem[], current: number, delta: 1 | -1): number {
  const enabled = items.map((it, i) => (it.disabled ? -1 : i)).filter((i) => i >= 0);
  if (!enabled.length) return -1;
  const pos = enabled.indexOf(current);
  if (pos < 0) return delta > 0 ? enabled[0] : enabled[enabled.length - 1];
  return enabled[(pos + delta + enabled.length) % enabled.length];
}

export const firstEnabled = (items: readonly SearchItem[]): number => items.findIndex((it) => !it.disabled);
