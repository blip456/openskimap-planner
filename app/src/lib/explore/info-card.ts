// Info cards for runs, lifts, lift stations, places and search pins (old planner: skiCard, skiCardFromTile,
// placeCard, liftRows, statsGrid, crumbsFor, tagList, linkList, the steepness note and pinActions).
// Pure: builds a view model that the InfoBody component renders. Unit-tested.
import type { FeatureDetails } from '@core/feature-info.ts';
import { CONNECTION_COLOR, LIFT_COLOR } from '@core/ski.ts';
import { SLOPE_CLASSES, slopeClass } from '@core/slope.ts';
import { DIFFICULTY_INFO, PLACE_KINDS } from '@core/search.ts';
import type { Position } from '@core/types.ts';
import { formatDistance } from '../format.ts';
import type { ProfileMode, ProfileRoute, ProfileStep } from '../route/profile.ts';
import { DIFFICULTY_SHORT } from '../route/profile.ts';

export type LngLat = [number, number];

export const LIFT_TYPE_NAMES: Record<string, string> = {
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
  zip_line: 'Zip line',
};
const GROOMING: Record<string, string> = {
  classic: 'Classic track',
  skating: 'Skating',
  'classic+skating': 'Classic + skating',
  mogul: 'Moguls',
  backcountry: 'Not groomed (backcountry)',
  scooter: 'Snowmobile track',
};
export const RUN_KINDS: Record<string, string> = {
  nordic: 'Cross-country trail',
  connection: 'Connection path',
  skitour: 'Ski touring route',
  sled: 'Sled run',
  hike: 'Winter hiking trail',
};
const LIFT_DIRECTION: Record<string, string> = {
  up: 'Up only ›',
  both: 'Both ways ‹ ›',
  unknown: 'Up › (riding down not specified in the data)',
};
const OFFICIAL_CLASS: Record<string, string> = { novice: 'green', easy: 'blue', intermediate: 'red', advanced: 'black', expert: 'black' };

export const humanize = (s: unknown): string =>
  String(s ?? '')
    .replaceAll('_', ' ')
    .replace(/^\w/, (c) => c.toUpperCase());
/** Old planner fmtKm: 2 decimals for km. */
export const fmtKm = (m: number): string => (m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${Math.round(m)} m`);
export const fmtSlope = (s: number): string => `${Math.round((Math.atan(s) * 180) / Math.PI)}° (${Math.round(s * 100)}%)`;

export function safeUrl(u: unknown): string | null {
  try {
    const url = new URL(String(u));
    return ['http:', 'https:'].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

export interface CardStat {
  label: string;
  value: string;
}
export interface CardLink {
  label: string;
  href: string;
}

export interface InfoCardModel {
  kind: 'run' | 'lift' | 'station' | 'place' | 'pin';
  title: string;
  /** piste or lift number in a coloured box before the title */
  badge: { text: string; color: string } | null;
  /** country › region › ski areas */
  crumbs: string[];
  /** e.g. "Red run", "Chairlift · 6 seats", "Peak · 2224 m" */
  subtitle: string | null;
  /** colour of the difficulty pill in front of the subtitle (runs), or of the lift dot */
  dot: string | null;
  /** the three key numbers (medium detent) */
  stats: CardStat[];
  /** all details (large detent) */
  rows: CardStat[];
  tags: string[];
  /** official colour vs. measured gradient */
  note: { text: string; tone: 'easier' | 'steeper' } | null;
  /** "This is one section of …" */
  pisteNote: string | null;
  description: string | null;
  links: CardLink[];
  /** one-step route for the elevation chart, or null */
  profile: ProfileRoute | null;
  profileMode: ProfileMode;
  /** where "Use this spot" puts the point: the tapped spot or the pin */
  position: LngLat;
  /** "47.40912, 10.27645" (pins) */
  coords: string | null;
  /** search pins from links without exact coordinates */
  approximate: string | null;
}

const blank = (kind: InfoCardModel['kind'], title: string, position: LngLat): InfoCardModel => ({
  kind,
  title,
  badge: null,
  crumbs: [],
  subtitle: null,
  dot: null,
  stats: [],
  rows: [],
  tags: [],
  note: null,
  pisteNote: null,
  description: null,
  links: [],
  profile: null,
  profileMode: 'official',
  position,
  coords: null,
  approximate: null,
});

type Props = Record<string, any>;
type LiftProps = { liftType?: string | null; occupancy?: number | null; capacity?: number | null; direction?: string | null; status?: string | null; name?: string | null };
type Stats = NonNullable<FeatureDetails['stats']>;

const rows = (list: [string, string | null | undefined][]): CardStat[] => list.filter((r): r is [string, string] => r[1] != null && r[1] !== '').map(([label, value]) => ({ label, value }));

function verticalText(st: Partial<Stats>): string | null {
  if (st.vertical == null) return null;
  return `${Math.round(st.vertical)} m (${Math.round(st.minEle ?? 0)} – ${Math.round(st.maxEle ?? 0)} m)`;
}

export function liftRows(lp: LiftProps, st: Partial<Stats>): CardStat[] {
  return rows([
    ['Direction', lp.direction ? (LIFT_DIRECTION[lp.direction] ?? null) : null],
    ['Distance', st.length != null ? fmtKm(st.length) : null],
    ['Vertical', verticalText(st)],
    ['Ride time', st.duration ? `${Math.round(st.duration / 60)} min` : null],
    ['Speed', st.speed ? `${st.speed.toFixed(1)} m/s` : null],
    ['Vertical speed', st.verticalSpeed ? `${Math.round(st.verticalSpeed)} m/min` : null],
    ['Slope (average)', st.avgSlope != null ? fmtSlope(st.avgSlope) : null],
    ['Capacity', lp.capacity ? `${lp.capacity} people/hour` : null],
    ['Status', lp.status && lp.status !== 'operating' ? humanize(lp.status) : null],
  ]);
}

/** Key numbers of a lift: Length · Rise · Ride time (spec §2.13). */
function liftStats(st: Partial<Stats>): CardStat[] {
  return rows([
    ['Length', st.length != null ? formatDistance(st.length) : null],
    ['Rise', st.vertical != null ? `${Math.round(st.vertical)} m` : null],
    ['Ride time', st.duration ? `${Math.round(st.duration / 60)} min` : null],
  ]);
}

export const liftTypeName = (liftType: unknown): string => LIFT_TYPE_NAMES[String(liftType)] ?? humanize(liftType ?? 'lift');

export function liftTitle(lp: LiftProps): string {
  const type = liftTypeName(lp.liftType);
  return lp.name || `Unnamed ${type.toLowerCase()}`;
}

/** "Chairlift · 6 seats" */
export function liftSubtitle(lp: LiftProps): string {
  return [liftTypeName(lp.liftType), lp.occupancy ? `${lp.occupancy} seats` : null].filter(Boolean).join(' · ');
}

export function crumbsFor(pr: Props): string[] {
  const areas = ((pr.skiAreas ?? []) as { name?: string }[])
    .map((a) => a.name)
    .filter(Boolean)
    .join(' / ');
  return [pr.place?.country, pr.place?.region, areas].filter((x): x is string => typeof x === 'string' && !!x);
}

function sourceLink(s: { type?: string; id?: string }): CardLink | null {
  const id = String(s.id ?? '');
  if (s.type === 'openstreetmap') {
    const [kind, num] = id.split('/');
    if (['way', 'node', 'relation'].includes(kind) && /^\d+$/.test(num)) return { label: 'OpenStreetMap', href: `https://www.openstreetmap.org/${kind}/${num}` };
  }
  if (s.type === 'skimap.org' && /^\d+$/.test(id)) return { label: 'Skimap.org', href: `https://skimap.org/SkiAreas/view/${id}` };
  return null;
}

export function linkList(pr: Props): CardLink[] {
  const links: CardLink[] = [];
  for (const s of (pr.sources ?? []) as { type?: string; id?: string }[]) {
    const l = sourceLink(s);
    if (l && !links.some((x) => x.href === l.href)) links.push(l);
  }
  for (const w of (pr.websites ?? []) as unknown[]) {
    const href = safeUrl(w);
    if (href) links.push({ label: 'Website', href });
  }
  if (typeof pr.wikidataID === 'string' && /^Q\d+$/.test(pr.wikidataID)) links.push({ label: 'Wikidata', href: `https://www.wikidata.org/wiki/${pr.wikidataID}` });
  return links;
}

/** Official colour vs. the steepest ~30 m section (old planner card-gradient note). */
export function steepnessNote(difficulty: unknown, maxSlope: number | null | undefined): InfoCardModel['note'] {
  const official = OFFICIAL_CLASS[String(difficulty)];
  if (!official || maxSlope == null) return null;
  const measured = slopeClass(maxSlope);
  if (!measured || measured.id === official) return null;
  const order = SLOPE_CLASSES.map((c) => c.id as string);
  const easier = order.indexOf(measured.id) < order.indexOf(official);
  const pct = Math.round(maxSlope * 100);
  return easier
    ? { tone: 'easier', text: `Marked ${official}, but the steepest section is only ${pct}%: by gradient this is a ${measured.id} run.` }
    : { tone: 'steeper', text: `Steeper than marked: the steepest section is ${pct}%, which is ${measured.id} by gradient.` };
}

/** One run or lift as a one-step route, so the route profile chart can draw it (lifts bottom → top). */
export function featureProfile(d: Pick<FeatureDetails, 'type' | 'geometry' | 'properties' | 'lift'>): ProfileRoute | null {
  if (d.geometry.type !== 'LineString') return null;
  let c = d.geometry.coordinates as Position[];
  if (c.length < 2 || !c.every((p) => p[2] != null)) return null;
  const isLift = d.type !== 'run';
  if (isLift && (c[0][2] ?? 0) > (c[c.length - 1][2] ?? 0)) c = [...c].reverse();
  const pr = d.properties;
  const step: ProfileStep = {
    type: isLift ? 'lift' : 'run',
    runKind: isLift ? null : (pr.kind ?? 'downhill'),
    difficulty: isLift ? null : (pr.difficulty ?? null),
    color: isLift ? LIFT_COLOR : (pr.color ?? null),
    coordinates: c,
    eleStart: c[0][2] as number,
    eleEnd: c[c.length - 1][2] as number,
    leg: 0,
    label: String((isLift ? (d.lift?.label ?? pr.label ?? pr.name) : (pr.name ?? pr.label)) ?? ''),
    liftType: isLift ? (d.lift?.liftType ?? pr.liftType ?? null) : null,
    down: false,
  };
  return { steps: [step], legs: [{ index: 0 }] };
}

const runColor = (pr: Props): string => (pr.kind === 'downhill' ? (pr.color ?? DIFFICULTY_INFO[pr.difficulty ?? 'unknown']?.color ?? CONNECTION_COLOR) : CONNECTION_COLOR);

/** Card from the worker's feature details (runs, lifts, lift stations). */
export function skiCardModel(d: FeatureDetails, clicked: LngLat): InfoCardModel {
  const pr = d.properties;
  const st: Partial<Stats> = d.stats ?? {};
  if (d.type === 'lift' || d.type === 'spot') {
    if (d.type === 'spot') {
      const pos = ({ bottom: 'Bottom station', top: 'Top station', middle: 'Middle station' } as Record<string, string>)[pr.position] ?? 'Lift station';
      const access = [pr.entry === true ? 'boarding' : pr.entry === false ? 'no boarding' : null, pr.exit === true ? 'exit' : pr.exit === false ? 'no exit' : null]
        .filter(Boolean)
        .join(', ');
      const card = blank('station', pr.name || pos, clicked);
      card.crumbs = crumbsFor(pr);
      card.dot = LIFT_COLOR;
      card.subtitle = `${pos}${d.lift ? ` of ${d.lift.label}` : ''}${access ? ` · ${access}` : ''}`;
      if (d.lift) {
        card.stats = liftStats(st);
        card.rows = liftRows(d.lift, st);
      }
      card.profile = featureProfile(d);
      card.links = linkList(pr);
      return card;
    }
    const card = blank('lift', liftTitle(pr), clicked);
    card.crumbs = crumbsFor(pr);
    card.badge = pr.ref ? { text: String(pr.ref), color: LIFT_COLOR } : null;
    card.dot = LIFT_COLOR;
    card.subtitle = liftSubtitle(pr);
    card.stats = liftStats(st);
    card.rows = liftRows(pr, st);
    card.tags = [pr.bubble && 'Bubble', pr.heating && 'Heated seats', pr.detachable && 'Detachable', pr.access && `Access: ${pr.access}`].filter(
      (t): t is string => typeof t === 'string',
    );
    card.profile = featureProfile(d);
    card.links = linkList(pr);
    return card;
  }

  const isDownhill = pr.kind === 'downhill';
  const diff = DIFFICULTY_INFO[pr.difficulty ?? 'unknown'];
  const color = runColor(pr);
  const card = blank('run', pr.name || (isDownhill ? 'Unnamed run' : (RUN_KINDS[pr.kind] ?? 'Unnamed trail')), clicked);
  card.crumbs = crumbsFor(pr);
  card.badge = pr.ref ? { text: String(pr.ref), color } : null;
  card.dot = color;
  card.subtitle = isDownhill ? `${DIFFICULTY_SHORT[pr.difficulty ?? 'unknown'] ?? 'Unknown'} run` : (RUN_KINDS[pr.kind] ?? humanize(pr.kind));
  card.stats = rows([
    ['Length', st.length != null ? formatDistance(st.length) : null],
    ['Descent', st.vertical != null ? `${Math.round(st.vertical)} m` : null],
    ['Steepest', st.maxSlope != null ? `${Math.round(st.maxSlope * 100)}%` : null],
  ]);
  card.rows = rows([
    ['Difficulty', isDownhill ? (diff?.label ?? null) : null],
    ['Distance', st.length != null ? fmtKm(st.length) : null],
    ['Vertical', verticalText(st)],
    ['Slope (average)', st.avgSlope != null ? fmtSlope(st.avgSlope) : null],
    ['Steepest section', st.maxSlope != null ? fmtSlope(st.maxSlope) : null],
    ['Grooming', pr.grooming ? (GROOMING[pr.grooming] ?? humanize(pr.grooming)) : null],
    ['Status', pr.status && pr.status !== 'operating' ? humanize(pr.status) : null],
  ]);
  card.tags = [pr.oneway === true && 'One-way', pr.lit && 'Lit at night', pr.snowmaking && 'Snowmaking', pr.gladed && 'Through trees', pr.patrolled && 'Patrolled'].filter(
    (t): t is string => typeof t === 'string',
  );
  if (isDownhill) card.note = steepnessNote(pr.difficulty, st.maxSlope);
  if (d.piste) {
    const diffs = d.piste.difficulties.map((x) => (DIFFICULTY_INFO[x]?.label ?? x).split(' ')[0].toLowerCase()).join(' / ');
    card.pisteNote = `This is one section of ${d.piste.name}: ${d.piste.sections} sections · ${fmtKm(d.piste.length)} in total · ${diffs}. The numbers on this card are for this section only.`;
  }
  card.profile = featureProfile(d);
  card.profileMode = 'steepness';
  card.description = typeof pr.description === 'string' && pr.description ? pr.description : null;
  card.links = linkList(pr);
  return card;
}

/** Fallback from the map tile's properties when the worker has no details (e.g. data from another build). */
export function tileCardModel(pr: Props, clicked: LngLat): InfoCardModel {
  const isLift = Boolean(pr.liftType);
  const color = isLift ? LIFT_COLOR : (pr.color ?? CONNECTION_COLOR);
  const card = blank(isLift ? 'lift' : 'run', isLift ? liftTitle(pr) : pr.name || 'Unnamed run', clicked);
  card.badge = pr.ref ? { text: String(pr.ref), color } : null;
  card.dot = color;
  card.subtitle = isLift ? liftSubtitle(pr) : (DIFFICULTY_INFO[pr.difficulty ?? 'unknown']?.label ?? null);
  return card;
}

/** Huts, peaks, villages… from the basemap. */
export function placeCardModel(pr: Props, clicked: LngLat): InfoCardModel {
  const kind = PLACE_KINDS[pr.kind] ?? humanize(pr.kind ?? 'Place');
  const card = blank('place', String(pr.name ?? kind), clicked);
  const ele = Number(pr.elevation);
  card.subtitle = Number.isFinite(ele) && ele ? `${kind} · ${Math.round(ele)} m` : kind;
  if (Number.isFinite(ele) && ele) card.stats = [{ label: 'Elevation', value: `${Math.round(ele)} m` }];
  return card;
}

export interface PinData {
  lat: number;
  lon: number;
  title?: string | null;
  sub?: string | null;
  approximate?: string | null;
  /** lines to highlight (runs, lifts) */
  lines?: [number, number][][];
}

export function pinCardModel(pin: PinData): InfoCardModel {
  const card = blank('pin', pin.title || 'Pin', [pin.lon, pin.lat]);
  card.subtitle = pin.sub ?? null;
  card.coords = `${pin.lat.toFixed(5)}, ${pin.lon.toFixed(5)}`;
  card.approximate = pin.approximate ?? null;
  return card;
}

// --- "Use this spot in your route" (old planner pinActions) ------------------------------------------------------

export type PinActionId = 'start' | 'destination' | 'replace-start' | 'set-destination' | 'add-stop' | 'add-after';
export interface PinAction {
  id: PinActionId;
  label: string;
  primary: boolean;
}

/** Buttons depending on how many points exist; the first one is the main action. */
export function pinActions(n: number): PinAction[] {
  if (n === 0) return [{ id: 'start', label: 'Start here', primary: true }];
  if (n === 1)
    return [
      { id: 'destination', label: 'Go here (destination)', primary: true },
      { id: 'replace-start', label: 'Replace start', primary: false },
    ];
  return [
    { id: 'set-destination', label: 'Set as destination', primary: true },
    { id: 'add-stop', label: 'Add as stop', primary: false },
    { id: 'add-after', label: 'Add after destination', primary: false },
    { id: 'replace-start', label: 'Replace start', primary: false },
  ];
}

/** The points after a pin action. */
export function applyPinAction(points: readonly LngLat[], id: PinActionId, p: LngLat): LngLat[] {
  const out = points.map((q) => [q[0], q[1]] as LngLat);
  const n = out.length;
  const pt: LngLat = [p[0], p[1]];
  switch (id) {
    case 'start':
    case 'destination':
    case 'add-after':
      out.push(pt);
      break;
    case 'replace-start':
      if (n) out[0] = pt;
      else out.push(pt);
      break;
    case 'set-destination':
      if (n) out[n - 1] = pt;
      else out.push(pt);
      break;
    case 'add-stop':
      out.splice(Math.max(0, n - 1), 0, pt);
      break;
  }
  return out;
}
