// Parsing of typed coordinates and Google Maps links. Shared by the app and the desktop server.
//
// Coordinates (latitude first unless hemispheres say otherwise):
//   47.3481, 10.2160        47.3481 10.2160        47.3481N 10.2160E       -33.86, 151.21
//   47°20'53.4"N 10°12'57.7"E   (Google Maps "copy coordinates")
//   N 47° 20.890' E 010° 12.962'  (degrees + decimal minutes)
//   47°20'N 10°12'O         (German "O" = Ost/east)       geo:47.3481,10.2160
//
// Google Maps links:
//   https://www.google.com/maps/place/Name/@47.1,10.2,15z/data=...!3d47.1!4d10.2...
//   https://maps.google.com/?q=47.1,10.2       https://www.google.com/maps/search/47.1,+10.2
//   Short links (maps.app.goo.gl/…, goo.gl/maps/…) need the server to follow the redirect.

const HEMISPHERES: Record<string, 'lat' | 'lon'> = { N: 'lat', S: 'lat', E: 'lon', W: 'lon', O: 'lon' };

function groupValue(nums: string[]): number | null {
  if (nums.length === 0 || nums.length > 3) return null;
  const [d, m = 0, s = 0] = nums.map((n) => Number(n));
  if (nums.length > 1 && (!Number.isInteger(Math.abs(d)) || m < 0 || m >= 60 || s < 0 || s >= 60)) return null;
  if (nums.length > 2 && !Number.isInteger(m)) return null;
  const sign = String(nums[0]).startsWith('-') ? -1 : 1;
  return sign * (Math.abs(d) + m / 60 + s / 3600);
}

export interface LatLon {
  lat: number;
  lon: number;
}

interface Token {
  t: 'hemi' | 'num' | 'sep';
  v: string;
  unit?: string | null;
}
interface Group {
  nums: string[];
  hemi?: string | null;
}

export function parseCoordinates(input: unknown): LatLon | null {
  if (input == null) return null;
  let s = String(input)
    .trim()
    .toUpperCase()
    .replace(/^GEO:/, '')
    .replace(/[?;]Z=.*$|\?.*$/, '')
    .replace(/[′’‘`´]/g, "'")
    .replace(/[″“”]/g, '"')
    .replace(/''/g, '"')
    .replace(/[º˚]/g, '°')
    .replace(/(\d)\s*DEG\b/g, '$1°');
  if (!/\d/.test(s) || !/^[\d\s.,;:°'"NSEWO+\-]+$/.test(s)) return null;

  const tokens: Token[] = [];
  for (const m of s.matchAll(/([NSEWO])|([+-]?\d+(?:\.\d+)?)\s*([°'"])?|([,;])/g)) {
    if (m[1]) tokens.push({ t: 'hemi', v: m[1] });
    else if (m[2]) tokens.push({ t: 'num', v: m[2].replace(/^\+/, ''), unit: m[3] ?? null });
    else if (m[4]) tokens.push({ t: 'sep', v: m[4] });
  }

  let groups: Group[] = [];
  const hasHemi = tokens.some((t) => t.t === 'hemi');
  if (hasHemi) {
    const prefix = tokens.find((t) => t.t !== 'sep')?.t === 'hemi';
    let cur: Group = { nums: [], hemi: null };
    for (const tok of tokens) {
      if (tok.t === 'sep') continue;
      if (tok.t === 'hemi') {
        if (prefix) {
          if (cur.nums.length || cur.hemi) groups.push(cur);
          cur = { nums: [], hemi: tok.v };
        } else {
          cur.hemi = tok.v;
          groups.push(cur);
          cur = { nums: [], hemi: null };
        }
      } else {
        cur.nums.push(tok.v);
      }
    }
    if (cur.nums.length) groups.push(cur);
    if (groups.length !== 2 || groups.some((g) => !g.hemi)) return null;
  } else {
    const nums = tokens.filter((t) => t.t === 'num');
    const seps = tokens.filter((t) => t.t === 'sep').length;
    if (seps === 1) {
      let cur: string[] = [];
      for (const tok of tokens) {
        if (tok.t === 'sep') {
          groups.push({ nums: cur });
          cur = [];
        } else cur.push(tok.v);
      }
      groups.push({ nums: cur });
    } else if (seps === 0 && nums.some((n) => n.unit === '°')) {
      let cur: string[] = [];
      for (const n of nums) {
        if (n.unit === '°' && cur.length) {
          groups.push({ nums: cur });
          cur = [];
        }
        cur.push(n.v);
      }
      groups.push({ nums: cur });
    } else if (seps === 0 && nums.length === 2) {
      // plain "47.34 10.21": require decimals so things like "lift 12 3" never match
      if (!nums.every((n) => n.v.includes('.'))) return null;
      groups = [{ nums: [nums[0].v] }, { nums: [nums[1].v] }];
    } else {
      return null;
    }
    if (groups.length !== 2) return null;
  }

  const values = groups.map((g) => {
    let v = groupValue(g.nums);
    if (v != null && (g.hemi === 'S' || g.hemi === 'W')) v = -Math.abs(v);
    return v;
  });
  if (values.some((v) => v == null || !Number.isFinite(v))) return null;

  let lat: number;
  let lon: number;
  if (hasHemi) {
    const axes = groups.map((g) => HEMISPHERES[g.hemi as string]);
    if (axes[0] === axes[1]) return null;
    [lat, lon] = (axes[0] === 'lat' ? values : [values[1], values[0]]) as [number, number];
  } else {
    [lat, lon] = values as [number, number];
    if (Math.abs(lat) > 90 && Math.abs(lon) <= 90) [lat, lon] = [lon, lat];
  }
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat, lon };
}

const GOOGLE_LINK = /^(?:https?:\/\/)?(?:(?:www\.|maps\.)?google\.[a-z.]{2,6}\/maps|maps\.google\.[a-z.]{2,6}|maps\.app\.goo\.gl\/|goo\.gl\/maps\/|g\.co\/kgs\/)/i;
const SHORT_LINK = /^(?:https?:\/\/)?(?:maps\.app\.goo\.gl\/|goo\.gl\/maps\/|g\.co\/kgs\/)/i;

export const isGoogleMapsLink = (text: unknown): boolean => GOOGLE_LINK.test(String(text).trim());
export const isShortLink = (text: unknown): boolean => SHORT_LINK.test(String(text).trim());

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

// Returns { lat, lon, precise, label, query } or null. lat/lon are null when the link only has a name/address.
export interface GoogleMapsLocation {
  lat: number | null;
  lon: number | null;
  precise: boolean;
  label: string | null;
  query: string | null;
}

export function parseGoogleMapsUrl(text: unknown): GoogleMapsLocation | null {
  const raw = String(text).trim();
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return null;
  }
  const path = safeDecode(url.pathname.replace(/\+/g, ' '));
  const full = safeDecode(url.href);
  let label: string | null = null;
  let query: string | null = null;

  const place = path.match(/\/place\/([^/]+)/);
  if (place && !parseCoordinates(place[1])) label = place[1].trim();

  for (const key of ['q', 'query', 'll', 'center', 'destination', 'daddr', 'sll']) {
    const value = url.searchParams.get(key);
    if (!value) continue;
    const c = parseCoordinates(value.replace(/^loc:/i, ''));
    if (c) return { ...c, precise: true, label, query };
    if (['q', 'query', 'destination', 'daddr'].includes(key) && !query) query = value.trim();
  }

  // exact place position inside the data=… blob
  const d = [...full.matchAll(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/g)].at(-1);
  if (d) return { lat: Number(d[1]), lon: Number(d[2]), precise: true, label, query };

  for (const seg of path.split('/').reverse()) {
    if (!seg || seg.startsWith('@')) continue;
    const c = parseCoordinates(seg);
    if (c) return { ...c, precise: true, label, query };
  }

  // map view centre: usually close to the place, but not exact
  const at = full.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
  if (at) return { lat: Number(at[1]), lon: Number(at[2]), precise: false, label, query };

  if (label || query) return { lat: null, lon: null, precise: false, label, query: query ?? label };
  return null;
}
