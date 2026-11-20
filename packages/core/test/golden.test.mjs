// Golden tests: the TypeScript core must give exactly the same results as the old JavaScript code
// (reference copies in test/reference/) on the real resort data. Skipped when the data is not built.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import * as core from '../src/index.ts';
import * as legacyFeature from './reference/feature-info.legacy.mjs';
import * as legacyGeoparse from './reference/geoparse.legacy.mjs';
import * as legacyGraph from './reference/graph.legacy.mjs';
import * as legacyPiste from './reference/piste.mjs';
import * as legacySearch from './reference/search.legacy.mjs';
import * as legacyAppSearch from './reference/app-search.legacy.mjs';
import * as legacySkiAreas from './reference/ski-areas.legacy.mjs';
import * as legacySki from './reference/ski.mjs';
import * as legacySlope from './reference/slope.mjs';
import * as legacyStyles from './reference/styles.mjs';
import * as legacyZip from './reference/zip.legacy.mjs';
import { loadRealData, outcome, realDataSkip, rng } from './helpers.mjs';

const data = realDataSkip ? null : loadRealData();
const clone = (v) => structuredClone(v);

// Same value and, for what is sent as JSON, the same text (key order included).
function same(actual, expected, message) {
  assert.deepStrictEqual(actual, expected, message);
  assert.equal(JSON.stringify(actual), JSON.stringify(expected), message);
}

// Option combinations used for every point pair.
const OPTION_SETS = [
  {},
  { difficulties: ['novice', 'easy', 'intermediate'] },
  { difficulties: ['novice', 'easy', 'intermediate', 'advanced', 'expert', 'freeride', 'unknown'], preferEasier: false },
  { difficulties: ['novice'], harderRuns: 'never' },
  { avoidDragLifts: true },
  { liftDown: true },
  { liftDown: true, liftDownGroups: ['gondola', 'chair_lift', 'rail'], harderRuns: 'never' },
  { speeds: core.SPEED_PRESETS.intermediate, difficulties: ['novice', 'easy', 'intermediate'] },
  { speeds: { ...core.SPEED_PRESETS.confident, easy: '40', walk: 'bad', bogus: 3 }, liftWait: 30 },
  { includeConnections: false, linkDistance: 100 },
  { liftGroups: ['gondola', 'chair_lift'], difficulties: ['easy', 'intermediate', 'unknown'] },
];

describe('golden: routing on real data', { skip: realDataSkip }, () => {
  let net;
  let old;
  const counts = { pairs: 0, lifts: 0, multi: 0, routes: 0, errors: 0 };

  test('network build is identical (nodes, edges, terminals)', () => {
    let t = performance.now();
    net = new core.SkiNetwork(data);
    const coreMs = performance.now() - t;
    t = performance.now();
    old = new legacyGraph.SkiNetwork(data);
    const legacyMs = performance.now() - t;
    console.log(`# network build: core ${coreMs.toFixed(1)} ms, legacy ${legacyMs.toFixed(1)} ms, ${net.nodes.length} nodes, ${net.edges.length} edges`);
    same(net.nodes, old.nodes);
    same(net.edges, old.edges);
    same([...net.terminals], [...old.terminals]);
    same(net.nodeFeatures.map((s) => [...s]), old.nodeFeatures.map((s) => [...s]));
    same([...net.features.entries()], [...old.features.entries()]);
  });

  const compareRoute = (points, options, label) => {
    const a = outcome(() => net.route(clone(points), clone(options)));
    const b = outcome(() => old.route(clone(points), clone(options)));
    same(a, b, label);
    counts.routes++;
    if (a.error) {
      counts.errors++;
      assert.match(a.error, /^RouteError: /, label);
    } else {
      same(core.toGpx('Golden <test> & route', a.ok), legacyGraph.toGpx('Golden <test> & route', b.ok), `${label} (GPX)`);
    }
  };

  // Nodes you can reach from a node with lifts up, runs and short walks (ignoring the options).
  const reachable = (start) => {
    const seen = new Set([start]);
    const queue = [start];
    while (queue.length) {
      const u = queue.pop();
      for (const ei of net.out[u]) {
        const e = net.edges[ei];
        if ((e.kind === 'link' && e.length > 40) || (e.kind === 'lift' && e.down) || seen.has(e.to)) continue;
        seen.add(e.to);
        queue.push(e.to);
      }
    }
    return [...seen];
  };

  test('100 seeded random point pairs × option sets', () => {
    const random = rng(20261120);
    const pickIndex = (list) => list[Math.floor(random() * list.length)];
    const all = net.nodes.map((_, i) => i);
    for (let i = 0; i < 100; i++) {
      const a = pickIndex(all);
      // most pairs are connected by runs and lifts; every tenth pair is fully random (often not linked)
      const b = i % 10 === 9 ? pickIndex(all) : pickIndex(reachable(a));
      const [na, nb] = [net.nodes[a], net.nodes[b]];
      // every fourth pair is moved off the network a bit, to test snapping (and the "too far" error)
      const jitter = i % 4 === 3 ? 0.005 : 0;
      const points = [
        [na[0] + (random() - 0.5) * jitter, na[1] + (random() - 0.5) * jitter],
        [nb[0], nb[1]],
      ];
      counts.pairs++;
      for (const [k, options] of OPTION_SETS.entries()) compareRoute(points, options, `pair ${i}, options ${k}`);
    }
  });

  test('every lift: bottom → top and top → bottom station × option sets', () => {
    for (const lift of data.lifts) {
      const c = lift.geometry.coordinates;
      const [first, last] = [c[0], c.at(-1)];
      counts.lifts++;
      for (const [k, options] of OPTION_SETS.entries()) {
        compareRoute([[first[0], first[1]], [last[0], last[1]]], options, `lift ${lift.properties.id} up, options ${k}`);
        compareRoute([[last[0], last[1]], [first[0], first[1]]], options, `lift ${lift.properties.id} down, options ${k}`);
      }
    }
  });

  test('multi-point routes', () => {
    const random = rng(42);
    for (let i = 0; i < 20; i++) {
      // a chain of points where each one can be reached from the previous one
      const chain = [Math.floor(random() * net.nodes.length)];
      while (chain.length < 3 + (i % 4)) {
        const next = reachable(chain.at(-1));
        chain.push(next[Math.floor(random() * next.length)]);
      }
      const points = chain.map((n) => [net.nodes[n][0], net.nodes[n][1]]);
      if (i % 5 === 0) points.splice(1, 0, points[0]); // the same point twice: an empty leg
      counts.multi++;
      for (const [k, options] of OPTION_SETS.entries()) compareRoute(points, options, `multi ${i}, options ${k}`);
    }
  });

  test('route errors and summary of the comparison', () => {
    compareRoute([[10.2, 47.3]], {}, 'one point');
    compareRoute([[0, 0], [1, 1]], {}, 'far away');
    console.log(`# golden routes: (${counts.pairs} pairs + ${counts.multi} multi-point routes + ${counts.lifts} lifts × 2) × ${OPTION_SETS.length} option sets = ${counts.routes} comparisons (${counts.errors} expected RouteErrors)`);
    assert.ok(counts.routes >= 2500);
    assert.ok(counts.routes - counts.errors > 500, 'most comparisons are real routes');
  });

  test('normalizeOptions', () => {
    for (const options of OPTION_SETS) same(core.normalizeOptions(clone(options)), legacyGraph.normalizeOptions(clone(options)));
    same(core.DEFAULT_OPTIONS, legacyGraph.DEFAULT_OPTIONS);
    same(core.SPEED_PRESETS, legacyGraph.SPEED_PRESETS);
    same(core.LIFT_GROUPS, legacyGraph.LIFT_GROUPS);
  });
});

describe('golden: search on real data', { skip: realDataSkip }, () => {
  test('search index', () => {
    same(core.buildSearchIndex(data), legacySearch.buildSearchIndex(data));
  });

  test('local search results and sub lines', () => {
    const entries = core.buildSearchIndex(data);
    const coreIndex = core.prepareSearchIndex(entries);
    const oldIndex = legacyAppSearch.prepareIndex(legacySearch.buildSearchIndex(data));
    same(coreIndex, oldIndex);
    for (const e of entries) assert.equal(core.entrySub(e), legacyAppSearch.entrySub(e), e.name);

    const random = rng(7);
    const queries = ['', ' ', 'a', 'ber', 'bahn', 'kanzel', '30 kanz', 'walser', 'hütte', 'hutte', 'Söllereck', 'SÖLLER', 'ß', 'fell horn', 'xyzzy', '1', '15, 17'];
    for (let i = 0; i < 300; i++) {
      const e = entries[Math.floor(random() * entries.length)];
      const words = String(e.name).split(/\s+/);
      const w = words[Math.floor(random() * words.length)];
      const start = Math.floor(random() * Math.max(1, w.length - 2));
      queries.push(i % 3 === 0 ? e.name : i % 3 === 1 ? w : w.slice(start, start + 3 + Math.floor(random() * 4)));
    }
    for (const q of queries) same(core.searchLocal(coreIndex, q), legacyAppSearch.searchLocal(oldIndex, q), `query "${q}"`);
    console.log(`# golden search: ${entries.length} entries, ${queries.length} queries`);
  });
});

describe('golden: info cards and ski areas on real data', { skip: realDataSkip }, () => {
  test('feature details for every run, run area, lift and spot', () => {
    const ids = [...data.runs, ...(data.runAreas ?? []), ...data.lifts, ...(data.spots ?? [])].map((f) => f.properties.id);
    for (const id of [...ids, 'does-not-exist']) {
      same(core.featureDetails(data, id), legacyFeature.featureDetails(data, id), id);
    }
    console.log(`# golden feature details: ${ids.length + 1} ids`);
  });

  test('ski areas', () => {
    same(core.buildSkiAreas(data), legacySkiAreas.buildSkiAreas(data));
  });
});

describe('golden: build helpers on real data', { skip: realDataSkip }, () => {
  test('slope segments for every run', () => {
    for (const f of data.runs) same(core.slopeSegments(f.geometry.coordinates), legacySlope.slopeSegments(f.geometry.coordinates), f.properties.id);
  });

  test('pistes', () => {
    const strip = (runs) =>
      runs.map((f) => {
        const { piste, pistes, ...properties } = f.properties;
        return { ...f, properties };
      });
    const a = strip(data.runs);
    const b = strip(data.runs);
    core.assignPistes(a);
    legacyPiste.assignPistes(b);
    same(a, b);
    // and the result is what the build wrote
    same(a.map((f) => [f.properties.piste, f.properties.pistes]), data.runs.map((f) => [f.properties.piste, f.properties.pistes]));
  });

  test('labels, kinds, colours, lift classes and directions', () => {
    for (const f of [...data.runs, ...data.lifts, ...(data.spots ?? [])]) {
      const p = f.properties;
      assert.equal(core.featureLabel(p), legacySki.featureLabel(p));
      assert.equal(core.runKind(p.uses), legacySki.runKind(p.uses));
      assert.equal(core.runColor(p.difficulty), legacySki.runColor(p.difficulty));
      assert.equal(core.liftClass(p.liftType), legacySki.liftClass(p.liftType));
      assert.equal(core.liftDirection(p), legacySki.liftDirection(p));
      same(core.orientUphill(f.geometry.coordinates), legacySki.orientUphill(f.geometry.coordinates));
    }
  });

  test('map styles', () => {
    const bounds = data.bbox;
    for (const colorBy of ['difficulty', 'slope']) {
      for (const [hasTerrain, hasContours] of [[true, true], [true, false], [false, false]]) {
        const options = { language: 'de', bounds, hasTerrain, hasContours, colorBy };
        same(core.buildBasemapStyle(options), legacyStyles.buildBasemapStyle(options));
      }
      same(core.buildOverlayStyle({ bounds, colorBy }), legacyStyles.buildOverlayStyle({ bounds, colorBy }));
    }
    same(core.runSlopeLayer(), legacyStyles.runSlopeLayer());
  });
});

// These need no real data: they compare against the old browser modules directly.
describe('golden: geoparse and zip', () => {
  test('geoparse gives the same results as the old browser module', () => {
    const inputs = [
      '47.3481, 10.2160', '47°20\'53.4"N 10°12\'57.7"E', "N 47° 20.890' E 010° 12.962'", 'geo:47.3,10.2', '47.3481 10.2160',
      '47.3481N 10.2160E', '-33.86, 151.21', "47°20'N 10°12'O", '151.21, -33.86', 'lift 12 3', '12 3', '47.3', '', null,
      '47 20 53 N 10 12 57 E', '47,3481; 10,2160', '+47.1 -10.2', '47.1° 10.2°', "47° 20′ 53″ N, 10° 12′ 57″ E", 'geo:47.3,10.2?z=12',
      '91, 181', 'N 47 E', '47.1N 10.2N', '47 deg 20 N 10 deg 12 E', 'Kanzelwandbahn', '30 Kanzelwandbahn',
    ];
    for (const s of inputs) same(core.parseCoordinates(s), legacyGeoparse.parseCoordinates(s), String(s));
    const links = [
      'https://www.google.com/maps/place/Kanzelwandbahn/@47.35,10.21,15z/data=!3m1!4b1!3d47.3481!4d10.216',
      'https://maps.google.com/?q=47.3,10.2', 'https://www.google.com/maps/search/47.1,+10.2', 'https://www.google.com/maps/@47.35,10.21,15z',
      'https://www.google.com/maps?q=Walserstra%C3%9Fe+1,+Riezlern', 'www.google.de/maps/dir//47.1,10.2', 'https://maps.app.goo.gl/abc',
      'https://www.google.com/maps/place/47%C2%B020\'53.4%22N+10%C2%B012\'57.7%22E/@47.34,10.21,17z', 'not a url %%', 'https://www.google.com/maps?ll=47.1,10.2&q=Hotel',
      'https://www.google.com/maps/place/Caf%E9', 'https://www.google.com/maps?daddr=loc:47.2,10.3',
    ];
    for (const s of links) {
      same(core.parseGoogleMapsUrl(s), legacyGeoparse.parseGoogleMapsUrl(s), s);
      assert.equal(core.isGoogleMapsLink(s), legacyGeoparse.isGoogleMapsLink(s), s);
      assert.equal(core.isShortLink(s), legacyGeoparse.isShortLink(s), s);
    }
  });

  test('zip bytes are identical', async () => {
    const files = [{ name: 'Route ü.gpx', text: '<gpx>é</gpx>' }, { name: 'b.gpx', text: '' }];
    const RealDate = globalThis.Date;
    const fixed = new RealDate(2026, 10, 20, 21, 30, 44);
    globalThis.Date = class extends RealDate {
      constructor(...args) {
        super(...(args.length ? args : [fixed.getTime()]));
      }
    };
    try {
      const a = new Uint8Array(await core.makeZip(files).arrayBuffer());
      const b = new Uint8Array(await legacyZip.makeZip(files).arrayBuffer());
      same([...a], [...b]);
    } finally {
      globalThis.Date = RealDate;
    }
  });
});
