import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isGoogleMapsLink, isShortLink, parseCoordinates, parseGoogleMapsUrl } from '../src/geoparse.ts';

const near = (actual, lat, lon) => {
  assert.ok(actual, 'parsed');
  assert.ok(Math.abs(actual.lat - lat) < 1e-5, `lat ${actual.lat} ≈ ${lat}`);
  assert.ok(Math.abs(actual.lon - lon) < 1e-5, `lon ${actual.lon} ≈ ${lon}`);
};

test('coordinates from the README search table', () => {
  near(parseCoordinates('47.3481, 10.2160'), 47.3481, 10.216);
  near(parseCoordinates('47°20\'53.4"N 10°12\'57.7"E'), 47 + 20 / 60 + 53.4 / 3600, 10 + 12 / 60 + 57.7 / 3600);
  near(parseCoordinates("N 47° 20.890' E 010° 12.962'"), 47 + 20.89 / 60, 10 + 12.962 / 60);
  near(parseCoordinates('geo:47.3,10.2'), 47.3, 10.2);
});

test('more coordinate forms', () => {
  near(parseCoordinates('47.3481 10.2160'), 47.3481, 10.216);
  near(parseCoordinates('47.3481N 10.2160E'), 47.3481, 10.216);
  near(parseCoordinates('-33.86, 151.21'), -33.86, 151.21);
  near(parseCoordinates("47°20'N 10°12'O"), 47 + 20 / 60, 10 + 12 / 60);
  near(parseCoordinates('10.2160E 47.3481N'), 47.3481, 10.216);
  near(parseCoordinates('151.21, -33.86'), -33.86, 151.21); // swapped when the first value cannot be a latitude
  near(parseCoordinates('33.86S 151.21W'), -33.86, -151.21);
});

test('text that is not a coordinate', () => {
  for (const s of ['lift 12 3', '12 3', 'Kanzelwandbahn', '', null, '47.3', '95, 200', '47.1N 10.2N', '1, 2, 3']) {
    assert.equal(parseCoordinates(s), null, String(s));
  }
});

test('Google Maps links', () => {
  const place = parseGoogleMapsUrl('https://www.google.com/maps/place/Kanzelwandbahn/@47.35,10.21,15z/data=!3m1!4b1!3d47.3481!4d10.216');
  assert.deepEqual(place, { lat: 47.3481, lon: 10.216, precise: true, label: 'Kanzelwandbahn', query: null });
  const q = parseGoogleMapsUrl('https://maps.google.com/?q=47.3,10.2');
  assert.equal(q.lat, 47.3);
  assert.equal(q.precise, true);
  const search = parseGoogleMapsUrl('https://www.google.com/maps/search/47.1,+10.2');
  assert.equal(search.lat, 47.1);
  assert.equal(search.lon, 10.2);
  const view = parseGoogleMapsUrl('https://www.google.com/maps/@47.35,10.21,15z');
  assert.deepEqual(view, { lat: 47.35, lon: 10.21, precise: false, label: null, query: null });
  const address = parseGoogleMapsUrl('https://www.google.com/maps?q=Walserstra%C3%9Fe+1,+Riezlern');
  assert.deepEqual(address, { lat: null, lon: null, precise: false, label: null, query: 'Walserstraße 1, Riezlern' });
});

test('link detection', () => {
  assert.equal(isGoogleMapsLink('https://www.google.com/maps/place/x'), true);
  assert.equal(isGoogleMapsLink('maps.app.goo.gl/abc'), true);
  assert.equal(isGoogleMapsLink('https://example.com/maps'), false);
  assert.equal(isShortLink('https://maps.app.goo.gl/abc'), true);
  assert.equal(isShortLink('https://www.google.com/maps/place/x'), false);
});
