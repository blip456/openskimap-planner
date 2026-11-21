import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SkiNetwork, toGpx } from '../src/index.ts';
import { loadFixture } from './helpers.mjs';

const net = new SkiNetwork(loadFixture());

test('GPX 1.1 with route points, step waypoints and one track', () => {
  const r = net.route([[10.0, 47.0], [10.0, 47.01], [10.0, 47.0]]);
  const gpx = toGpx('Tour <A & B> "x"', r);
  const lines = gpx.split('\n');
  assert.equal(lines[0], '<?xml version="1.0" encoding="UTF-8"?>');
  assert.match(lines[1], /^<gpx version="1\.1" creator="openskimap-local planner" xmlns="http:\/\/www\.topografix\.com\/GPX\/1\/1">$/);
  assert.ok(gpx.includes('<metadata><name>Tour &lt;A &amp; B&gt; &quot;x&quot;</name>'));
  assert.ok(gpx.endsWith('</trkseg></trk>\n</gpx>\n'));

  const names = [...gpx.matchAll(/<wpt [^>]+>.*?<name>(.*?)<\/name><type>(.*?)<\/type><\/wpt>/g)].map((m) => `${m[1]}|${m[2]}`);
  assert.deepEqual(names.slice(0, 3), ['A (start)|route point', 'B|route point', 'C (destination)|route point']);
  assert.equal(names[3], 'A→B 1. Take lift: Valley Gondola|lift');
  assert.equal(names[4], 'B→C 1. Run: 1 Blue Valley (easy)|run');

  const trkpts = [...gpx.matchAll(/<trkpt lat="(-?\d+\.\d{7})" lon="(-?\d+\.\d{7})"><ele>(-?\d+\.\d)<\/ele><\/trkpt>/g)];
  assert.equal(trkpts.length, r.coordinates.length);
  assert.equal(Number(trkpts[0][1]), Number(r.coordinates[0][1].toFixed(7)));
});

test('points without elevation have no <ele>', () => {
  const gpx = toGpx('x', { snapped: [[10, 47], [10.1, 47.1]], steps: [], coordinates: [[10, 47], [10.1, 47.1]] });
  assert.ok(gpx.includes('<trkpt lat="47.0000000" lon="10.0000000"></trkpt>'));
});
