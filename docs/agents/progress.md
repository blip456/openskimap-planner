# Progress and handover log

| Phase | Status |
| --- | --- |
| 0 Plan | done (merged to main) |
| 1 Shared core | done (waiting for commit) |
| 2 Data ZIP + zoom levels | done (waiting for commit) |
| 3 App skeleton + dev commands | to do |
| 4 Feature parity | to do |
| 5 PWA + import | to do |
| 6 iPhone features | to do |
| 7 Liquid Glass UI + responsive | to do |
| 8 Docs | to do |
| Design | spec done (`docs/design/`) |

## Handover entries

<!-- newest at the bottom: date · phase · agent role · what was done · how to verify · open issues · questions -->

### 2026-11-20 · phase 1 · senior engineer · shared core
**Done**
- `packages/core/src/`: TypeScript port (erasable syntax, strict, no DOM/Node APIs) of `geo`, `ski`, `slope`, `piste`
  (pure-JS SHA-1 in `hash.ts` instead of `node:crypto`), `styles/`, `routing/` (SkiNetwork, options, Dijkstra, steps),
  `gpx`, `search` (index + local ranking + `entrySub` from `app.js` + browser-safe Nominatim `geocode`), `geoparse`,
  `feature-info`, `ski-areas`, `zip`, data model types in `types.ts`, everything exported from `index.ts`.
- The old planner server and the data build use the core. Old files removed (see decisions.md).
  `planner/search.mjs` now only has `resolveGoogleLink` (server only). The old frontend is unchanged.
- Tests (`npm test` = `tsc -p packages/core` + `node --test`): 49 unit tests on a small synthetic resort
  (`packages/core/test/fixtures/mini-resort.json`) + 14 golden tests on the real data.
- Golden comparison with the old code (reference copies in `packages/core/test/reference/`): 2,576 route comparisons
  ((100 seeded pairs + 20 multi-point routes + 57 lifts × 2 directions) × 11 option sets; 1,994 real routes and 582
  expected errors), each incl. GPX; network structure; search index + 317 queries; 908 info cards; ski areas; slope
  segments; pistes; labels; map styles; geoparse; ZIP bytes. All identical.

**How to verify**
- `npm test` (golden tests skip with a message when `build/planner/…json` is missing).
- `npm run build -- --only=ski` gave byte-identical styles, tile GeoJSON and planner data (except `builtAt`).
- `npm run planner`: `/api/config`, `/api/search-index`, `/api/ski-areas`, `/api/feature`, `/api/route` (4 routes,
  3 error cases) and static files returned exactly the same bytes as the old server; `/api/geocode` and `/api/resolve`
  work; a Playwright smoke test of the old UI (search) had no errors.

**Measured (real data, Node 24):** network build 45 ms cold, ~20 ms warm (old code ~17 ms warm); read + parse the
resort JSON 12 ms; search index 8 ms; ski areas 82 ms. Well under the 1 s goal of §3.2.

**Open issues / notes**
- Short runs without difficulty between 120 and 150 m do not exist in the real data, so that rule (`SHORT_UNKNOWN_RUN`)
  is only covered by a unit test, not by the golden test.
- No legacy bugs found that needed listing.

### 2026-11-20 · Design · designer
- **What:** design spec for phases 3–7: `docs/design/spec.md` (tokens, 27 components, screens with wireframes,
  interaction rules, glass performance rules, copy, icon map), `docs/design/tokens.css` (copy to
  `app/src/ui/tokens.css` as is), static mockups `docs/design/mockups/main-iphone.html` and `sheets-iphone.html`
  with PNGs (light + `-dark`) at 393 × 852 @2x.
- **Verify:** open the PNGs in `docs/design/mockups/`, or re-render with `node docs/design/mockups/render.cjs`
  (Node 24, Playwright Chromium). The script also re-inlines the icon sprite.
- **For engineers:** build components in the order of spec §2; Lucide icons via `@lucide/svelte/icons/<name>`;
  piste colours in `tokens.css` must match `packages/core/src/ski.ts` (add a test). Decisions are in
  `docs/agents/decisions.md` (designer entry).
- **Check on the real iPhone (phase 7):** blur cost while panning with a sheet open, Dynamic Type via
  `-apple-system-body` in standalone mode, search field position above the keyboard (`visualViewport`).
- **Questions for the owner:** none blocking.

### 2026-11-20 · phase 2 · senior engineer · data ZIP + zoom levels
**Done**
- `scripts/build.mjs`: zoom per build (`z<N>`, `--terrain-zoom=`, `--basemap-zoom=`, `--ski-zoom=`, `--yes`), validation,
  terrain tile/size estimate with confirmation above zoom 16, highest-available-zoom handling per Mapterhorn file,
  per-zoom caches in `build/work/` (hard links into `build/tileserver/data`), `build/build-info.json` and `state.json`
  with the zoom levels really built. Details in decisions.md.
- `scripts/build-pwa-data.mjs` + `npm run build:pwa-data [z<N>] [long flags]`: runs the build first when `build/` is
  missing or the zoom differs from the last build, then writes `build/pwa/openskimap-data-YYYY-MM-DD-z<terrain>.zip`
  (STORE, streaming, ZIP64-capable, SHA-256 per file in `manifest.json`), with precomputed `searchIndex` and `skiAreas`
  inside `planner/<resort>.json`, only the needed glyph ranges, sprites. Prints a size report.
- Core (for phase 5): `zip-records.ts`, `sha256.ts` (incremental), `data-package.ts` (`openDataPackage(read, size)`,
  `readZipEntries`, `parseManifest`, `checkManifestFiles`, `verifyEntrySha256`, injectable SHA-256 factory).
- Tests: `npm test` = typecheck + 71 core tests (8 new, incl. a test on the real ZIP) + 14 script tests. Mutation
  check on the ZIP64 boundary fails the test as expected.

**How to verify**
- `npm test`; `npm run build:pwa-data`; `unzip -tq build/pwa/*.zip` and `zipinfo` (all `stor`); `npm run build z12` then
  `npm run build` shows "reusing stored extract" (no download). Old planner: `npm run planner`, POST `/api/route` works.
- Sizes (Oberstdorf): z14 (basemap 15) 45.6 MB; z12 (basemap 12) 12.5 MB.

**Open issues / notes**
- `z<N>` also lowers the basemap (min(N, 15)), so `z14` is not the default (terrain 14 + basemap 15). The ZIP name only has
  the terrain zoom, so two builds with different basemap zoom can have the same name (the manifest has all three).
- Basemap below zoom 13: the search has no huts/restaurants (places are read from the basemap).
- Fonts for non-Latin scripts (Devanagari etc.) are in the style but not downloaded by the build; such labels would have no text.
- A real archive above 4 GB was not built (disk/time); ZIP64 is covered by unit tests only. z17 estimate for Oberstdorf: 11,335
  tiles, about 1.6 GB.
- The shell had stale `build/work/contours/` scratch files (about 290 MB); they are only temporary and safe to delete.
