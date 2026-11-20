// Reference copy of the pure search logic from planner/public/app.js (before phase 1).
// Only change: searchLocal takes the index as a parameter instead of the module-level searchIndex.
const DIFFICULTY_INFO = {
  novice: { label: 'Green (novice)', color: '#2e9d3a' },
  easy: { label: 'Blue (easy)', color: '#1f6fd6' },
  intermediate: { label: 'Red (intermediate)', color: '#d8251d' },
  advanced: { label: 'Black (advanced)', color: '#111111' },
  expert: { label: 'Black ◆◆ (expert)', color: '#111111' },
  freeride: { label: 'Freeride / ski route', color: '#ef7d00' },
  unknown: { label: 'Unknown difficulty', color: '#7d7d7d' },
};
const PLACE_KINDS = {
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
const SEARCH_BOOST = {
  ski_area: 45, locality: 35, lift: 30, run: 30, peak: 25, alpine_hut: 25, restaurant: 18, cafe: 15,
  biergarten: 15, hotel: 12, guest_house: 10, bus_stop: 8, ski_school: 12, ski_rental: 10,
  parking: -15, toilets: -25, information: -15,
};

const normalize = (s) =>
  String(s)
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/\p{M}/gu, '');

const humanize = (s) => String(s ?? '').replaceAll('_', ' ').replace(/^\w/, (c) => c.toUpperCase());

function entrySub(e) {
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

function searchLocal(searchIndex, query) {
  const tokens = normalize(query).split(/\s+/).filter(Boolean);
  if (!tokens.length) return [];
  const joined = tokens.join(' ');
  const scored = [];
  for (const e of searchIndex) {
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
  const seen = new Set();
  const out = [];
  for (const [, e] of scored) {
    const key = `${e.type}|${e.kind}|${e.norm}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
    if (out.length >= 10) break;
  }
  return out;
}

export const prepareIndex = (entries) => entries.map((e) => ({ ...e, norm: normalize(e.name) }));
export { normalize, entrySub, searchLocal };
