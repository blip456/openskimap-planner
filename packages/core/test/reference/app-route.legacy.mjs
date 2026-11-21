// Reference copy of pure functions from the old planner frontend (planner/public/app.js), cut out unchanged
// before planner/ was removed in phase 4b (same extractor as the phase 4a parity test). Used by
// app/test/legacy-parity.test.ts. Only additions: this header and the export line. Do not edit.
// pinActions needs `state` and `pointsChanged` from the old app; the test passes them in with withState().
const DIFFICULTY_INFO = {
  novice: { label: 'Green (novice)', color: '#2e9d3a' },
  easy: { label: 'Blue (easy)', color: '#1f6fd6' },
  intermediate: { label: 'Red (intermediate)', color: '#d8251d' },
  advanced: { label: 'Black (advanced)', color: '#111111' },
  expert: { label: 'Black ◆◆ (expert)', color: '#111111' },
  freeride: { label: 'Freeride / ski route', color: '#ef7d00' },
  unknown: { label: 'Unknown difficulty', color: '#7d7d7d' },
};

const LIFT_COLOR = '#7b1fa2';

const WALK_COLOR = '#5f6b75';

const SLOPE_CLASSES = [
  { id: 'green', max: 0.1, color: '#2e9d3a', label: '< 10%', name: 'green' },
  { id: 'blue', max: 0.25, color: '#1f6fd6', label: '10–25%', name: 'blue' },
  { id: 'red', max: 0.4, color: '#d8251d', label: '25–40%', name: 'red' },
  { id: 'black', max: Infinity, color: '#111111', label: '> 40%', name: 'black' },
];

const OFFICIAL_CLASS = { novice: 'green', easy: 'blue', intermediate: 'red', advanced: 'black', expert: 'black' };

const slopeClass = (s) => SLOPE_CLASSES.find((c) => s < c.max);

function haversineM(a, b) {
  const R = 6371008.8;
  const toRad = (x) => (x * Math.PI) / 180;
  const dLat = toRad(b[1] - a[1]);
  const dLon = toRad(b[0] - a[0]);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}
function routeProfilePoints(r) {
  const points = []; // { d, e, lon, lat, step }
  let d = 0;
  // consecutive steps share their boundary point; it is kept in both so every step has its own piece
  r.steps.forEach((st, stepIndex) => {
    st.coordinates.forEach((c, i) => {
      const prev = points.at(-1);
      if (prev) d += haversineM([prev.lon, prev.lat], c);
      const e = c[2] ?? (i === 0 ? st.eleStart : st.eleEnd);
      points.push({ d, e, lon: c[0], lat: c[1], step: stepIndex });
    });
  });
  return points;
}
function routeGradient(r) {
  const points = routeProfilePoints(r);
  let horizontal = 0;
  let descent = 0;
  let max = null;
  r.steps.forEach((st, stepIndex) => {
    if (st.type !== 'run' || st.runKind !== 'downhill') return;
    const pts = points.filter((p) => p.step === stepIndex);
    if (pts.length < 2) return;
    horizontal += pts.at(-1).d - pts[0].d;
    for (let i = 1; i < pts.length; i++) descent += Math.max(0, pts[i - 1].e - pts[i].e);
    let j = 0;
    for (let i = 0; i < pts.length; i++) {
      while (j < pts.length && pts[j].d - pts[i].d < 30) j++;
      if (j >= pts.length) break;
      max = Math.max(max ?? 0, Math.abs(pts[j].e - pts[i].e) / (pts[j].d - pts[i].d));
    }
  });
  return horizontal > 0 ? { avg: descent / horizontal, max } : null;
}
function officialStyle(st) {
  if (st.type === 'lift') return { color: LIFT_COLOR, key: 'lift', label: 'Lift' };
  if (st.type === 'walk' || st.runKind !== 'downhill') return { color: WALK_COLOR, key: 'walk', label: 'Path / walk' };
  const info = DIFFICULTY_INFO[st.difficulty] ?? DIFFICULTY_INFO.unknown;
  return { color: st.color ?? info.color, key: st.difficulty ?? 'unknown', label: info.label };
}
function routeProfileSegments(r, points, mode) {
  const segments = [];
  const total = points.at(-1).d || 1;
  const sliceLength = Math.max(30, total / 80);
  const push = (from, to) => {
    if (to <= from) return;
    const st = r.steps[points[from].step];
    const horizontal = points[to].d - points[from].d;
    const slope = horizontal > 0 ? Math.abs(points[to].e - points[from].e) / horizontal : 0;
    let style = officialStyle(st);
    if (mode === 'steepness' && st.type === 'run' && st.runKind === 'downhill') {
      const cls = slopeClass(slope);
      style = { color: cls.color, key: `slope-${cls.id}`, label: cls.label };
    }
    segments.push({ from, to, slope, step: points[from].step, ...style });
  };
  let start = 0;
  for (let i = 1; i <= points.length; i++) {
    const a = points[start];
    const b = points[i];
    if (!b || b.step !== a.step) {
      push(start, i - 1);
      start = i;
      continue;
    }
    const st = r.steps[a.step];
    if (mode === 'steepness' && st.type === 'run' && st.runKind === 'downhill' && b.d - a.d >= sliceLength) {
      push(start, i);
      start = i;
    }
  }
  return segments;
}
const fmtDist = (m) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`);

const fmtTime = (s) => {
  const min = Math.round(s / 60);
  return min >= 60 ? `${Math.floor(min / 60)} h ${min % 60} min` : `${Math.max(1, min)} min`;
};

function stepTitle(s) {
  if (s.type === 'lift') return `${s.down ? 'Ride down' : 'Take'} ${s.label}`;
  if (s.type === 'walk') return 'Walk';
  if (s.runKind === 'connection') return `Follow ${s.label === 'Unnamed run' ? 'the ski path' : s.label}`;
  if (s.runKind === 'connector') return 'Short connection';
  return `Ski ${s.label}`;
}
function stepMeta(s) {
  const parts = [];
  if (s.type === 'run' && s.runKind === 'downhill') parts.push(DIFFICULTY_INFO[s.difficulty]?.label ?? s.difficulty);
  if (s.type === 'lift') parts.push(String(s.liftType ?? 'lift').replaceAll('_', ' '));
  parts.push(fmtDist(s.distance));
  const dz = Math.round(s.eleEnd - s.eleStart);
  if (Math.abs(dz) >= 5) parts.push(`${dz > 0 ? '↑' : '↓'} ${Math.abs(dz)} m`);
  parts.push(`${Math.round(s.eleStart)} → ${Math.round(s.eleEnd)} m`);
  parts.push(`~${fmtTime(s.duration)}`);
  return parts.join(' · ');
}
function haversine(a, b) {
  const R = 6371008.8;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b[1] - a[1]);
  const dLon = toRad(b[0] - a[0]);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}
const fmtMarker = (m) => (m < 1000 ? `${m} m` : `${(m / 1000).toFixed(m % 1000 === 0 ? 0 : 1)} km`);

function distanceMarkers(coords) {
  let total = 0;
  for (let i = 1; i < coords.length; i++) total += haversine(coords[i - 1], coords[i]);
  const step = [100, 250, 500, 1000, 2000, 5000].find((s) => total / s <= 12) ?? 10000;
  const features = [];
  let travelled = 0;
  let next = step;
  for (let i = 1; i < coords.length && next < total; i++) {
    const a = coords[i - 1];
    const b = coords[i];
    const d = haversine(a, b);
    while (d > 0 && travelled + d >= next && next < total) {
      const t = (next - travelled) / d;
      features.push({
        type: 'Feature',
        properties: { label: fmtMarker(next) },
        geometry: { type: 'Point', coordinates: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t] },
      });
      next += step;
    }
    travelled += d;
  }
  return features;
}
const humanize = (s) => String(s ?? '').replaceAll('_', ' ').replace(/^\w/, (c) => c.toUpperCase());

const fmtKm = (m) => (m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${Math.round(m)} m`);

const fmtSlope = (s) => `${Math.round((Math.atan(s) * 180) / Math.PI)}° (${Math.round(s * 100)}%)`;

function verticalText(st) {
  if (st.vertical == null) return null;
  return `${Math.round(st.vertical)} m (${Math.round(st.minEle)} – ${Math.round(st.maxEle)} m)`;
}
const LIFT_DIRECTION = {
  up: 'Up only ›',
  both: 'Both ways ‹ ›',
  unknown: 'Up › (riding down not specified in the data)',
};

function liftRows(lp, st) {
  return [
    ['Direction', LIFT_DIRECTION[lp.direction] ?? null],
    ['Distance', st.length != null ? fmtKm(st.length) : null],
    ['Vertical', verticalText(st)],
    ['Ride time', st.duration ? `${Math.round(st.duration / 60)} min` : null],
    ['Speed', st.speed ? `${st.speed.toFixed(1)} m/s` : null],
    ['Vertical speed', st.verticalSpeed ? `${Math.round(st.verticalSpeed)} m/min` : null],
    ['Slope (average)', st.avgSlope != null ? fmtSlope(st.avgSlope) : null],
    ['Capacity', lp.capacity ? `${lp.capacity} people/hour` : null],
    ['Status', lp.status && lp.status !== 'operating' ? humanize(lp.status) : null],
  ];
}
const LIFT_TYPE_NAMES = {
  gondola: 'Gondola', cable_car: 'Cable car', mixed_lift: 'Gondola/chair combo', chair_lift: 'Chairlift',
  funicular: 'Funicular', railway: 'Railway', rack_railway: 'Rack railway', 't-bar': 'T-bar', 'j-bar': 'J-bar',
  platter: 'Platter lift', drag_lift: 'Drag lift', rope_tow: 'Rope tow', magic_carpet: 'Magic carpet', zip_line: 'Zip line',
};

function liftTitle(lp) {
  const type = LIFT_TYPE_NAMES[lp.liftType] ?? humanize(lp.liftType ?? 'lift');
  const name = lp.name || `Unnamed ${type.toLowerCase()}`;
  return `${name} (${lp.occupancy ? `${lp.occupancy}p ` : ''}${type})`;
}
function crumbsFor(pr) {
  const areas = (pr.skiAreas ?? []).map((a) => a.name).filter(Boolean).join(' / ');
  return [pr.place?.country, pr.place?.region, areas].filter(Boolean);
}
function pinActions(p, after = () => {}) {
  const n = state.points.length;
  const use = (fn) => () => {
    fn();
    after();
    pointsChanged();
  };
  const actions = [];
  if (n === 0) {
    actions.push(['Start here', use(() => state.points.push(p)), true]);
  } else if (n === 1) {
    actions.push(['Go here (destination)', use(() => state.points.push(p)), true]);
    actions.push(['Replace start', use(() => (state.points[0] = p))]);
  } else {
    actions.push(['Set as destination', use(() => (state.points[n - 1] = p)), true]);
    actions.push(['Add as stop', use(() => state.points.splice(n - 1, 0, p))]);
    actions.push(['Add after destination', use(() => state.points.push(p))]);
    actions.push(['Replace start', use(() => (state.points[0] = p))]);
  }
  return actions;
}
let state = { points: [] };
const pointsChanged = () => {};
export function withState(s) {
  state = s;
}
export { routeProfilePoints, routeGradient, routeProfileSegments, stepTitle, stepMeta, distanceMarkers, liftRows, liftTitle, crumbsFor, pinActions, fmtKm, fmtSlope };
