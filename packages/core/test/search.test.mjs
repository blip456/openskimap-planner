import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SearchError, buildSearchIndex, entrySub, geocode, normalize, prepareSearchIndex, searchLocal } from '../src/search.ts';
import { loadFixture } from './helpers.mjs';

const data = loadFixture();
const index = prepareSearchIndex(buildSearchIndex(data));
const names = (q) => searchLocal(index, q).map((e) => e.name);

test('index: runs pinned at the top, lifts at the bottom station', () => {
  const blue = index.find((e) => e.name === '1 Blue Valley');
  assert.deepEqual(blue.coordinates, [10, 47.01]);
  const gondola = index.find((e) => e.name === 'Valley Gondola');
  assert.deepEqual(gondola.coordinates, [10, 47]);
  assert.equal(gondola.kind, 'Gondola');
  assert.equal(index.filter((e) => e.type === 'place').length, 4);
});

test('normalize', () => {
  assert.equal(normalize('Großer Spitz'), 'grosser spitz');
  assert.equal(normalize('Söllereck Ä'), 'sollereck a');
});

test('ranking basics', () => {
  assert.equal(names('valley')[0], 'Valley Gondola'); // match at the start beats a match after "1 "
  assert.deepEqual(names('blue valley'), ['1 Blue Valley']);
  assert.deepEqual(names('1 blue'), ['1 Blue Valley']);
  assert.equal(names('blue')[0], '1 Blue Valley'); // after a piste number counts as the start
  assert.deepEqual(names('gipfelhutte'), ['Gipfelhütte']);
  assert.deepEqual(names('grosser'), ['Großer Spitz']);
  assert.deepEqual(names('xyz'), []);
  assert.deepEqual(names('   '), []);
  assert.ok(names('a').length <= 10);
  assert.equal(searchLocal(index, 'a', 2).length, 2);
});

test('result sub lines', () => {
  const sub = (name) => entrySub(index.find((e) => e.name === name));
  assert.equal(sub('1 Blue Valley'), 'Blue (easy) run · pin at the top');
  assert.equal(sub('Valley Gondola'), 'Gondola · pin at the bottom station');
  assert.equal(sub('Village path'), 'Connection path');
  assert.equal(sub('Gipfelhütte'), 'Mountain hut · 1895 m');
  assert.equal(sub('Minidorf'), 'Village / locality');
});

test('geocode: Nominatim request without a custom User-Agent, results mapped', async () => {
  let seen;
  const fakeFetch = async (url, init) => {
    seen = { url: String(url), init };
    return new Response(JSON.stringify([{ name: '', display_name: 'Riezlern, Mittelberg, Austria', type: 'village', lat: '47.35', lon: '10.19' }]));
  };
  const hits = await geocode('Riezlern', [10, 47, 10.4, 47.5], { fetch: fakeFetch });
  assert.deepEqual(hits, [{ name: 'Riezlern', sub: 'Riezlern, Mittelberg, Austria', kind: 'village', lat: 47.35, lon: 10.19 }]);
  const url = new URL(seen.url);
  assert.equal(url.origin + url.pathname, 'https://nominatim.openstreetmap.org/search');
  assert.equal(url.searchParams.get('q'), 'Riezlern');
  assert.equal(url.searchParams.get('viewbox'), '10,47,10.4,47.5');
  assert.equal(seen.init.headers, undefined);
  // cached: no second request
  seen = null;
  await geocode('Riezlern', [10, 47, 10.4, 47.5], { fetch: fakeFetch });
  assert.equal(seen, null);
  assert.deepEqual(await geocode('x', null, { fetch: fakeFetch }), []);
});

test('geocode: errors', async () => {
  await assert.rejects(geocode('fails', null, { fetch: async () => new Response('', { status: 503 }) }), (e) => e instanceof SearchError && /503/.test(e.message));
  await assert.rejects(geocode('offline', null, { fetch: async () => { throw new TypeError('network'); } }), /unavailable/);
});
