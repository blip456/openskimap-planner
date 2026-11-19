// OSM often splits one signed piste into several sections, but also gives side branches and variants the same
// name and number. Sections form one piste when they share the name and the piste number (ref) and one
// continues where the other ends. A branch that leaves or joins halfway is a piste of its own.
import crypto from 'node:crypto';
import { haversine } from './geo.mjs';

const TOUCH = 5; // m between an end and the next start
const split = (value) => String(value ?? '').split(/\s*[,;]\s*/).filter(Boolean);

// "name|ref" for every piste a section belongs to; the first one is the section's own piste.
// Shared sections list several: "Talabfahrt Kanzelwand, Schwandlift-Piste" with ref "15, 17".
export function pisteKeys(props) {
  const names = split(props.name);
  const refs = split(props.ref);
  return names.map((name, i) => `${props.kind}|${name}|${refs.length === names.length ? refs[i] : refs.join(',')}`);
}

// Sets `piste` (id of the section's own piste) and `pistes` ("|id|id|", every piste it belongs to) on runs
// that belong to a piste of more than one section.
export function assignPistes(runs) {
  const byKey = new Map();
  for (const f of runs) {
    if (f.geometry.type !== 'LineString') continue;
    for (const key of pisteKeys(f.properties)) {
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key).push(f);
    }
  }

  const groupsOf = new Map(); // feature -> Map(key -> piste id)
  for (const [key, members] of byKey) {
    if (members.length < 2) continue;
    const parent = members.map((_, i) => i);
    const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    const ends = members.map((f) => {
      const c = f.geometry.coordinates;
      // downhill runs are drawn downhill: only an end followed by a start continues the piste
      const directed = f.properties.kind === 'downhill' && f.properties.oneway !== false;
      return { starts: directed ? [c[0]] : [c[0], c.at(-1)], ends: directed ? [c.at(-1)] : [c[0], c.at(-1)] };
    });
    for (let i = 0; i < members.length; i++) {
      for (let j = 0; j < members.length; j++) {
        if (i === j || find(i) === find(j)) continue;
        if (ends[i].ends.some((e) => ends[j].starts.some((s) => haversine(e, s) < TOUCH))) parent[find(i)] = find(j);
      }
    }
    const components = new Map();
    members.forEach((f, i) => {
      const root = find(i);
      if (!components.has(root)) components.set(root, []);
      components.get(root).push(f);
    });
    for (const group of components.values()) {
      if (group.length < 2) continue;
      const first = group.map((f) => f.properties.id).sort()[0];
      const id = crypto.createHash('sha1').update(`${key}|${first}`).digest('hex').slice(0, 12);
      for (const f of group) {
        if (!groupsOf.has(f)) groupsOf.set(f, new Map());
        groupsOf.get(f).set(key, id);
      }
    }
  }

  for (const [f, groups] of groupsOf) {
    const own = groups.get(pisteKeys(f.properties)[0]);
    if (own) f.properties.piste = own;
    f.properties.pistes = `|${[...groups.values()].join('|')}|`;
  }
}
