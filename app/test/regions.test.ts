// "Build region" page helpers: box drawing and editing, id from the name, capabilities.
import { describe, expect, test } from 'vitest';
import { bboxFromCorners, boxInView, cornerOf, formatBbox, moveCorner, moveTo, opposite, parseBbox, polygon, sizeKm, type Bbox } from '../src/lib/regions/bbox.ts';
import { ID_PATTERN, regionId } from '../src/lib/regions/api.ts';
import { mergeServerCapabilities, staticCapabilities } from '../src/lib/platform/index.ts';

const b: Bbox = [10, 47, 10.2, 47.1];

describe('region box', () => {
  test('two points in any order give the same box, rounded to 5 decimals', () => {
    expect(bboxFromCorners([10.2, 47.1], [10, 47])).toEqual(b);
    expect(bboxFromCorners([10.123456789, 47], [10.2, 47.1])[0]).toBe(10.12346);
    expect(bboxFromCorners([-200, -89], [200, 89])).toEqual([-180, -85, 180, 85]);
  });

  test('dragging a corner keeps the opposite corner; crossing flips the box', () => {
    expect(opposite('nw')).toBe('se');
    expect(opposite('sw')).toBe('ne');
    expect(cornerOf(b, 'ne')).toEqual([10.2, 47.1]);
    expect(moveCorner(b, 'ne', [10.3, 47.2])).toEqual([10, 47, 10.3, 47.2]);
    expect(moveCorner(b, 'sw', [10.05, 47.02])).toEqual([10.05, 47.02, 10.2, 47.1]);
    // the north-east corner dragged past the west side
    expect(moveCorner(b, 'ne', [9.9, 47.05])).toEqual([9.9, 47, 10, 47.05]);
  });

  test('moving keeps the size', () => {
    expect(moveTo(b, [11.1, 48.05])).toEqual([11, 48, 11.2, 48.1]);
  });

  test('a box in the middle of the view', () => {
    expect(boxInView([10, 47, 11, 48])).toEqual([10.25, 47.25, 10.75, 47.75]);
  });

  test('size in km', () => {
    const s = sizeKm(b);
    // 0.2° of longitude at 47.05° N ≈ 15.2 km, 0.1° of latitude ≈ 11.1 km
    expect(s.width).toBeCloseTo(15.17, 1);
    expect(s.height).toBeCloseTo(11.06, 1);
  });

  test('polygon is closed and goes round the box', () => {
    expect(polygon(b).geometry.coordinates[0]).toEqual([[10, 47], [10.2, 47], [10.2, 47.1], [10, 47.1], [10, 47]]);
  });

  test('typing coordinates', () => {
    expect(parseBbox(formatBbox(b))).toEqual(b);
    expect(parseBbox('10 47; 10.2 47.1')).toEqual(b);
    expect(parseBbox('10.2, 47, 10, 47.1')).toBeNull(); // west > east
    expect(parseBbox('10, 47, 10.2')).toBeNull();
    expect(parseBbox('a, b, c, d')).toBeNull();
    expect(parseBbox('10, 80, 11, 89')).toBeNull();
  });
});

test('region id from the name (same rule as the server)', () => {
  expect(regionId('Lech – Zürs am Arlberg')).toBe('lech-zurs-am-arlberg');
  expect(regionId('!!!')).toBe('');
  expect(ID_PATTERN.test('lech-zurs')).toBe(true);
  expect(ID_PATTERN.test('Lech')).toBe(false);
  expect(ID_PATTERN.test('-lech')).toBe(false);
});

test('Build region only when the desktop server offers it', () => {
  expect(staticCapabilities('desktop').regionBuilds).toBe(false);
  expect(staticCapabilities('pwa').regionBuilds).toBe(false);
  const server = { tileServerUrl: null, projectFolderRoutes: true, googleShortLinks: true, data: null };
  expect(mergeServerCapabilities(staticCapabilities('desktop'), server).regionBuilds).toBe(false); // older server
  expect(mergeServerCapabilities(staticCapabilities('desktop'), { ...server, regionBuilds: true }).regionBuilds).toBe(true);
});
