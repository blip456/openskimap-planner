// Style builder URLs: the data build keeps the TileServer GL placeholders, the app passes its own URLs.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildBasemapStyle, buildOverlayStyle } from '../src/styles/index.ts';

const bounds = [10, 47, 10.3, 47.4];

test('default URLs are the TileServer GL placeholders (build output unchanged)', () => {
  const s = buildBasemapStyle({ language: 'de', bounds, hasTerrain: true, hasContours: true });
  assert.deepEqual(Object.values(s.sources).map((x) => x.url), ['pmtiles://{basemap}', 'pmtiles://{ski}', 'pmtiles://{terrain}', 'pmtiles://{contours}']);
  assert.equal(s.glyphs, '{fontstack}/{range}.pbf');
  assert.equal(s.sprite, 'light');
  assert.equal(buildOverlayStyle({ bounds }).sources.ski.url, 'pmtiles://{ski}');
});

test('the app can set tile, glyph and sprite URLs', () => {
  const urls = { tiles: { basemap: 'pmtiles://basemap', ski: 'pmtiles://ski', terrain: 'pmtiles://terrain' }, glyphs: 'localdata://fonts/{fontstack}/{range}.pbf', sprite: 'localdata://sprites/light' };
  const s = buildBasemapStyle({ language: 'de', bounds, hasTerrain: true, hasContours: false, urls });
  assert.deepEqual(Object.values(s.sources).map((x) => x.url), ['pmtiles://basemap', 'pmtiles://ski', 'pmtiles://terrain']);
  assert.equal(s.sources.terrain.encoding, 'terrarium');
  assert.equal(s.glyphs, urls.glyphs);
  assert.equal(s.sprite, urls.sprite);
  assert.ok(s.layers.some((l) => l.type === 'hillshade'));
  assert.equal(buildOverlayStyle({ bounds, urls }).sources.ski.url, 'pmtiles://ski');
});
