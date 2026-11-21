import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { DEFAULT_OPTIONS, RouteError, SNAP_DISTANCE, SkiNetwork, normalizeOptions, pointLetter } from '../src/index.ts';
import { loadFixture } from './helpers.mjs';

const data = loadFixture();
const net = new SkiNetwork(data);
const labels = (r) => r.steps.map((s) => `${s.type}:${s.label}${s.down ? ' (down)' : ''}`);

const GONDOLA_BOTTOM = [10.0, 47.0];
const GONDOLA_TOP = [10.0, 47.01];
const CABLE_BOTTOM = [10.02, 47.0];
const CABLE_TOP = [10.02, 47.01];

describe('network', () => {
  test('closed runs are not part of the network', () => {
    assert.equal(net.features.has('run-closed'), false);
    assert.equal(net.features.has('run-blue'), true);
  });

  test('lifts drawn top → bottom are turned around', () => {
    const up = net.edges.find((e) => e.featureId === 'lift-gondola' && !e.down);
    assert.ok(up.dz > 0, 'gondola goes up');
  });

  test('a mid-station splits the lift', () => {
    const ups = net.edges.filter((e) => e.featureId === 'lift-gondola' && !e.down);
    assert.equal(ups.length, 3); // bottom→mid, bottom→top, mid→top
    assert.ok(ups.every((e) => e.stationCount === 3));
  });

  test('drag lifts have no down edges', () => {
    assert.equal(net.edges.filter((e) => e.featureId === 'lift-tbar' && e.down).length, 0);
  });

  test('downhill runs only go downhill, connections both ways', () => {
    assert.ok(net.edges.filter((e) => e.featureId === 'run-blue').every((e) => e.dz <= 0));
    const path = net.edges.filter((e) => e.featureId === 'path-village');
    assert.ok(path.some((e) => e.coords[0][0] < e.coords[1][0]) && path.some((e) => e.coords[0][0] > e.coords[1][0]));
  });

  test('a run drawn uphill is turned around', () => {
    assert.ok(net.edges.filter((e) => e.featureId === 'run-reversed').every((e) => e.dz <= 0));
  });

  test('walk links connect ends that do not touch', () => {
    assert.ok(net.edges.some((e) => e.kind === 'link' && e.length < 40));
  });
});

const route2 = (a, b, options) => net.route([a, b], options);

describe('direction rules', () => {
  test('lifts only go up unless riding down is allowed', () => {
    const noRuns = { difficulties: [], harderRuns: 'never', includeConnections: false };
    assert.throws(() => net.route([GONDOLA_TOP, GONDOLA_BOTTOM], noRuns), RouteError);
    const r = net.route([GONDOLA_TOP, GONDOLA_BOTTOM], { ...noRuns, liftDown: true });
    assert.deepEqual(labels(r), ['lift:Valley Gondola (down)']);
  });
});

describe('routes', () => {
  test('up with the gondola', () => {
    const r = route2(GONDOLA_BOTTOM, GONDOLA_TOP);
    assert.deepEqual(labels(r), ['lift:Valley Gondola']);
    assert.equal(r.summary.liftCount, 1);
    assert.ok(r.summary.ascent > 790 && r.summary.ascent < 810);
    assert.equal(r.summary.duration, DEFAULT_OPTIONS.liftWait + 480);
  });

  test('down on the allowed run, not with the lift', () => {
    const r = route2(GONDOLA_TOP, GONDOLA_BOTTOM);
    assert.equal(r.steps[0].label, '1 Blue Valley');
    assert.equal(r.steps[0].difficulty, 'easy');
    assert.ok(r.steps.every((s) => s.type !== 'lift'));
    assert.ok(r.summary.descent > 790);
    assert.equal(r.summary.hardest, null);
    assert.deepEqual(r.warnings, []);
  });

  test('the run drawn uphill can be skied down', () => {
    const r = route2([10.0004, 47.0098], [10.0098, 47.0002]);
    assert.equal(r.steps[0].label, 'Drawn Uphill');
  });

  test('harder run as fallback, with a warning', () => {
    const r = route2(CABLE_TOP, CABLE_BOTTOM);
    assert.deepEqual(labels(r), ['run:Black Wall']);
    assert.equal(r.summary.hardest, 'advanced');
    assert.match(r.warnings[0], /harder runs: Black Wall \(advanced\)/);
  });

  test('harderRuns "never" gives a clear error', () => {
    assert.throws(() => route2(CABLE_TOP, CABLE_BOTTOM, { harderRuns: 'never' }), (err) => {
      assert.ok(err instanceof RouteError);
      assert.match(err.message, /No route for the leg A → B with your settings/);
      return true;
    });
  });

  test('ride lifts down', () => {
    const r = route2(CABLE_TOP, CABLE_BOTTOM, { harderRuns: 'never', liftDown: true });
    assert.deepEqual(labels(r), ['lift:Peak Cable Car (down)']);
    assert.match(r.warnings[0], /Rides a lift down: Peak Cable Car/);
    assert.equal(r.summary.ascent, 0);
  });

  test('ride down only with the chosen lift groups', () => {
    assert.throws(
      () => route2(CABLE_TOP, CABLE_BOTTOM, { harderRuns: 'never', liftDown: true, liftDownGroups: ['chair_lift'] }),
      RouteError,
    );
  });

  test('allowed lift groups', () => {
    assert.throws(() => route2(GONDOLA_BOTTOM, GONDOLA_TOP, { liftGroups: ['chair_lift'] }), RouteError);
  });

  test('avoid drag lifts makes them more expensive', () => {
    const a = route2([10.01, 47.0], [10.0102, 47.0029]);
    const b = route2([10.01, 47.0], [10.0102, 47.0029], { avoidDragLifts: true });
    assert.deepEqual(labels(a), labels(b));
    assert.equal(a.summary.duration, b.summary.duration); // shown time stays real
  });

  test('walk links are used between features that do not touch', () => {
    const r = net.route([[10.01, 47.0], [10.01, 47.003], [10.0102, 47.0001], [10.01, 47.003]]);
    assert.deepEqual(labels(r), ['lift:Kids T-bar', 'run:Green Practice', 'walk:Walk / skate', 'lift:Kids T-bar']);
    assert.deepEqual(r.steps.map((s) => s.leg), [0, 1, 2, 2]);
    assert.equal(r.legs.length, 3);
    assert.deepEqual(r.legs.map((l) => `${l.from}${l.to}`), ['AB', 'BC', 'CD']);
  });

  test('not linked ski areas', () => {
    assert.throws(() => route2(GONDOLA_BOTTOM, [10.1, 47.01]), /No ski connection for the leg A → B/);
  });

  test('point too far from the network', () => {
    assert.throws(() => route2(GONDOLA_BOTTOM, [10.05, 47.05]), /Point B is \d+ m from the nearest run or lift/);
  });

  test('needs two points', () => {
    assert.throws(() => net.route([GONDOLA_BOTTOM]), /at least a start and a destination/);
  });

  test('point moved more than 75 m gives a warning', () => {
    const r = route2([10.0, 46.999], GONDOLA_TOP);
    assert.ok(r.warnings.some((w) => /Point A was moved \d+ m/.test(w)));
  });

  test('faster speeds give a shorter time', () => {
    const slow = route2(GONDOLA_TOP, GONDOLA_BOTTOM);
    const fast = route2(GONDOLA_TOP, GONDOLA_BOTTOM, { speeds: { easy: 40, connection: 20 } });
    assert.ok(fast.summary.duration < slow.summary.duration);
    assert.equal(fast.summary.distance, slow.summary.distance);
  });

  test('coordinates have no duplicate neighbours and start/end at the snapped points', () => {
    const r = net.route([GONDOLA_BOTTOM, GONDOLA_TOP, GONDOLA_BOTTOM]);
    for (let i = 1; i < r.coordinates.length; i++) {
      const [a, b] = [r.coordinates[i - 1], r.coordinates[i]];
      assert.ok(a[0] !== b[0] || a[1] !== b[1]);
    }
    assert.deepEqual(r.coordinates[0], r.snapped[0]);
    assert.deepEqual(r.coordinates.at(-1), r.snapped.at(-1));
  });
});

describe('options', () => {
  test('defaults', () => {
    assert.deepEqual(normalizeOptions(), { ...DEFAULT_OPTIONS, speeds: { ...DEFAULT_OPTIONS.speeds } });
  });
  test('speeds are clamped and unknown keys ignored', () => {
    const o = normalizeOptions({ speeds: { easy: '500', novice: 0, walk: 'x', bogus: 5 } });
    assert.equal(o.speeds.easy, 100);
    assert.equal(o.speeds.novice, 0.5);
    assert.equal(o.speeds.walk, DEFAULT_OPTIONS.speeds.walk);
    assert.equal('bogus' in o.speeds, false);
  });
  test('point letters', () => {
    assert.deepEqual([0, 1, 25, 26, 27].map(pointLetter), ['A', 'B', 'Z', 'AA', 'AB']);
  });
});

describe('short runs without difficulty', () => {
  const run = (id, difficulty, coords) => ({
    type: 'Feature',
    geometry: { type: 'LineString', coordinates: coords },
    properties: { id, name: null, ref: null, status: null, label: '', kind: 'downhill', difficulty, color: '#7d7d7d', oneway: null },
  });
  const tiny = new SkiNetwork({
    name: 'tiny',
    runs: [
      run('short', null, [[10, 47.001, 1100], [10, 47.0, 1090]]), // ~111 m: a connector
      run('long', null, [[10.01, 47.002, 1100], [10.01, 47.0, 1080]]), // ~222 m: a real run
    ],
    lifts: [],
  });
  test('a run shorter than 150 m without difficulty is a connector', () => {
    assert.ok(tiny.edges.filter((e) => e.featureId === 'short').every((e) => e.runKind === 'connector'));
    assert.ok(tiny.edges.filter((e) => e.featureId === 'long').every((e) => e.runKind === 'downhill'));
    const r = tiny.route([[10, 47.001], [10, 47.0]], { difficulties: ['novice'] });
    assert.deepEqual(labels(r), ['run:Short connection']);
    assert.deepEqual(r.warnings, []); // connectors are allowed with any difficulty
  });
});

describe('nearest place (start from my location)', () => {
  test('finds the lift station and names the lift and the runs there', () => {
    const hit = net.nearest([10.0001, 47.0101]);
    assert.ok(hit);
    assert.deepEqual(hit.position.slice(0, 2), [10, 47.01]);
    assert.ok(hit.distance > 5 && hit.distance < 20, `distance ${hit.distance}`);
    assert.ok(hit.station);
    assert.ok(hit.names.includes('Valley Gondola'));
    assert.ok(hit.names.includes('Blue Valley'));
    assert.equal(new Set(hit.names).size, hit.names.length, 'no repeated names');
  });

  test('a point on a run is not a station', () => {
    const hit = net.nearest([10.022, 47.005]);
    assert.equal(hit.distance, 0);
    assert.equal(hit.station, false);
    assert.deepEqual(hit.names, ['Black Wall']);
  });

  test('the distance is in metres and grows with the distance', () => {
    const near = net.nearest([10.05, 47.005]);
    const far = net.nearest([10.05, 47.05]);
    // Black Wall at 10.022 E: 0.028° of longitude at 47° N ≈ 2.1 km; the cable car top is ≈ 5 km away
    assert.ok(near.distance > 2000 && near.distance < 2250, `near ${near.distance}`);
    assert.ok(far.distance > 4800 && far.distance < 5200, `far ${far.distance}`);
    assert.ok(far.distance > SNAP_DISTANCE);
  });

  test('with start, only places a route can leave are used', () => {
    // the bottom of the Black Wall is a dead end (no lift there): a start snaps to a node with a way out
    const end = [10.0202, 47.0002];
    const any = net.nearest(end);
    const start = net.nearest(end, { start: true });
    assert.equal(any.distance, 0);
    assert.ok(net.out[start.node].length > 0);
    assert.ok(net.out[any.node].length === 0 || start.node === any.node);
    // the start point must be usable by route()
    assert.doesNotThrow(() => net.route([start.position, CABLE_TOP]));
  });

  test('an empty network has no nearest place', () => {
    assert.equal(new SkiNetwork({ name: 'empty', runs: [], lifts: [] }).nearest([10, 47]), null);
  });
});
