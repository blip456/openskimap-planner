// Pure helpers for build-pwa-data.mjs (kept separate so they can be tested): zip name, manifest, font stacks.
import { MANIFEST_FORMAT_VERSION } from '../../packages/core/src/data-package.ts';

/** build/pwa/<prefix>-YYYY-MM-DD-z<terrain zoom>.zip; region builds use the region id as the prefix. */
export const zipFileName = (date, terrainZoom, prefix = 'openskimap-data') => `${prefix}-${date}-z${terrainZoom}.zip`;

const EXPRESSION_OPS = new Set(['get', 'case', 'literal', '==', '<=', '>=', '<', '>', 'coalesce', 'has', 'any', 'all', '!', 'format', 'match', 'step', 'interpolate', 'let', 'var', 'to-string']);
const isFontList = (v) => Array.isArray(v) && v.length > 0 && v.every((s) => typeof s === 'string') && !EXPRESSION_OPS.has(v[0]);

/**
 * Font stacks that styles use in `text-font`. `primary` are plain lists (used by normal labels); `optional` come from
 * expressions, for example the fonts for non-Latin scripts in the basemap (only used when a name needs them).
 */
export function fontStacksOf(styles) {
  const primary = new Set();
  const optional = new Set();
  const inExpression = (v) => {
    if (!Array.isArray(v)) return;
    if (v[0] === 'literal' && isFontList(v[1])) v[1].forEach((s) => optional.add(s));
    else v.forEach(inExpression);
  };
  const walk = (v, key) => {
    if (key === 'text-font') {
      if (isFontList(v)) v.forEach((s) => primary.add(s));
      else inExpression(v);
      return;
    }
    if (Array.isArray(v)) v.forEach((x) => walk(x, key));
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, k);
  };
  for (const style of styles) walk(style.layers ?? [], '');
  for (const s of primary) optional.delete(s);
  return { primary: [...primary].sort(), optional: [...optional].sort() };
}

/**
 * Builds manifest.json content.
 * files: [{ name, size, sha256 }] (everything except manifest.json), resorts: planner resort infos
 * with `planner` path, info: build/build-info.json.
 */
export function buildManifest({ buildDate, files, resorts, info, language = 'en' }) {
  const finished = info?.source?.openSkiData?.finishedAt ?? null;
  return {
    formatVersion: MANIFEST_FORMAT_VERSION,
    buildDate,
    builtAt: new Date().toISOString(),
    dataBuiltAt: info?.builtAt ?? null,
    source: {
      openSkiData: { ...(info?.source?.openSkiData ?? {}), date: finished ? finished.slice(0, 10) : null },
      protomaps: info?.source?.protomaps ?? null,
      mapterhorn: info?.source?.mapterhorn ?? null,
    },
    // zoom levels really built (read from the PMTiles headers)
    zoom: { terrain: info?.zoom?.terrain ?? null, basemap: info?.zoom?.basemap ?? null, ski: info?.zoom?.ski ?? null },
    // the planner file holds runs, lifts, places and the precomputed search index (`searchIndex`) and ski areas (`skiAreas`)
    plannerFormat: { precomputed: ['searchIndex', 'skiAreas'] },
    // label language of the basemap style (resorts.json settings.language)
    language,
    resorts,
    files: files.map((f) => ({ path: f.name, size: f.size, sha256: f.sha256 })),
  };
}
