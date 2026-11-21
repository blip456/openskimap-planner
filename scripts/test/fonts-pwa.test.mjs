import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BASE_RANGE_STARTS, labelKeyTest, labelStrings, rangeFile, rangesForText, selectFontRanges } from '../lib/fonts.mjs';
import { buildManifest, fontStacksOf, zipFileName } from '../lib/pwa-package.mjs';
import { buildBasemapStyle, buildOverlayStyle, parseManifest } from '../../packages/core/src/index.ts';

test('font ranges: base set always, plus what the labels use', () => {
  assert.deepEqual(selectFontRanges([]), [0, 256, 512, 768, 8192]);
  assert.deepEqual(selectFontRanges(['Nebelhorn', 'Söllereck', 'Café Ünter']), [0, 256, 512, 768, 8192]);
  // Cyrillic (U+0414 = range 1024), Hebrew, a CJK character, an emoji (no glyph file above U+FFFF)
  assert.deepEqual(selectFontRanges(['Дом']), [0, 256, 512, 768, 1024, 8192]);
  assert.ok(selectFontRanges(['שלום']).includes(1280));
  assert.ok(selectFontRanges(['山']).includes(23552));
  assert.deepEqual(selectFontRanges(['😀']), [0, 256, 512, 768, 8192]);
  // the map styles draw "›" (U+203A) and "‹" themselves: inside the base range 8192
  assert.ok(BASE_RANGE_STARTS.includes(Math.floor(0x203a / 256) * 256));
  assert.ok(BASE_RANGE_STARTS.includes(Math.floor(0x20ac / 256) * 256)); // euro sign
  assert.equal(rangeFile(8192), '8192-8447.pbf');
  assert.deepEqual([...rangesForText(['aÿĀ'])].sort((a, b) => a - b), [0, 256]);
});

test('label scan: only names that the style can show', () => {
  const accept = labelKeyTest('de');
  const feature = { properties: { name: 'Hütte', 'name:de': 'Hütte', 'name:zh': '山', 'name:en': 'Hut', ref: '12', description: 'Σ long text', id: 'abc' } };
  assert.deepEqual([...labelStrings(feature, accept)].sort(), ['12', 'Hut', 'Hütte', 'Hütte']);
  assert.deepEqual([...labelStrings({ a: [{ name: 'x' }, { ref: 'y' }] })], ['x', 'y']);
});

test('font stacks come from the styles; scripts fonts are optional', () => {
  const bounds = [10, 47, 11, 48];
  const styles = [
    buildBasemapStyle({ language: 'de', bounds, hasTerrain: true, hasContours: true }),
    buildOverlayStyle({ bounds }),
  ];
  const { primary, optional } = fontStacksOf(styles);
  assert.deepEqual(primary, ['Noto Sans Italic', 'Noto Sans Medium', 'Noto Sans Regular']);
  assert.ok(optional.every((s) => !primary.includes(s)));
  assert.ok(optional.some((s) => /Devanagari/.test(s)));
  // expressions like ["get", "min_zoom"] are not font names
  assert.ok(![...primary, ...optional].some((s) => ['get', 'min_zoom', 'case'].includes(s)));
  const sample = { layers: [{ layout: { 'text-font': ['A', 'B'] } }, { layout: { 'text-font': ['case', ['<=', ['get', 'z'], 5], ['literal', ['C']], ['literal', ['D']]] } }] };
  assert.deepEqual(fontStacksOf([sample]), { primary: ['A', 'B'], optional: ['C', 'D'] });
});

test('zip name and manifest', () => {
  assert.equal(zipFileName('2026-11-20', 14), 'openskimap-data-2026-11-20-z14.zip');
  const files = [
    { name: 'planner/resorts.json', size: 2, sha256: 'a'.repeat(64) },
    { name: 'planner/r.json', size: 2, sha256: 'b'.repeat(64) },
    { name: 'tiles/ski.pmtiles', size: 2, sha256: 'c'.repeat(64) },
    { name: 'tiles/basemap.pmtiles', size: 2, sha256: 'd'.repeat(64) },
    { name: 'fonts/S/0-255.pbf', size: 2, sha256: 'e'.repeat(64) },
    { name: 'sprites/light.json', size: 2, sha256: 'f'.repeat(64) },
    { name: 'sprites/light.png', size: 2, sha256: '1'.repeat(64) },
  ];
  const info = {
    builtAt: '2026-11-20T10:00:00Z',
    zoom: { terrain: 12, basemap: 12, ski: 16, contours: 15 },
    source: { openSkiData: { finishedAt: '2026-11-20T01:41:30.992Z' }, protomaps: { build: '20261118.pmtiles' }, mapterhorn: true },
  };
  const resorts = [{ id: 'r', name: 'R', bbox: [1, 2, 3, 4], center: [2, 3], planner: 'planner/r.json' }];
  const m = buildManifest({ buildDate: '2026-11-20', files, resorts, info, language: 'de' });
  assert.equal(m.formatVersion, 1);
  assert.equal(m.language, 'de');
  assert.deepEqual(m.zoom, { terrain: 12, basemap: 12, ski: 16 });
  assert.equal(m.source.openSkiData.date, '2026-11-20');
  assert.equal(m.source.protomaps.build, '20261118.pmtiles');
  assert.deepEqual(m.files[0], { path: 'planner/resorts.json', size: 2, sha256: 'a'.repeat(64) });
  assert.ok(!m.files.some((f) => f.path === 'manifest.json'));
  parseManifest(JSON.parse(JSON.stringify(m))); // the reader accepts what the builder writes
});
