// Ski routing network built from OpenSkiData runs and lifts.
//
// - Runs are directed downhill (OSM convention / oneway flag / elevation).
// - Lifts are directed uphill, split at intermediate stations.
// - Optional "ride down" edges for gondolas, cable cars, etc.
// - Short walking/skating links bridge small gaps between features.
//
// The base network is built once per resort; options are applied at query time
// through the cost function, so changing options never requires a rebuild.
import { haversine } from '../geo.ts';
import { DRAG_LIFTS, liftClass } from '../ski.ts';
import type { Lift, LiftProps, Position, ResortData, Run, RunProps } from '../types.ts';
import { MinHeap } from './heap.ts';
import {
  DIFFICULTIES,
  DIFFICULTY_LEVEL,
  LIFT_GROUPS,
  LIFT_SPEED,
  LIFT_TYPE_GROUP,
  edgeTime,
  normalizeOptions,
  type Edge,
  type RouteOptions,
  type RouteOptionsInput,
} from './options.ts';
import { legName, pointLetter, summarize, tidySteps, type RawStep, type RouteStep, type RouteSummary } from './steps.ts';

const MAX_SEGMENT = 25; // m, runs are densified so gap links can attach anywhere
const SNAP_DISTANCE = 400; // m, max distance between a clicked point and the network
const SHORT_UNKNOWN_RUN = 150; // m

function densify(coords: Position[]): Position[] {
  const out: Position[] = [coords[0]];
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

const ele = (c: Position): number => c[2] ?? 0;
const OPERATING = (status: string | null | undefined): boolean => status == null || status === 'operating';

export type NetworkFeature =
  | { kind: 'run'; props: RunProps & { difficulty: string } }
  | { kind: 'lift'; props: LiftProps };

/** Cost in seconds (with penalties) of one edge; Infinity = not allowed. */
export type CostFunction = (e: Edge) => number;

export interface NodeSnap {
  node: number;
  /** m */
  distance: number;
}

export interface LegInfo {
  index: number;
  from: string;
  to: string;
  summary: RouteSummary;
}

export interface RouteResult {
  steps: RouteStep[];
  legs: LegInfo[];
  warnings: string[];
  summary: RouteSummary & { hardest: string | null };
  coordinates: Position[];
  /** the route points moved onto the network, [lon, lat, ele] */
  snapped: [number, number, number][];
}

/** A route request that cannot be answered; the message is meant for the user. */
export class RouteError extends Error {}

export class SkiNetwork {
  name: string;
  /** [lon, lat, ele] */
  nodes: [number, number, number][] = [];
  /** ids of the features touching each node */
  nodeFeatures: Set<string>[] = [];
  nodeIndex = new Map<string, number>();
  edges: Edge[] = [];
  /** adjacency: node -> edge indexes */
  out: number[][] = [];
  features = new Map<string, NetworkFeature>();
  terminals = new Set<number>();

  constructor(data: Pick<ResortData, 'name' | 'runs' | 'lifts'>) {
    this.name = data.name;
    for (const f of data.runs) this.addRun(f);
    for (const f of data.lifts) this.addLift(f);
    this.addLinks();
  }

  node(coord: Position, featureId: string): number {
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

  addEdge(edge: Omit<Edge, 'index'>): Edge {
    const e = edge as Edge;
    e.index = this.edges.length;
    this.edges.push(e);
    this.out[e.from].push(e.index);
    return e;
  }

  addRun(f: Run): void {
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
    } else if (p.oneway !== true && ele(coords[0]) + 5 < ele(coords[coords.length - 1])) {
      forward = false;
      backward = true;
    }

    let total = 0;
    for (let i = 1; i < coords.length; i++) total += haversine(coords[i - 1], coords[i]);
    // Short runs without a difficulty are usually station access paths or tiny connectors.
    const connector = difficulty === 'unknown' && total < SHORT_UNKNOWN_RUN;

    const ids = coords.map((c) => this.node(c, p.id));
    this.terminals.add(ids[0]);
    this.terminals.add(ids[ids.length - 1]);
    for (let i = 1; i < ids.length; i++) {
      const a = ids[i - 1];
      const b = ids[i];
      if (a === b) continue;
      const length = haversine(coords[i - 1], coords[i]);
      const base = {
        kind: 'run' as const,
        featureId: p.id,
        length,
        difficulty,
        runKind: connector ? ('connector' as const) : (p.kind as 'downhill' | 'connection'),
      };
      if (forward) this.addEdge({ ...base, from: a, to: b, coords: [coords[i - 1], coords[i]], dz: ele(coords[i]) - ele(coords[i - 1]) });
      if (backward) this.addEdge({ ...base, from: b, to: a, coords: [coords[i], coords[i - 1]], dz: ele(coords[i - 1]) - ele(coords[i]) });
    }
  }

  addLift(f: Lift): void {
    const p = f.properties;
    if (!OPERATING(p.status)) return;
    if (p.liftType === 'zip_line') return;
    let coords = f.geometry.coordinates;
    if (coords.length < 2) return;
    if (ele(coords[0]) > ele(coords[coords.length - 1]) + 5) coords = [...coords].reverse();

    this.features.set(p.id, { kind: 'lift', props: p });

    // station positions along the lift line
    const stationIdx = new Set([0, coords.length - 1]);
    for (const s of p.stations ?? []) {
      const sc = s.coordinates;
      if (!sc) continue;
      let best = 0;
      let bestD = Infinity;
      coords.forEach((c, i) => {
        const d = haversine(c, sc);
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
    const total = cumulative[cumulative.length - 1];

    const nodes = stations.map((i) => this.node(coords[i], p.id));
    nodes.forEach((n) => this.terminals.add(n));

    const liftType = p.liftType ?? '';
    for (let a = 0; a < stations.length; a++) {
      for (let b = a + 1; b < stations.length; b++) {
        const i = stations[a];
        const j = stations[b];
        const length = cumulative[j] - cumulative[i];
        const fraction = total > 0 ? length / total : 1;
        const segment = coords.slice(i, j + 1);
        const base = {
          kind: 'lift' as const,
          featureId: p.id,
          liftType: p.liftType,
          liftGroup: LIFT_TYPE_GROUP[liftType] ?? 'gondola',
          length,
          ride: p.duration ? p.duration * fraction : length / (LIFT_SPEED[liftType] ?? 3),
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
  addLinks(maxDistance = 150): void {
    const cell = maxDistance / 111320;
    const grid = new Map<string, number[]>();
    const cellKey = (lon: number, lat: number): string => `${Math.floor(lon / cell)},${Math.floor(lat / cell)}`;
    this.nodes.forEach((n, i) => {
      const k = cellKey(n[0], n[1]);
      let list = grid.get(k);
      if (!list) grid.set(k, (list = []));
      list.push(i);
    });

    const done = new Set<string>();
    for (const t of this.terminals) {
      const [lon, lat] = this.nodes[t];
      const cx = Math.floor(lon / cell);
      const cy = Math.floor(lat / cell);
      const nearestPerFeature = new Map<string, { n: number; d: number }>();
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

  costFunction(options: RouteOptionsInput, relaxed: boolean): CostFunction {
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
        const difficulty = e.difficulty as string;
        let time = edgeTime(e, o);
        if (allowedDiff.has(difficulty)) {
          if (o.preferEasier) time *= 1 + 0.35 * (DIFFICULTY_LEVEL[difficulty] ?? 2);
          return time;
        }
        if (!relaxed) return Infinity;
        const over = Math.max(1, (DIFFICULTY_LEVEL[difficulty] ?? 2) - maxAllowedLevel);
        return time * 10 ** over;
      }
      if (e.kind === 'lift') {
        if (!allowedLifts.has(e.liftGroup as string)) return Infinity;
        let time = edgeTime(e, o);
        if (e.down) {
          if (!e.bidirectional && !o.liftDown) return Infinity;
          if (!downLifts.has(e.liftGroup as string) && !e.bidirectional) return Infinity;
          time = time * 2 + 300; // prefer skiing allowed runs when both are possible
        }
        if (o.avoidDragLifts && DRAG_LIFTS.has(e.liftType as string)) time *= 4;
        return time;
      }
      // link
      if (e.length > o.linkDistance) return Infinity;
      return edgeTime(e, o) * 2;
    };
  }

  /** Nearest node; with `wantOut` only nodes you can leave (start of a leg). */
  nearestNode(lonlat: readonly number[], wantOut: boolean): NodeSnap {
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

  /** Cheapest path as a list of edges, or null when the target cannot be reached. */
  dijkstra(source: number, target: number, cost: CostFunction): Edge[] | null {
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
    const path: Edge[] = [];
    for (let v = target; v !== source; v = this.edges[prev[v]].from) path.push(this.edges[prev[v]]);
    return path.reverse();
  }

  /** Route through all points ([lon, lat]) in order. Throws RouteError with a message for the user. */
  route(points: readonly (readonly number[])[], options: RouteOptionsInput = {}): RouteResult {
    if (!Array.isArray(points) || points.length < 2) throw new RouteError('Set at least a start and a destination.');
    const o = normalizeOptions(options);

    const snaps = points.map((p, i) => {
      const s = this.nearestNode(p, i < points.length - 1);
      if (s.node < 0 || s.distance > SNAP_DISTANCE) {
        throw new RouteError(
          `Point ${pointLetter(i)} is ${Math.round(s.distance)} m from the nearest run or lift. Click closer to the ski area.`,
        );
      }
      return s;
    });

    const warnings: string[] = [];
    const legEdges: Edge[][] = [];
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
          `No route for ${legName(i)} with your settings. ` + 'Try allowing more runs or lifts, or turn on "Ride lifts down".',
        );
      }
      legEdges[i] = leg;
    }

    // Steps are built per leg so a run is never merged across a stop; each step knows its leg.
    const steps: RouteStep[] = legEdges.flatMap((edges, leg) => this.toSteps(edges, o).map((s) => ({ ...s, leg })));
    const edges = legEdges.flat();
    const allowedDiff = new Set(o.difficulties);
    const isRealRun = (s: RouteStep): boolean => s.type === 'run' && s.runKind === 'downhill';
    const harder = steps.filter((s) => isRealRun(s) && !allowedDiff.has(s.difficulty as string));
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
    if (walks.length) {
      warnings.push(`Includes ${walks.length === 1 ? 'a short walk' : `${walks.length} short walks`} where the map data has a gap.`);
    }
    snaps.forEach((s, i) => {
      if (s.distance > 75) warnings.push(`Point ${pointLetter(i)} was moved ${Math.round(s.distance)} m to the nearest run or lift.`);
    });

    const coords: Position[] = [];
    for (const e of edges) {
      for (const c of e.coords) {
        const last = coords[coords.length - 1];
        if (last && last[0] === c[0] && last[1] === c[1]) continue;
        coords.push(c);
      }
    }

    const summary = {
      ...summarize(steps),
      hardest: harder.length
        ? (harder.map((s) => s.difficulty as string).sort((a, b) => DIFFICULTY_LEVEL[b] - DIFFICULTY_LEVEL[a])[0] as string)
        : null,
    };
    const legs = legEdges.map((_, i) => ({
      index: i,
      from: pointLetter(i),
      to: pointLetter(i + 1),
      summary: summarize(steps.filter((s) => s.leg === i)),
    }));

    return { steps, legs, warnings, summary, coordinates: coords, snapped: snaps.map((s) => this.nodes[s.node]) };
  }

  toSteps(edges: Edge[], o: RouteOptions): Omit<RouteStep, 'leg'>[] {
    const steps: RawStep[] = [];
    for (const e of edges) {
      const type = e.kind === 'link' ? 'walk' : e.kind;
      const key = `${type}:${e.featureId ?? ''}:${e.down ? 'down' : ''}`;
      let step = steps[steps.length - 1] as RawStep | undefined;
      if (!step || step.key !== key) {
        const feature = e.featureId ? this.features.get(e.featureId) : null;
        const p: Partial<RunProps & LiftProps> = feature?.props ?? {};
        step = {
          key,
          type,
          featureId: e.featureId ?? null,
          label:
            p.label ||
            (type === 'walk'
              ? 'Walk / skate'
              : type === 'lift'
                ? `Unnamed ${String(p.liftType ?? 'lift').replace('_', ' ')}`
                : 'Unnamed run'),
          names: type === 'run' && p.name ? String(p.name).split(/,\s*/) : [],
          difficulty: type === 'run' ? (e.difficulty as string) : null,
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
      step.eleEnd = e.coords[e.coords.length - 1][2] ?? 0;
      for (const c of e.coords) {
        const last = step.coordinates[step.coordinates.length - 1];
        if (!last || last[0] !== c[0] || last[1] !== c[1]) step.coordinates.push(c);
      }
    }
    return tidySteps(steps).map(({ key, names, ...s }) => s);
  }
}

export type { Edge, RouteOptions, RouteOptionsInput } from './options.ts';
export type { RouteStep, RouteSummary } from './steps.ts';
