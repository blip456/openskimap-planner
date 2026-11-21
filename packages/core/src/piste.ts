// OSM often splits one signed piste into several sections, but also gives side branches and variants the same
// name and number. Sections form one piste when they share the name and the piste number (ref) and one
// continues where the other ends. A branch that leaves or joins halfway is a piste of its own.
import { haversine } from './geo.ts';
import { sha1Hex } from './hash.ts';
import type { Position } from './types.ts';

const TOUCH = 5; // m between an end and the next start
const split = (value: unknown): string[] =>
  String(value ?? '')
    .split(/\s*[,;]\s*/)
    .filter(Boolean);

interface PisteProps {
  id: string;
  name?: unknown;
  ref?: unknown;
  kind?: string;
  oneway?: boolean | null;
  piste?: string;
  pistes?: string;
}
interface PisteFeature {
  geometry: { type: string; coordinates: unknown };
  properties: PisteProps;
}

// "name|ref" for every piste a section belongs to; the first one is the section's own piste.
// Shared sections list several: "Talabfahrt Kanzelwand, Schwandlift-Piste" with ref "15, 17".
export function pisteKeys(props: { kind?: string; name?: unknown; ref?: unknown }): string[] {
  const names = split(props.name);
  const refs = split(props.ref);
  return names.map((name, i) => `${props.kind}|${name}|${refs.length === names.length ? refs[i] : refs.join(',')}`);
}

// Sets `piste` (id of the section's own piste) and `pistes` ("|id|id|", every piste it belongs to) on runs
// that belong to a piste of more than one section.
export function assignPistes(runs: PisteFeature[]): void {
  const byKey = new Map<string, PisteFeature[]>();
  for (const f of runs) {
    if (f.geometry.type !== 'LineString') continue;
    for (const key of pisteKeys(f.properties)) {
      let list = byKey.get(key);
      if (!list) byKey.set(key, (list = []));
      list.push(f);
    }
  }

  const groupsOf = new Map<PisteFeature, Map<string, string>>(); // feature -> Map(key -> piste id)
  for (const [key, members] of byKey) {
    if (members.length < 2) continue;
    const parent = members.map((_, i) => i);
    const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    const ends = members.map((f) => {
      const c = f.geometry.coordinates as Position[];
      const first = c[0];
      const last = c[c.length - 1];
      // downhill runs are drawn downhill: only an end followed by a start continues the piste
      const directed = f.properties.kind === 'downhill' && f.properties.oneway !== false;
      return { starts: directed ? [first] : [first, last], ends: directed ? [last] : [first, last] };
    });
    for (let i = 0; i < members.length; i++) {
      for (let j = 0; j < members.length; j++) {
        if (i === j || find(i) === find(j)) continue;
        if (ends[i].ends.some((e) => ends[j].starts.some((s) => haversine(e, s) < TOUCH))) parent[find(i)] = find(j);
      }
    }
    const components = new Map<number, PisteFeature[]>();
    members.forEach((f, i) => {
      const root = find(i);
      let list = components.get(root);
      if (!list) components.set(root, (list = []));
      list.push(f);
    });
    for (const group of components.values()) {
      if (group.length < 2) continue;
      const first = group.map((f) => f.properties.id).sort()[0];
      const id = sha1Hex(`${key}|${first}`).slice(0, 12);
      for (const f of group) {
        let groups = groupsOf.get(f);
        if (!groups) groupsOf.set(f, (groups = new Map()));
        groups.set(key, id);
      }
    }
  }

  for (const [f, groups] of groupsOf) {
    const own = groups.get(pisteKeys(f.properties)[0]);
    if (own) f.properties.piste = own;
    f.properties.pistes = `|${[...groups.values()].join('|')}|`;
  }
}
