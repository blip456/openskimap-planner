// Ski areas (Skigebiete) for the "show ski areas" overlay: colours, outlines, labels and per-run halos.
//
// OpenSkiData links runs and lifts to one or more ski areas. Umbrella areas that contain other areas
// (e.g. "Kleinwalsertal-Oberstdorf" containing "Skigebiet Fellhorn/Kanzelwand") are treated as regions.
// Every run/lift is coloured by its most specific (smallest) ski area.
import concaveman from 'concaveman';
import { haversine } from './geo.ts';
import type { Bbox, FeatureCollection, LineString, Point, Polygon, Position, ResortData } from './types.ts';

export interface SkiAreaSummary {
  id: string;
  name: string;
  color: string;
  isRegion: boolean;
  parent: string | null;
  runs: number;
  lifts: number;
  bbox: Bbox | null;
}
export interface SkiAreaOutlineProps {
  id: string;
  name: string;
  color: string;
  region: boolean;
}
export interface SkiAreaHaloProps {
  area: string;
  color: string;
  halo: string;
  region: boolean;
  type: 'run' | 'lift';
}
export interface SkiAreas {
  areas: SkiAreaSummary[];
  outlines: FeatureCollection<Polygon, SkiAreaOutlineProps>;
  labels: FeatureCollection<Point, SkiAreaOutlineProps>;
  halos: FeatureCollection<LineString, SkiAreaHaloProps>;
}

interface Area {
  id: string;
  name: string;
  members: Set<string>;
  runs: number;
  lifts: number;
  children: Area[];
  isRegion: boolean;
  parent: string | null;
  color: string;
}

// Chosen to stay distinguishable from each other and from the piste colours (green/blue/red/black/orange).
const PALETTE = ['#0d9488', '#db2777', '#ca8a04', '#4f46e5', '#65a30d', '#0891b2', '#9333ea', '#b45309', '#be123c', '#047857', '#7c3aed', '#a16207'];
const REGION_COLOR = '#475569';
const MIN_FEATURES = 3;
const DENSIFY = 60; // m between hull sample points

// Blend a hex colour with white; used for solid (non-transparent) halos.
function lighten(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  const mix = (v: number): number => Math.round(v + (255 - v) * amount);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(mix);
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}

const to2d = (c: Position): [number, number] => [Number(c[0].toFixed(5)), Number(c[1].toFixed(5))];

function samplePoints(coords: Position[]): [number, number][] {
  const out = [to2d(coords[0])];
  for (let i = 1; i < coords.length; i++) {
    const a = coords[i - 1];
    const b = coords[i];
    const n = Math.floor(haversine(a, b) / DENSIFY);
    for (let k = 1; k <= n; k++) {
      const t = k / (n + 1);
      out.push(to2d([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]));
    }
    out.push(to2d(b));
  }
  return out;
}

function polygonCentroid(ring: number[][]): [number, number] {
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [x0, y0] = ring[i];
    const [x1, y1] = ring[i + 1];
    const f = x0 * y1 - x1 * y0;
    a += f;
    cx += (x0 + x1) * f;
    cy += (y0 + y1) * f;
  }
  if (Math.abs(a) < 1e-12) {
    const n = ring.length;
    return [ring.reduce((s, p) => s + p[0], 0) / n, ring.reduce((s, p) => s + p[1], 0) / n];
  }
  return [cx / (3 * a), cy / (3 * a)];
}

// Only alpine skiing counts: cross-country, ski touring, sled and winter hiking routes are ignored.
const ALPINE_RUN_KINDS = new Set(['downhill', 'connection']);

export function buildSkiAreas(data: Pick<ResortData, 'runs' | 'lifts'>): SkiAreas {
  const features = [
    ...data.runs.filter((f) => ALPINE_RUN_KINDS.has(f.properties.kind)).map((f) => ({ f, type: 'run' as const })),
    ...data.lifts.map((f) => ({ f, type: 'lift' as const })),
  ];

  const areas = new Map<string, Area>();
  for (const { f, type } of features) {
    for (const a of f.properties.skiAreas ?? []) {
      let area = areas.get(a.id);
      if (!area) {
        area = { id: a.id, name: a.name as string, members: new Set(), runs: 0, lifts: 0, children: [], isRegion: false, parent: null, color: '' };
        areas.set(a.id, area);
      }
      area.members.add(f.properties.id);
      if (type === 'lift') area.lifts++;
      else area.runs++;
    }
  }

  const list = [...areas.values()].filter((a) => a.members.size >= MIN_FEATURES);
  const overlap = (a: Area, b: Area): number => [...b.members].filter((id) => a.members.has(id)).length;

  // regions: areas that (mostly) contain at least one smaller area
  for (const a of list) {
    a.children = list.filter((b) => b !== a && b.members.size < a.members.size && overlap(a, b) >= 0.6 * b.members.size);
    a.isRegion = a.children.length > 0;
  }
  for (const b of list) {
    const parents = list.filter((a) => a.children.includes(b)).sort((x, y) => x.members.size - y.members.size);
    b.parent = parents[0]?.id ?? null;
  }
  for (const a of list) a.name ||= 'Unnamed ski area';

  list.sort((x, y) => Number(y.isRegion) - Number(x.isRegion) || y.members.size - x.members.size);
  let colorIndex = 0;
  for (const a of list) a.color = a.isRegion ? REGION_COLOR : PALETTE[colorIndex++ % PALETTE.length];

  const byId = new Map(list.map((a) => [a.id, a]));
  const halos: SkiAreas['halos']['features'] = [];
  const pointsByArea = new Map<string, [number, number][]>(list.map((a) => [a.id, []]));
  for (const { f, type } of features) {
    const own = (f.properties.skiAreas ?? []).map((s) => byId.get(s.id)).filter((a): a is Area => Boolean(a));
    if (!own.length) continue;
    const specific = own.sort((x, y) => x.members.size - y.members.size)[0];
    const coords = f.geometry.coordinates;
    halos.push({
      type: 'Feature',
      properties: {
        area: specific.id,
        color: specific.color,
        halo: lighten(specific.color, specific.isRegion ? 0.75 : 0.5),
        region: specific.isRegion,
        type,
      },
      geometry: { type: 'LineString', coordinates: coords.map(to2d) },
    });
    const pts = samplePoints(coords);
    for (const a of own) (pointsByArea.get(a.id) as [number, number][]).push(...pts);
  }

  const outlines: SkiAreas['outlines']['features'] = [];
  const labels: SkiAreas['labels']['features'] = [];
  const summary: SkiAreaSummary[] = [];
  for (const a of list) {
    const pts = pointsByArea.get(a.id) as [number, number][];
    let bbox: Bbox | null = null;
    if (pts.length >= 3) {
      const ring = concaveman(pts, 2, 0.004);
      if (ring.length >= 4) {
        const props = { id: a.id, name: a.name, color: a.color, region: a.isRegion };
        outlines.push({ type: 'Feature', properties: props, geometry: { type: 'Polygon', coordinates: [ring as Position[]] } });
        labels.push({ type: 'Feature', properties: props, geometry: { type: 'Point', coordinates: polygonCentroid(ring) } });
      }
      bbox = [
        Math.min(...pts.map((p) => p[0])),
        Math.min(...pts.map((p) => p[1])),
        Math.max(...pts.map((p) => p[0])),
        Math.max(...pts.map((p) => p[1])),
      ];
    }
    summary.push({
      id: a.id,
      name: a.name,
      color: a.color,
      isRegion: a.isRegion,
      parent: a.parent,
      runs: a.runs,
      lifts: a.lifts,
      bbox,
    });
  }

  return {
    areas: summary,
    outlines: { type: 'FeatureCollection', features: outlines },
    labels: { type: 'FeatureCollection', features: labels },
    halos: { type: 'FeatureCollection', features: halos },
  };
}
