// Google Maps link resolving for the desktop server. The local search index and the online geocoding
// live in the shared core (packages/core/src/search.ts).
import { isGoogleMapsLink, parseGoogleMapsUrl } from '../packages/core/src/geoparse.ts';
import { SearchError, geocode } from '../packages/core/src/search.ts';

// Nominatim usage policy: identify the application. (Browsers send their own User-Agent.)
export const NOMINATIM_HEADERS = { 'User-Agent': 'openskimap-local-planner/0.1 (personal local use)' };

// --- Google Maps links ------------------------------------------------------

const ALLOWED_HOSTS = /^(?:maps\.app\.goo\.gl|goo\.gl|g\.co|consent\.google\.com|(?:www\.|maps\.)?google\.[a-z.]{2,6})$/i;
// A full browser user agent makes the shortener answer with a JavaScript page instead of a plain redirect.
const BROWSER_HEADERS = { 'User-Agent': 'Mozilla/5.0', 'Accept-Language': 'en,de;q=0.8' };

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
    const hits = await geocode(query, viewbox, { headers: NOMINATIM_HEADERS });
    if (hits.length) return { ...hits[0], label: best?.label ?? hits[0].name, query, precise: false, approximate: true, source: 'nominatim' };
    throw new SearchError(`The link only contains the address "${query}", which OpenStreetMap could not find.`);
  }
  throw new SearchError('No location found in this link');
}
