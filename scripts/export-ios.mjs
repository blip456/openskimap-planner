// Copies the offline data built by `npm run build` into the iOS app bundle folder
// ios/OpenSkiPlanner/Offline (git-ignored, ~the size of build/tileserver + build/planner).
//
//   npm run ios:export
//
// The map style is rewritten so that every URL points into the app bundle. `__BUNDLE__` is replaced at runtime
// by the app with the real bundle path (see ios/OpenSkiPlanner/Support/OfflineData.swift).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BUILD = path.join(ROOT, 'build');
const OUT = path.join(ROOT, 'ios/OpenSkiPlanner/Offline');

const src = {
  data: path.join(BUILD, 'tileserver/data'),
  styles: path.join(BUILD, 'tileserver/styles'),
  fonts: path.join(BUILD, 'tileserver/fonts'),
  sprites: path.join(BUILD, 'tileserver/sprites'),
  planner: path.join(BUILD, 'planner'),
};

for (const [name, dir] of Object.entries(src)) {
  if (!fs.existsSync(dir)) {
    console.error(`Missing ${name} folder (${dir}). Run "npm run build" first.`);
    process.exit(1);
  }
}

const requiredPmtiles = ['ski.pmtiles'];
for (const f of requiredPmtiles) {
  if (!fs.existsSync(path.join(src.data, f))) {
    console.error(`Missing ${f}. Run "npm run build" first.`);
    process.exit(1);
  }
}

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(path.join(OUT, 'styles'), { recursive: true });
fs.mkdirSync(path.join(OUT, 'data'), { recursive: true });

// 1. map data (PMTiles: ski runs/lifts, Protomaps basemap, Mapterhorn terrain, contours)
for (const f of fs.readdirSync(src.data)) {
  if (f.endsWith('.pmtiles')) fs.copyFileSync(path.join(src.data, f), path.join(OUT, 'data', f));
}

// 2. fonts and sprites (used by the labels of the styles)
fs.cpSync(src.fonts, path.join(OUT, 'fonts'), { recursive: true });
fs.cpSync(src.sprites, path.join(OUT, 'sprites'), { recursive: true });

// 3. planner data: runs, lifts, spots and places per resort (routing and search run offline on these)
fs.cpSync(src.planner, path.join(OUT, 'planner'), { recursive: true });

// 4. styles: the same styles as the tile server, with local URLs
const dataFiles = new Set(fs.readdirSync(path.join(OUT, 'data')).map((f) => f.replace(/\.pmtiles$/, '')));
function localizeStyle(style) {
  const sources = Object.fromEntries(
    Object.entries(style.sources ?? {}).map(([id, s]) => {
      if (typeof s.url !== 'string') return [id, s];
      const m = s.url.match(/^pmtiles:\/\/\{(\w+)\}$/);
      if (!m || !dataFiles.has(m[1])) return [id, s];
      return [id, { ...s, url: `pmtiles://file://__BUNDLE__/Offline/data/${m[1]}.pmtiles` }];
    }),
  );
  const out = {
    ...style,
    sources,
    glyphs: 'file://__BUNDLE__/Offline/fonts/{fontstack}/{range}.pbf',
    sprite: 'file://__BUNDLE__/Offline/sprites/light',
  };
  // 3D terrain: the style only needs the terrain source and the terrain property; the app tilts the camera
  if (sources.terrain) out.terrain = { source: 'terrain', exaggeration: 1.4 };
  return out;
}

let styleCount = 0;
for (const f of fs.readdirSync(src.styles)) {
  if (!f.endsWith('.json')) continue;
  const style = JSON.parse(fs.readFileSync(path.join(src.styles, f), 'utf8'));
  // the vector "ski overlay" styles have no basemap and are only useful on the web; keep the full map only
  if (f.startsWith('ski-basemap') || f === 'ski-overlay.json') {
    fs.writeFileSync(path.join(OUT, 'styles', f), JSON.stringify(localizeStyle(style)));
    styleCount++;
  }
}

// 5. ski areas in colour: the same outlines, halos and labels the web planner builds at runtime
const { buildSkiAreas } = await import(pathToFileURL(path.join(ROOT, 'planner/ski-areas.mjs')).href);
for (const f of fs.readdirSync(path.join(OUT, 'planner'))) {
  if (!f.endsWith('.json') || f === 'resorts.json') continue;
  const id = f.replace(/\.json$/, '');
  const areas = buildSkiAreas(JSON.parse(fs.readFileSync(path.join(OUT, 'planner', f), 'utf8')));
  fs.writeFileSync(path.join(OUT, 'planner', `${id}.areas.geojson`), JSON.stringify(areas.outlines));
  fs.writeFileSync(path.join(OUT, 'planner', `${id}.halos.geojson`), JSON.stringify(areas.halos));
  fs.writeFileSync(path.join(OUT, 'planner', `${id}.labels.geojson`), JSON.stringify(areas.labels));
}

const resorts = JSON.parse(fs.readFileSync(path.join(src.planner, 'resorts.json'), 'utf8'));
const size = (dir) =>
  fs.readdirSync(dir, { recursive: true }).reduce((sum, f) => {
    const p = path.join(dir, f);
    return fs.statSync(p).isFile() ? sum + fs.statSync(p).size : sum;
  }, 0);
console.log(
  `Exported ${styleCount} style(s), ${resorts.length} resort(s) and ${(size(OUT) / 1e6).toFixed(0)} MB to ${path.relative(ROOT, OUT)}`,
);
