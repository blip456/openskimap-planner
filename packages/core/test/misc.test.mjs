import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { test } from 'node:test';
import {
  assignPistes,
  buildSkiAreas,
  crc32,
  featureDetails,
  featureLabel,
  haversine,
  liftDirection,
  makeZip,
  orientUphill,
  sha1Hex,
  slopeSegments,
} from '../src/index.ts';
import { loadFixture } from './helpers.mjs';

test('sha1Hex matches node:crypto', () => {
  const inputs = ['', 'abc', 'é ✓ Ski', 'x'.repeat(55), 'x'.repeat(56), 'y'.repeat(64), 'z'.repeat(1000)];
  for (const s of inputs) assert.equal(sha1Hex(s), crypto.createHash('sha1').update(s).digest('hex'), JSON.stringify(s));
});

test('crc32 and stored ZIP layout', async () => {
  assert.equal(crc32(new TextEncoder().encode('hello')), 0x3610a686);
  const blob = makeZip([{ name: 'a.gpx', text: 'hello' }, { name: 'ü.txt', text: '' }], new Date(2026, 0, 2, 3, 4, 6));
  assert.equal(blob.type, 'application/zip');
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const view = new DataView(bytes.buffer);
  assert.equal(view.getUint32(0, true), 0x04034b50);
  assert.equal(view.getUint16(8, true), 0); // stored
  assert.equal(view.getUint16(10, true), (3 << 11) | (4 << 5) | 3);
  assert.equal(view.getUint16(12, true), ((2026 - 1980) << 9) | (1 << 5) | 2);
  assert.equal(view.getUint32(14, true), 0x3610a686);
  assert.equal(new TextDecoder().decode(bytes.slice(30, 35)), 'a.gpx');
  assert.equal(new TextDecoder().decode(bytes.slice(35, 40)), 'hello');
  const end = bytes.length - 22;
  assert.equal(view.getUint32(end, true), 0x06054b50);
  assert.equal(view.getUint16(end + 10, true), 2);
});

test('labels, lift direction, orientation', () => {
  assert.equal(featureLabel({ ref: '30', name: 'Kanzelwandbahn' }), '30 Kanzelwandbahn');
  assert.equal(featureLabel({ ref: '30', name: '30 Kanzelwandbahn' }), '30 Kanzelwandbahn');
  assert.equal(featureLabel({ ref: null, name: null }), '');
  assert.equal(liftDirection({ liftType: 't-bar' }), 'up');
  assert.equal(liftDirection({ liftType: 'cable_car' }), 'both');
  assert.equal(liftDirection({ liftType: 'chair_lift', oneway: false }), 'both');
  assert.equal(liftDirection({ liftType: 'chair_lift' }), 'unknown');
  assert.deepEqual(orientUphill([[0, 0, 100], [0, 1, 50]]), [[0, 1, 50], [0, 0, 100]]);
  assert.ok(Math.abs(haversine([10, 47], [10, 48]) - 111195) < 10);
});

test('slope segments', () => {
  const segs = slopeSegments([[10, 47, 1000], [10, 47.001, 990], [10, 47.002, 960]]);
  assert.deepEqual(segs.map((s) => s.cls), ['green', 'red']);
  assert.deepEqual(slopeSegments([[10, 47], [10, 47.001]]), []);
});

test('pistes: sections that continue each other form one piste', () => {
  const run = (id, coords, name = 'Talabfahrt', ref = '5') => ({
    geometry: { type: 'LineString', coordinates: coords },
    properties: { id, name, ref, kind: 'downhill', oneway: null },
  });
  const runs = [run('a', [[0, 0], [0, 0.001]]), run('b', [[0, 0.001], [0, 0.002]]), run('c', [[1, 0], [1, 0.001]]), run('d', [[2, 0], [2, 1]], 'Other')];
  assignPistes(runs);
  const id = sha1Hex('downhill|Talabfahrt|5|a').slice(0, 12);
  assert.equal(runs[0].properties.piste, id);
  assert.equal(runs[1].properties.pistes, `|${id}|`);
  assert.equal(runs[2].properties.piste, undefined);
  assert.equal(runs[3].properties.pistes, undefined);
});

test('feature details and ski areas on the fixture', () => {
  const data = loadFixture();
  const lift = featureDetails(data, 'lift-gondola');
  assert.equal(lift.type, 'lift');
  assert.ok(lift.stats.vertical === 800 && lift.stats.duration === 480);
  assert.equal(lift.stats.eleStart, 1000); // lifts are described bottom → top
  assert.equal(lift.stats.profile.length, 81);
  assert.equal(featureDetails(data, 'nope'), null);
  const areas = buildSkiAreas(data);
  assert.deepEqual(areas.areas.map((a) => [a.name, a.isRegion, a.runs, a.lifts]), [['Mini Ski Area', false, 9, 4]]);
  assert.equal(areas.outlines.features.length, 1);
  assert.equal(areas.halos.features.length, 13); // closed runs count too
});
