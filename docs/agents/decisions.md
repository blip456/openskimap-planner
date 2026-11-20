# Technical decisions and deviations from the plan

<!-- date · phase · decision · why · who advised (senior engineer / tester / designer) -->

## 2026-11-20 · phase 1 · shared core layout and tooling (senior engineer)
- **One npm package at the root, no workspaces.** Code imports the core by relative path with the `.ts` extension
  (`../packages/core/src/routing/index.ts`). `packages/core/package.json` only sets `"type": "module"` and a name; it
  is not installed as a dependency. Why: simplest imports for Node, the old planner and (later) Vite; no symlinks.
- **Erasable TypeScript only**, run directly by Node 24 (type stripping). `packages/core/tsconfig.json`: `strict`,
  `noEmit`, `allowImportingTsExtensions`, `erasableSyntaxOnly`, `verbatimModuleSyntax`. `lib: ["ES2023", "WebWorker"]`
  and `types: []`: the type check fails if core code uses DOM-only (`document`, `window`) or Node APIs. `npm run typecheck`.
- **Tests are plain `.mjs` files** run with `node --test` (`npm run test:core`); they import the `.ts` sources. Not
  type-checked, so they can import the legacy JavaScript reference copies freely. `npm test` = typecheck + core tests;
  later phases add their app tests to the `test` script.
- **Golden tests** compare the core with reference copies of the old code in `packages/core/test/reference/` (taken
  before the switch). They skip with a message when `build/planner/oberstdorf-kleinwalsertal.json` is missing
  (`PLANNER_DATA` can point to another file).
- **Module split:** `geo`, `ski` (classes + colours), `slope`, `piste`, `hash`, `routing/` (`graph`, `options`,
  `steps`, `heap`), `gpx`, `search` (index, local ranking from `app.js`, Nominatim `geocode`), `geoparse`,
  `feature-info`, `ski-areas`, `zip`, `styles/`, `types`, and `index.ts` exporting everything.
- **piste ids without `node:crypto`:** a small pure-JS SHA-1 (`hash.ts`) gives the same ids (tested against
  `node:crypto` and against the ids in the built data). Keeps `assignPistes` usable in the browser.
- **`geocode` in the core sends no custom User-Agent.** It takes `{ headers, fetch }` options; the desktop server passes
  its User-Agent (`NOMINATIM_HEADERS` in `planner/search.mjs`) to follow the Nominatim policy.
- **`resolveGoogleLink` stays in `planner/search.mjs`** (server only). It moves to `server/` in phase 3.
- **Old frontend keeps its own copies** of `planner/public/geoparse.js` and `zip.js` (served as plain browser modules,
  no build step). The golden test checks that the core gives the same results as these files' reference copies.
  The copies go away with `planner/` in phase 4.
- **Removed** `planner/graph.mjs`, `planner/feature-info.mjs`, `planner/ski-areas.mjs` and `scripts/lib/{geo,ski,piste,slope,styles}.mjs`;
  `planner/server.mjs` and `scripts/build.mjs` import the core. `scripts/lib/pmtiles-file.mjs` stays (Node only).
- `makeZip(files, now?)` got an optional date argument for tests; the default is unchanged.
