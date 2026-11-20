#!/usr/bin/env node
// Packs the output of `npm run build` into the data ZIP for the phone (docs/pwa-plan.md §5).
//
//   npm run build:pwa-data            pack the current build/
//   npm run build:pwa-data z12        build the data at zoom 12 first (if build/ has another zoom), then pack
//   npm run build:pwa-data -- --terrain-zoom=15 --basemap-zoom=14 --yes
//
// Output: build/pwa/openskimap-data-YYYY-MM-DD-z<terrain zoom>.zip (no compression, ZIP64 when needed).
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { VectorTile } from '@mapbox/vector-tile';
import { PbfReader } from 'pbf';

import { ArgError, formatBytes, parseBuildArgs, resolveZoom } from './lib/build-args.mjs';
import { BASE_RANGE_STARTS, labelKeyTest, labelStrings, rangeFile, rangesForText, selectFontRanges } from './lib/fonts.mjs';
import { buildManifest, fontStacksOf, zipFileName } from './lib/pwa-package.mjs';
import { describeSources, writeZip } from './lib/zip-writer.mjs';
import { openPMTiles } from './lib/pmtiles-file.mjs';
import { buildSearchIndex } from '../packages/core/src/search.ts';
import { buildSkiAreas } from '../packages/core/src/ski-areas.ts';
import { tileRange } from '../packages/core/src/geo.ts';
import { buildBasemapStyle, buildOverlayStyle } from '../packages/core/src/styles/index.ts';

const ROOT = path.resolve(import.meta.dirname, '..');
const BUILD = path.join(ROOT, 'build');
const PLANNER = path.join(BUILD, 'planner');
const TILES = path.join(BUILD, 'tileserver/data');
const FONTS = path.join(BUILD, 'tileserver/fonts');
const SPRITES = path.join(BUILD, 'tileserver/sprites');
const INFO = path.join(BUILD, 'build-info.json');
const SPRITE_FILES = ['light.json', 'light.png', 'light@2x.json', 'light@2x.png'];

const t0 = Date.now();
const log = (msg) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1).padStart(6)}s] ${msg}`);
const readJson = (file, fallback = null) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
};

function runBuild(argv) {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [path.join(ROOT, 'scripts/build.mjs'), ...argv], { stdio: 'inherit' });
    p.on('error', reject);
    p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`the data build failed (exit code ${code})`))));
  });
}

// Does build/ have to be (re)built before packing?
function buildNeeded(args, settings) {
  const info = readJson(INFO);
  if (!info || !fs.existsSync(path.join(PLANNER, 'resorts.json')) || !fs.existsSync(path.join(TILES, 'ski.pmtiles'))) {
    return 'build/ is missing or incomplete';
  }
  const given = Object.values(args.zoom).some((v) => v !== null);
  if (!given && !args.refresh && !args.refreshBasemap) return null;
  const wanted = resolveZoom(args, settings);
  const last = info.requested ?? {};
  const diff = ['terrain', 'basemap', 'ski'].filter((k) => wanted[k] !== last[k]);
  return diff.length ? `zoom changed (${diff.map((k) => `${k} ${last[k] ?? '?'} -> ${wanted[k]}`).join(', ')})` : null;
}

// Characters that can appear as labels: names in the planner data, in the ski tiles' properties and in the basemap.
async function collectLabelRanges(plannerData, bboxes, language) {
  const accept = labelKeyTest(language);
  const texts = new Set();
  const add = (iter) => {
    for (const t of iter) texts.add(t);
  };
  for (const data of plannerData) add(labelStrings(data, accept));
  const skiDir = path.join(BUILD, 'work/ski');
  if (fs.existsSync(skiDir)) {
    for (const f of fs.readdirSync(skiDir).filter((n) => n.endsWith('.geojson'))) {
      add(labelStrings(JSON.parse(fs.readFileSync(path.join(skiDir, f), 'utf8')), accept));
    }
  }
  const basemap = path.join(TILES, 'basemap.pmtiles');
  if (fs.existsSync(basemap)) {
    const archive = openPMTiles(basemap);
    const z = (await archive.getHeader()).maxZoom;
    for (const bbox of bboxes) {
      const t = tileRange(bbox, z);
      for (let x = t.x0; x <= t.x1; x++) {
        for (let y = t.y0; y <= t.y1; y++) {
          const tile = await archive.getZxy(z, x, y);
          if (!tile?.data) continue;
          const vt = new VectorTile(new PbfReader(new Uint8Array(tile.data)));
          for (const layer of Object.values(vt.layers)) {
            for (let i = 0; i < layer.length; i++) add(labelStrings(layer.feature(i).properties, accept));
          }
        }
      }
    }
    await archive.close();
  }
  const ranges = rangesForText(texts);
  return { ranges: selectFontRanges(texts), extra: [...ranges].filter((r) => !BASE_RANGE_STARTS.includes(r)).sort((a, b) => a - b), texts: texts.size };
}

async function main() {
  let args;
  try {
    args = parseBuildArgs(process.argv.slice(2));
  } catch (err) {
    if (!(err instanceof ArgError)) throw err;
    console.error(`\nbuild:pwa-data: ${err.message}`);
    process.exit(2);
  }
  if (args.only) throw new Error('--only is not supported here');
  const config = readJson(path.join(ROOT, 'resorts.json'));
  const settings = config?.settings ?? {};

  const reason = buildNeeded(args, settings);
  if (reason) {
    log(`Running the data build first: ${reason}`);
    await runBuild(process.argv.slice(2));
  } else {
    log('Using the existing data build');
  }

  const info = readJson(INFO);
  if (!info) throw new Error('build/build-info.json is missing. Run `npm run build` first.');
  const resortInfos = readJson(path.join(PLANNER, 'resorts.json'));
  if (!resortInfos?.length) throw new Error('build/planner/resorts.json is missing. Run `npm run build` first.');
  for (const name of ['ski', 'basemap', 'terrain', 'contours']) {
    if (!fs.existsSync(path.join(TILES, `${name}.pmtiles`))) throw new Error(`build/tileserver/data/${name}.pmtiles is missing. Run \`npm run build\` first.`);
  }

  // planner data + precomputed search index and ski areas
  const sources = [];
  const resorts = [];
  const plannerData = [];
  sources.push({ name: 'planner/resorts.json', file: path.join(PLANNER, 'resorts.json') });
  for (const r of resortInfos) {
    const data = readJson(path.join(PLANNER, `${r.id}.json`));
    if (!data) throw new Error(`build/planner/${r.id}.json is missing. Run \`npm run build\` first.`);
    plannerData.push(data);
    log(`Precomputing search index and ski areas for ${r.id}…`);
    const full = { ...data, searchIndex: buildSearchIndex(data), skiAreas: buildSkiAreas(data) };
    sources.push({ name: `planner/${r.id}.json`, data: Buffer.from(JSON.stringify(full)) });
    resorts.push({ ...r, planner: `planner/${r.id}.json` });
  }
  for (const name of ['ski', 'basemap', 'terrain', 'contours']) {
    sources.push({ name: `tiles/${name}.pmtiles`, file: path.join(TILES, `${name}.pmtiles`) });
  }

  // fonts: the stacks the styles use, only the glyph ranges the labels need
  const bounds = resorts.map((r) => r.bbox);
  const styles = [
    buildBasemapStyle({ language: settings.language ?? 'en', bounds: bounds[0], hasTerrain: true, hasContours: true }),
    buildBasemapStyle({ language: settings.language ?? 'en', bounds: bounds[0], hasTerrain: true, hasContours: true, colorBy: 'slope' }),
    buildOverlayStyle({ bounds: bounds[0] }),
  ];
  const { primary, optional } = fontStacksOf(styles);
  if (!primary.length) throw new Error('No font stacks found in the styles');
  log(`Font stacks: ${primary.join(', ')}`);
  log('Scanning labels for glyph ranges…');
  const { ranges, extra, texts } = await collectLabelRanges(plannerData, bounds, settings.language ?? 'en');
  log(`  ${texts} distinct labels; glyph ranges: ${ranges.join(', ')} (beyond the base set: ${extra.length ? extra.join(', ') : 'none'})`);
  for (const stack of optional) {
    if (!fs.existsSync(path.join(FONTS, stack))) log(`  font "${stack}" (non-Latin scripts) is not part of the build; labels in those scripts will show no text`);
    else primary.push(stack);
  }
  let skipped = 0;
  for (const stack of primary) {
    for (const start of ranges) {
      const file = path.join(FONTS, stack, rangeFile(start));
      if (fs.existsSync(file)) sources.push({ name: `fonts/${stack}/${rangeFile(start)}`, file });
      else if (BASE_RANGE_STARTS.includes(start) && start < 1024) throw new Error(`Font file ${path.relative(ROOT, file)} is missing. Run \`npm run build\` again.`);
      else skipped++; // some ranges have no glyphs and no file
    }
  }
  if (skipped) log(`  ${skipped} glyph range files do not exist (no glyphs there), skipped`);
  for (const f of SPRITE_FILES) {
    const file = path.join(SPRITES, f);
    if (!fs.existsSync(file)) throw new Error(`Sprite ${path.relative(ROOT, file)} is missing. Run \`npm run build\` again.`);
    sources.push({ name: `sprites/${f}`, file });
  }

  log(`Reading ${sources.length} files for checksums…`);
  const described = await describeSources(sources);
  const buildDate = new Date().toISOString().slice(0, 10);
  const manifest = buildManifest({ buildDate, files: described, resorts, info, language: settings.language ?? 'en' });
  const [manifestEntry] = await describeSources([{ name: 'manifest.json', data: Buffer.from(JSON.stringify(manifest, null, 2)) }]);
  const entries = [manifestEntry, ...described];

  const outDir = path.join(BUILD, 'pwa');
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, zipFileName(buildDate, info.zoom.terrain));
  log(`Writing ${path.relative(ROOT, outFile)}…`);
  const result = await writeZip(outFile, entries);

  console.log('\nSize report');
  const width = Math.max(...entries.map((e) => e.name.length));
  for (const e of entries) console.log(`  ${e.name.padEnd(width)}  ${formatBytes(e.size).padStart(10)}`);
  const sum = (pre) => entries.filter((e) => e.name.startsWith(pre)).reduce((s, e) => s + e.size, 0);
  console.log(`  ${'-'.repeat(width + 12)}`);
  console.log(`  tiles ${formatBytes(sum('tiles/'))}, fonts ${formatBytes(sum('fonts/'))}, planner ${formatBytes(sum('planner/'))}, sprites ${formatBytes(sum('sprites/'))}`);
  console.log(`  ${'TOTAL (ZIP file)'.padEnd(width)}  ${formatBytes(result.size).padStart(10)}  (${entries.length} files${result.zip64 ? ', ZIP64' : ''})`);
  log(`Done: ${outFile}  (terrain z${info.zoom.terrain}, basemap z${info.zoom.basemap}, ski z${info.zoom.ski})`);
}

main().catch((err) => {
  console.error(`\nbuild:pwa-data failed: ${err.message}`);
  process.exit(1);
});
