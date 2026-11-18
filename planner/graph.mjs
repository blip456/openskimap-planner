// Ski routing network built from OpenSkiData runs and lifts.
//
// - Runs are directed downhill (OSM convention / oneway flag / elevation).
// - Lifts are directed uphill, split at intermediate stations.
// - Optional "ride down" edges for gondolas, cable cars, etc.
// - Short walking/skating links bridge small gaps between features.
//
// The base network is built once per resort; options are applied at query time
// through the cost function, so changing options never requires a rebuild.
import { haversine } from '../scripts/lib/geo.mjs';
import { DRAG_LIFTS, liftClass } from '../scripts/lib/ski.mjs';

export const DIFFICULTIES = ['novice', 'easy', 'intermediate', 'advanced', 'expert', 'freeride', 'unknown'];
const DIFFICULTY_LEVEL = { novice: 0, easy: 1, intermediate: 2, advanced: 3, expert: 4, freeride: 5, extreme: 5, unknown: 2 };

// Average skiing speeds in km/h (including short stops). Used for the time estimates and the route choice.
export const SPEED_PRESETS = {
  beginner: { novice: 12, easy: 14, intermediate: 10, advanced: 7, expert: 5, freeride: 5, unknown: 12, connection: 8, walk: 3 },
  intermediate: { novice: 18, easy: 22, intermediate: 20, advanced: 14, expert: 10, freeride: 10, unknown: 18, connection: 12, walk: 3.5 },
  confident: { novice: 25, easy: 32, intermediate: 35, advanced: 28, expert: 22, freeride: 18, unknown: 28, connection: 15, walk: 4 },
};
const kmh = (v) => v / 3.6;
const LIFT_SPEED = {
  gondola: 5,
  cable_car: 8,
  mixed_lift: 4.5,
  chair_lift: 2.5,
  funicular: 6,
  railway: 6,
  rack_railway: 4,
  't-bar': 3,
  'j-bar': 3,
  platter: 3,
  drag_lift: 3,
  rope_tow: 2,
  magic_carpet: 0.8,
};

export const LIFT_GROUPS = {
  gondola: ['gondola', 'cable_car', 'mixed_lift'],
  chair_lift: ['chair_lift'],
  rail: ['funicular', 'railway', 'rack_railway', 'cog_railway'],
  tbar: ['t-bar', 'j-bar', 'drag_lift'],
  platter: ['platter'],
  rope_tow: ['rope_tow'],
  magic_carpet: ['magic_carpet'],
};
const LIFT_TYPE_GROUP = Object.fromEntries(
  Object.entries(LIFT_GROUPS).flatMap(([group, types]) => types.map((t) => [t, group])),
);

export const DEFAULT_OPTIONS = {
  difficulties: ['novice', 'easy'],
  harderRuns: 'fallback', // 'never' | 'fallback'
  preferEasier: true,
  liftGroups: ['gondola', 'chair_lift', 'rail', 'tbar', 'platter', 'rope_tow', 'magic_carpet'],
  avoidDragLifts: false,
  liftDown: false,
  liftDownGroups: ['gondola', 'rail'],
  includeConnections: true,
  linkDistance: 40,
  liftWait: 120,
  speeds: SPEED_PRESETS.beginner,
};

// Merge user options with the defaults and keep the speeds within sane limits.
export function normalizeOptions(options = {}) {
  const o = { ...DEFAULT_OPTIONS, ...options };
  const speeds = { ...DEFAULT_OPTIONS.speeds };
  for (const [k, v] of Object.entries(options.speeds ?? {})) {
    const n = Number(v);
    if (k in speeds && Number.isFinite(n)) speeds[k] = Math.min(100, Math.max(0.5, n));
  }
  o.speeds = speeds;
  return o;
}

// Time in seconds to travel one edge with the user's speeds.
function edgeTime(e, o) {
  const sp = o.speeds;
  if (e.kind === 'lift') return o.liftWait + e.ride;
  if (e.kind === 'link') return e.length / kmh(sp.walk) + Math.max(0, e.dz) / CLIMB_SPEED;
  if (e.runKind === 'connection' || e.runKind === 'connector') {
    return e.dz > 1 ? e.length / kmh(sp.walk) + e.dz / CLIMB_SPEED : e.length / kmh(sp.connection);
  }
  const speed = sp[e.difficulty === 'extreme' ? 'freeride' : e.difficulty] ?? sp.unknown;
  return e.length / kmh(speed) + (e.dz > 2 ? e.dz / CLIMB_SPEED : 0); // dz > 0: walking up a two-way run
}

const MAX_SEGMENT = 25; // m, runs are densified so gap links can attach anywhere
const SNAP_DISTANCE = 400; // m, max distance between a clicked point and the network
const CLIMB_SPEED = 0.12; // m/s vertical when walking uphill
const SHORT_UNKNOWN_RUN = 150; // m

function densify(coords) {
  const out = [coords[0]];
  for (let i = 1; i < coords.length; i++) {
    const a = coords[i - 1];
    const b = coords[i];
    const d = haversine(a, b);
    const n = Math.floor(d / MAX_SEGMENT);
    for (let k = 1; k <= n; k++) {
      const t = k / (n + 1);
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, (a[2] ?? 0) + ((b[2] ?? 0) - (a[2] ?? 0)) * t]);
    }
    out.push(b);
  }
  return out;
}

const ele = (c) => c[2] ?? 0;
const OPERATING = (status) => status == null || status === 'operating';

export class SkiNetwork {
  constructor(data) {
    this.name = data.name;
    this.nodes = []; // [lon, lat, ele]
    this.nodeFeatures = []; // Set of feature ids touching the node
    this.nodeIndex = new Map();
    this.edges = [];
    this.out = []; // adjacency: node -> edge indexes
    this.features = new Map();
    this.terminals = new Set();

    for (const f of data.runs) this.addRun(f);
    for (const f of data.lifts) this.addLift(f);
    this.addLinks();
  }

  node(coord, featureId) {
    const key = `${coord[0].toFixed(6)},${coord[1].toFixed(6)}`;
    let i = this.nodeIndex.get(key);
    if (i === undefined) {
      i = this.nodes.length;
      this.nodes.push([coord[0], coord[1], ele(coord)]);
      this.nodeFeatures.push(new Set());
      this.out.push([]);
      this.nodeIndex.set(key, i);
    }
    this.nodeFeatures[i].add(featureId);
    return i;
  }

  addEdge(edge) {
    edge.index = this.edges.length;
    this.edges.push(edge);
    this.out[edge.from].push(edge.index);
    return edge;
  }

  addRun(f) {
    const p = f.properties;
    if (!OPERATING(p.status)) return;
    if (!['downhill', 'connection'].includes(p.kind)) return;
    const coords = densify(f.geometry.coordinates);
    if (coords.length < 2) return;

    const difficulty = p.difficulty ?? 'unknown';
    this.features.set(p.id, { kind: 'run', props: { ...p, difficulty } });

    let forward = true;
    let backward = false;
    if (p.kind === 'connection' || p.oneway === false) {
      backward = true;
    } else if (p.oneway !== true && ele(coords[0]) + 5 < ele(coords.at(-1))) {
      forward = false;
      backward = true;
    }

    let total = 0;
    for (let i = 1; i < coords.length; i++) total += haversine(coords[i - 1], coords[i]);
    // Short runs without a difficulty are usually station access paths or tiny connectors.
    const connector = difficulty === 'unknown' && total < SHORT_UNKNOWN_RUN;

    const ids = coords.map((c) => this.node(c, p.id));
    this.terminals.add(ids[0]);
    this.terminals.add(ids.at(-1));
    for (let i = 1; i < ids.length; i++) {
      const a = ids[i - 1];
      const b = ids[i];
      if (a === b) continue;
      const length = haversine(coords[i - 1], coords[i]);
      const base = { kind: 'run', featureId: p.id, length, difficulty, runKind: connector ? 'connector' : p.kind };
      if (forward) this.addEdge({ ...base, from: a, to: b, coords: [coords[i - 1], coords[i]], dz: ele(coords[i]) - ele(coords[i - 1]) });
      if (backward) this.addEdge({ ...base, from: b, to: a, coords: [coords[i], coords[i - 1]], dz: ele(coords[i - 1]) - ele(coords[i]) });
    }
  }

  addLift(f) {
    const p = f.properties;
    if (!OPERATING(p.status)) return;
    if (p.liftType === 'zip_line') return;
    let coords = f.geometry.coordinates;
    if (coords.length < 2) return;
    if (ele(coords[0]) > ele(coords.at(-1)) + 5) coords = [...coords].reverse();

    this.features.set(p.id, { kind: 'lift', props: p });

    // station positions along the lift line
    const stationIdx = new Set([0, coords.length - 1]);
    for (const s of p.stations ?? []) {
      if (!s.coordinates) continue;
      let best = 0;
      let bestD = Infinity;
      coords.forEach((c, i) => {
        const d = haversine(c, s.coordinates);
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      });
      if (bestD < 60) stationIdx.add(best);
    }
    const stations = [...stationIdx].sort((a, b) => a - b);

    const cumulative = [0];
    for (let i = 1; i < coords.length; i++) cumulative.push(cumulative[i - 1] + haversine(coords[i - 1], coords[i]));
    const total = cumulative.at(-1);

    const nodes = stations.map((i) => this.node(coords[i], p.id));
    nodes.forEach((n) => this.terminals.add(n));

    for (let a = 0; a < stations.length; a++) {
      for (let b = a + 1; b < stations.length; b++) {
        const i = stations[a];
        const j = stations[b];
        const length = cumulative[j] - cumulative[i];
        const fraction = total > 0 ? length / total : 1;
        const segment = coords.slice(i, j + 1);
        const base = {
          kind: 'lift',
          featureId: p.id,
          liftType: p.liftType,
          liftGroup: LIFT_TYPE_GROUP[p.liftType] ?? 'gondola',
          length,
          ride: p.duration ? p.duration * fraction : length / (LIFT_SPEED[p.liftType] ?? 3),
          stationCount: stations.length,
        };
        this.addEdge({ ...base, from: nodes[a], to: nodes[b], coords: segment, dz: ele(coords[j]) - ele(coords[i]), down: false });
        if (liftClass(p.liftType) !== 'drag') {
          this.addEdge({
            ...base,
            from: nodes[b],
            to: nodes[a],
            coords: [...segment].reverse(),
            dz: ele(coords[i]) - ele(coords[j]),
            down: true,
            bidirectional: p.oneway === false,
          });
        }
      }
    }
  }

  // Walking / skating links between features whose ends do not quite touch.
  addLinks(maxDistance = 150) {
    const cell = maxDistance / 111320;
    const grid = new Map();
    const cellKey = (lon, lat) => `${Math.floor(lon / cell)},${Math.floor(lat / cell)}`;
    this.nodes.forEach((n, i) => {
      const k = cellKey(n[0], n[1]);
      if (!grid.has(k)) grid.set(k, []);
      grid.get(k).push(i);
    });

    const done = new Set();
    for (const t of this.terminals) {
      const [lon, lat] = this.nodes[t];
      const cx = Math.floor(lon / cell);
      const cy = Math.floor(lat / cell);
      const nearestPerFeature = new Map();
      for (let dx = -2; dx <= 2; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          for (const n of grid.get(`${cx + dx},${cy + dy}`) ?? []) {
            if (n === t) continue;
            const shared = [...this.nodeFeatures[n]].some((fid) => this.nodeFeatures[t].has(fid));
            if (shared) continue;
            const d = haversine(this.nodes[t], this.nodes[n]);
            if (d > maxDistance) continue;
            for (const fid of this.nodeFeatures[n]) {
              const cur = nearestPerFeature.get(fid);
              if (!cur || d < cur.d) nearestPerFeature.set(fid, { n, d });
            }
          }
        }
      }
      for (const { n, d } of nearestPerFeature.values()) {
        const key = t < n ? `${t}-${n}` : `${n}-${t}`;
        if (done.has(key)) continue;
        done.add(key);
        const a = this.nodes[t];
        const b = this.nodes[n];
        this.addEdge({ kind: 'link', from: t, to: n, length: d, dz: b[2] - a[2], coords: [a, b] });
        this.addEdge({ kind: 'link', from: n, to: t, length: d, dz: a[2] - b[2], coords: [b, a] });
      }
    }
  }

  // -------------------------------------------------------------------------

  costFunction(options, relaxed) {
    const o = normalizeOptions(options);
    const allowedDiff = new Set(o.difficulties);
    const allowedLifts = new Set(o.liftGroups);
    const downLifts = new Set(o.liftDownGroups);
    const maxAllowedLevel = Math.max(-1, ...o.difficulties.map((d) => DIFFICULTY_LEVEL[d] ?? 0));

    return (e) => {
      if (e.kind === 'run') {
        if (e.runKind === 'connection' || e.runKind === 'connector') {
          if (e.runKind === 'connection' && !o.includeConnections) return Infinity;
          return edgeTime(e, o);
        }
        let time = edgeTime(e, o);
        if (allowedDiff.has(e.difficulty)) {
          if (o.preferEasier) time *= 1 + 0.35 * (DIFFICULTY_LEVEL[e.difficulty] ?? 2);
          return time;
        }
        if (!relaxed) return Infinity;
        const over = Math.max(1, (DIFFICULTY_LEVEL[e.difficulty] ?? 2) - maxAllowedLevel);
        return time * 10 ** over;
      }
      if (e.kind === 'lift') {
        if (!allowedLifts.has(e.liftGroup)) return Infinity;
        let time = edgeTime(e, o);
        if (e.down) {
          if (!e.bidirectional && !o.liftDown) return Infinity;
          if (!downLifts.has(e.liftGroup) && !e.bidirectional) return Infinity;
          time = time * 2 + 300; // prefer skiing allowed runs when both are possible
        }
        if (o.avoidDragLifts && DRAG_LIFTS.has(e.liftType)) time *= 4;
        return time;
      }
      // link
      if (e.length > o.linkDistance) return Infinity;
      return edgeTime(e, o) * 2;
    };
  }

  nearestNode(lonlat, wantOut) {
    let best = -1;
    let bestD = Infinity;
    for (let i = 0; i < this.nodes.length; i++) {
      if (wantOut ? this.out[i].length === 0 : false) continue;
      const d = haversine(lonlat, this.nodes[i]);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return { node: best, distance: bestD };
  }

  dijkstra(source, target, cost) {
    const n = this.nodes.length;
    const dist = new Float64Array(n).fill(Infinity);
    const prev = new Int32Array(n).fill(-1);
    const heap = new MinHeap();
    dist[source] = 0;
    heap.push(source, 0);
    while (heap.size) {
      const [u, du] = heap.pop();
      if (du > dist[u]) continue;
      if (u === target) break;
      for (const ei of this.out[u]) {
        const e = this.edges[ei];
        const c = cost(e);
        if (c === Infinity) continue;
        const nd = du + c;
        if (nd < dist[e.to]) {
          dist[e.to] = nd;
          prev[e.to] = ei;
          heap.push(e.to, nd);
        }
      }
    }
    if (dist[target] === Infinity) return null;
    const path = [];
    for (let v = target; v !== source; v = this.edges[prev[v]].from) path.push(this.edges[prev[v]]);
    return path.reverse();
  }

  route(points, options = {}) {
    if (!Array.isArray(points) || points.length < 2) throw new RouteError('Set at least a start and a destination.');
    const o = normalizeOptions(options);

    const snaps = points.map((p, i) => {
      const s = this.nearestNode(p, i < points.length - 1);
      if (s.node < 0 || s.distance > SNAP_DISTANCE) {
        throw new RouteError(`Point ${pointLetter(i)} is ${Math.round(s.distance)} m from the nearest run or lift. Click closer to the ski area.`);
      }
      return s;
    });

    const warnings = [];
    const legEdges = [];
    let relaxedUsed = false;
    for (let i = 0; i < snaps.length - 1; i++) {
      const from = snaps[i].node;
      const to = snaps[i + 1].node;
      legEdges.push([]);
      if (from === to) continue;
      let leg = this.dijkstra(from, to, this.costFunction(o, false));
      if (!leg && o.harderRuns === 'fallback') {
        leg = this.dijkstra(from, to, this.costFunction(o, true));
        if (leg) relaxedUsed = true;
      }
      if (!leg) {
        const permissive = this.costFunction(
          {
            difficulties: DIFFICULTIES,
            liftGroups: Object.keys(LIFT_GROUPS),
            liftDown: true,
            liftDownGroups: Object.keys(LIFT_GROUPS),
            includeConnections: true,
            linkDistance: 150,
          },
          true,
        );
        if (!this.dijkstra(from, to, permissive)) {
          throw new RouteError(
            `No ski connection for ${legName(i)}: these ski areas are not linked by runs or lifts. ` +
              'You probably need a ski bus. Plan each area separately.',
          );
        }
        throw new RouteError(
          `No route for ${legName(i)} with your settings. ` +
            'Try allowing more runs or lifts, or turn on "Ride lifts down".',
        );
      }
      legEdges[i] = leg;
    }

    // Steps are built per leg so a run is never merged across a stop; each step knows its leg.
    const steps = legEdges.flatMap((edges, leg) => this.toSteps(edges, o).map((s) => ({ ...s, leg })));
    const edges = legEdges.flat();
    const allowedDiff = new Set(o.difficulties);
    const isRealRun = (s) => s.type === 'run' && s.runKind === 'downhill';
    const harder = steps.filter((s) => isRealRun(s) && !allowedDiff.has(s.difficulty));
    if (relaxedUsed && harder.length) {
      warnings.push(
        `No route with only your chosen runs. This route uses harder runs: ${[
          ...new Set(harder.map((s) => `${s.label} (${s.difficulty})`)),
        ].join(', ')}.`,
      );
    }
    const unknown = steps.filter((s) => isRealRun(s) && s.difficulty === 'unknown');
    if (unknown.length && allowedDiff.has('unknown')) {
      warnings.push('Some runs on this route have no difficulty in the map data. Check the piste map.');
    }
    const down = steps.filter((s) => s.type === 'lift' && s.down);
    if (down.length) warnings.push(`Rides a lift down: ${down.map((s) => s.label).join(', ')}. Check that this is allowed.`);
    const walks = steps.filter((s) => s.type === 'walk' && s.distance > 25);
    if (walks.length) warnings.push(`Includes ${walks.length === 1 ? 'a short walk' : `${walks.length} short walks`} where the map data has a gap.`);
    snaps.forEach((s, i) => {
      if (s.distance > 75) warnings.push(`Point ${pointLetter(i)} was moved ${Math.round(s.distance)} m to the nearest run or lift.`);
    });

    const coords = [];
    for (const e of edges) {
      for (const c of e.coords) {
        const last = coords.at(-1);
        if (last && last[0] === c[0] && last[1] === c[1]) continue;
        coords.push(c);
      }
    }

    const summary = {
      ...summarize(steps),
      hardest: harder.length ? harder.map((s) => s.difficulty).sort((a, b) => DIFFICULTY_LEVEL[b] - DIFFICULTY_LEVEL[a])[0] : null,
    };
    const legs = legEdges.map((_, i) => ({
      index: i,
      from: pointLetter(i),
      to: pointLetter(i + 1),
      summary: summarize(steps.filter((s) => s.leg === i)),
    }));

    return { steps, legs, warnings, summary, coordinates: coords, snapped: snaps.map((s) => this.nodes[s.node]) };
  }

  toSteps(edges, o) {
    const steps = [];
    for (const e of edges) {
      const type = e.kind === 'link' ? 'walk' : e.kind;
      const key = `${type}:${e.featureId ?? ''}:${e.down ? 'down' : ''}`;
      let step = steps.at(-1);
      if (!step || step.key !== key) {
        const feature = e.featureId ? this.features.get(e.featureId) : null;
        const p = feature?.props ?? {};
        step = {
          key,
          type,
          featureId: e.featureId ?? null,
          label: p.label || (type === 'walk' ? 'Walk / skate' : type === 'lift' ? `Unnamed ${String(p.liftType ?? 'lift').replace('_', ' ')}` : 'Unnamed run'),
          names: type === 'run' && p.name ? String(p.name).split(/,\s*/) : [],
          difficulty: type === 'run' ? e.difficulty : null,
          runKind: e.runKind ?? null,
          color: p.color ?? null,
          liftType: e.liftType ?? null,
          down: !!e.down,
          distance: 0,
          duration: 0,
          eleStart: e.coords[0][2] ?? 0,
          eleEnd: 0,
          coordinates: [],
        };
        steps.push(step);
      }
      step.distance += e.length;
      step.duration += edgeTime(e, o);
      step.eleEnd = e.coords.at(-1)[2] ?? 0;
      for (const c of e.coords) {
        const last = step.coordinates.at(-1);
        if (!last || last[0] !== c[0] || last[1] !== c[1]) step.coordinates.push(c);
      }
    }
    return tidySteps(steps).map(({ key, names, ...s }) => s);
  }
}

export class RouteError extends Error {}

// OpenStreetMap often splits one signed piste into several sections (sometimes shared with another piste,
// e.g. "15, 17 Talabfahrt Kanzelwand, Schwandlift-Piste"). Turn the raw per-section steps into what you
// would follow on the mountain. A harder piece or a change in difficulty always stays its own step.
const TINY_RUN = 80; // m, unnamed piece that can be folded into its neighbour if it is not harder
const TINY_LINK = 60; // m, connector / walk that can be folded into the neighbouring run

function tidySteps(raw) {
  const level = (d) => DIFFICULTY_LEVEL[d] ?? 2;
  const isRun = (s) => s?.type === 'run' && (s.runKind === 'downhill' || s.runKind === 'connection');
  const isPiste = (s) => s?.type === 'run' && s.runKind === 'downhill';
  const isTinyLink = (s) => (s.runKind === 'connector' || s.type === 'walk') && s.distance < TINY_LINK;
  const isTinyUnnamed = (s) => isPiste(s) && s.names.length === 0 && s.distance < TINY_RUN;
  const sharesName = (a, b) => a.names.some((n) => b.names.includes(n));

  const append = (into, s) => {
    into.distance += s.distance;
    into.duration += s.duration;
    into.eleEnd = s.eleEnd;
    into.coordinates.push(...s.coordinates.slice(1));
  };
  const prepend = (into, s) => {
    into.distance += s.distance;
    into.duration += s.duration;
    into.eleStart = s.eleStart;
    into.coordinates = [...s.coordinates, ...into.coordinates.slice(1)];
  };

  const steps = raw.filter((s) => !(s.type === 'walk' && s.distance < 3));
  for (const s of steps) if (s.runKind === 'connector') s.label = 'Short connection';

  // 1. merge forward into the previous step
  const out = [];
  for (const s of steps) {
    const prev = out.at(-1);
    const samePiste =
      isRun(prev) && isRun(s) && prev.runKind === s.runKind && prev.difficulty === s.difficulty &&
      (prev.label === s.label || sharesName(prev, s));
    if (samePiste) {
      // prefer the plain piste name over a combined "A, B" section name
      if (prev.names.length > 1 && s.names.length === 1) {
        prev.label = s.label;
        prev.names = s.names;
      }
      append(prev, s);
    } else if (isPiste(prev) && isTinyUnnamed(s) && level(s.difficulty) <= level(prev.difficulty)) {
      append(prev, s);
    } else if (isPiste(prev) && isPiste(s) && s.distance < 30 && level(s.difficulty) <= level(prev.difficulty)) {
      append(prev, s); // tiny section of another piste
    } else if (isRun(prev) && isTinyLink(s)) {
      append(prev, s);
    } else if (prev && (prev.runKind === 'connector' || prev.type === 'walk') && (s.runKind === 'connector' || s.type === 'walk')) {
      prev.label = 'Short connection';
      append(prev, s);
    } else {
      out.push(s);
    }
  }

  // 1b. an unnamed piece between two sections of the same piste belongs to that piste
  for (let i = out.length - 2; i >= 1; i--) {
    const [a, mid, b] = [out[i - 1], out[i], out[i + 1]];
    const sandwiched =
      isPiste(a) && isPiste(b) && isPiste(mid) && mid.names.length === 0 && a.difficulty === b.difficulty &&
      (a.label === b.label || sharesName(a, b)) && level(mid.difficulty) <= level(a.difficulty) && mid.distance < 600;
    if (sandwiched) {
      append(a, mid);
      append(a, b);
      out.splice(i, 2);
    }
  }

  // 2. fold leftover tiny connectors / unnamed pieces into the run that follows (e.g. after a lift)
  for (let i = out.length - 2; i >= 0; i--) {
    const s = out[i];
    const next = out[i + 1];
    const fold = isRun(next) && (isTinyLink(s) || (isTinyUnnamed(s) && level(s.difficulty) <= level(next.difficulty)));
    if (fold) {
      prepend(next, s);
      out.splice(i, 1);
    }
  }
  return out;
}

// Route points are lettered A, B, C… like the markers in the UI.
export function pointLetter(i) {
  return i < 26 ? String.fromCharCode(65 + i) : `${String.fromCharCode(64 + Math.floor(i / 26))}${String.fromCharCode(65 + (i % 26))}`;
}
const legName = (i) => `the leg ${pointLetter(i)} → ${pointLetter(i + 1)}`;

function summarize(steps) {
  return {
    distance: steps.reduce((s, x) => s + x.distance, 0),
    runDistance: steps.filter((s) => s.type === 'run').reduce((s, x) => s + x.distance, 0),
    liftCount: steps.filter((s) => s.type === 'lift').length,
    duration: steps.reduce((s, x) => s + x.duration, 0),
    descent: steps.filter((s) => s.type === 'run').reduce((s, x) => s + Math.max(0, x.eleStart - x.eleEnd), 0),
    ascent: steps.filter((s) => s.type === 'lift' && !s.down).reduce((s, x) => s + Math.max(0, x.eleEnd - x.eleStart), 0),
  };
}

class MinHeap {
  constructor() {
    this.items = [];
    this.prio = [];
  }
  get size() {
    return this.items.length;
  }
  push(item, p) {
    const a = this.items;
    const q = this.prio;
    a.push(item);
    q.push(p);
    let i = a.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (q[parent] <= q[i]) break;
      [a[i], a[parent]] = [a[parent], a[i]];
      [q[i], q[parent]] = [q[parent], q[i]];
      i = parent;
    }
  }
  pop() {
    const a = this.items;
    const q = this.prio;
    const top = [a[0], q[0]];
    const lastItem = a.pop();
    const lastPrio = q.pop();
    if (a.length) {
      a[0] = lastItem;
      q[0] = lastPrio;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && q[l] < q[m]) m = l;
        if (r < a.length && q[r] < q[m]) m = r;
        if (m === i) break;
        [a[i], a[m]] = [a[m], a[i]];
        [q[i], q[m]] = [q[m], q[i]];
        i = m;
      }
    }
    return top;
  }
}

export function toGpx(name, result) {
  const esc = (s) => String(s).replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]);
  const pt = (tag, c, inner = '') =>
    `<${tag} lat="${c[1].toFixed(7)}" lon="${c[0].toFixed(7)}">${c[2] != null ? `<ele>${c[2].toFixed(1)}</ele>` : ''}${inner}</${tag}>`;

  const last = result.snapped.length - 1;
  const pointWpts = result.snapped.map((c, i) => {
    const role = i === 0 ? ' (start)' : i === last ? ' (destination)' : '';
    return pt('wpt', c, `<name>${esc(`${pointLetter(i)}${role}`)}</name><type>route point</type>`);
  });

  const counters = new Map();
  const wpts = result.steps
    .filter((s) => s.type !== 'walk' && s.runKind !== 'connector')
    .map((s) => {
      const n = (counters.get(s.leg) ?? 0) + 1;
      counters.set(s.leg, n);
      const what = s.type === 'lift' ? `${s.down ? 'Ride down' : 'Take lift'}: ${s.label}` : `Run: ${s.label}${s.difficulty ? ` (${s.difficulty})` : ''}`;
      const leg = `${pointLetter(s.leg)}→${pointLetter(s.leg + 1)}`;
      return pt('wpt', s.coordinates[0], `<name>${esc(`${leg} ${n}. ${what}`)}</name><type>${s.type}</type>`);
    });

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<gpx version="1.1" creator="openskimap-local planner" xmlns="http://www.topografix.com/GPX/1/1">',
    `<metadata><name>${esc(name)}</name><desc>Data: OpenSkiData / OpenSkiMap.org, © OpenStreetMap contributors (ODbL)</desc></metadata>`,
    ...pointWpts,
    ...wpts,
    `<trk><name>${esc(name)}</name><type>skiing</type><trkseg>`,
    ...result.coordinates.map((c) => pt('trkpt', c)),
    '</trkseg></trk>',
    '</gpx>',
    '',
  ].join('\n');
}
