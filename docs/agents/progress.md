# Progress and handover log

| Phase | Status |
| --- | --- |
| 0 Plan | done (merged to main) |
| 1 Shared core | done (waiting for commit) |
| 2 Data ZIP + zoom levels | done (waiting for commit) |
| 3 App skeleton + dev commands | done (waiting for commit) |
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

### 2026-11-20 · phase 3 · senior engineer · app skeleton + dev commands
**Done**
- `app/`: Vite 8 + Svelte 5 (runes) + TypeScript, `@core` alias. Build target from the Vite mode (`pwa` | `desktop`),
  `platform` module with capabilities; desktop reads `/api/capabilities`.
- DataSource (`app/src/lib/data/`): `ServerDataSource` (PMTiles over HTTP Range, planner JSON, fonts, sprites from the
  desktop server) and `LocalDataSource` (OPFS). Import pipeline in a worker: ZIP read with `blob.slice`, copy in 4 MB
  chunks with SHA-256 on the same chunks, sync access handles (fallback `createWritable`), new folder + `.complete`
  marker, so a failed/cancelled import keeps the old data; progress events; free-space check. Minimal no-data screen
  with *Import data file*, progress, cancel and errors.
- Map: style built in the browser by the core style builder (new optional `urls` parameter; TileServer GL styles are
  byte-identical), `pmtiles://basemap|ski|terrain|contours` in both builds, `localdata://` for glyphs/sprites, hillshade
  + contours in the style. Route line layers, markers A/B/C (drag; tap removes with a mouse, opens the Route sheet on
  touch).
- Routing worker with a typed RPC helper (errors, transferables, events): `load`, `route` (+GPX), `search`, `feature`,
  `skiAreas`, `nearest`. Start-up time is logged.
- UI shell with the design tokens (`app/src/ui/tokens.css` = `docs/design/tokens.css`, checked by a test): glass tab bar
  (Route · Saved · Map) + search button, menu button, Plan route button + mode pill, locate button, credit line, medium
  Route sheet with summary (Time · Distance · Descent + chips), warnings, points (remove, reverse, clear), errors,
  toast. Keyboard: P, Esc.
- `server/server.mjs` (desktop server, see decisions), `scripts/dev-desktop.mjs`, new `scripts/start.mjs`,
  `scripts/lib/launch.mjs`, `scripts/e2e.mjs`. Old planner untouched: `npm run planner` / `npm run planner:legacy`.
- Dev only: *Load data from build/* (Vite middleware `/__dev/pwa-data`, newest ZIP in `build/pwa/`), dev overlay (wrench
  button at the left edge): simulated iPhone safe areas, online/offline setting, fake GPS position + heading (stored
  only, used in phase 6), routing start-up time.

**Tests:** `npm test` = typecheck (core, workers, node, 2× svelte-check) + 73 core + 14 script + 19 server
(Range, path traversal, routes) + 43 app (Vitest: RPC, stores, import pipeline incl. failure cases, local data source,
`localdata://`, styles, routing engine, tokens vs core colours, icons, camera, real-ZIP import). `npm run test:e2e`:
4 Playwright smoke tests (desktop build + PWA build, each at 1280×800 and iPhone 390×844 touch): map renders
(canvas not blank), plan mode, two taps → route summary; PWA: no-data screen → import of the real
`build/pwa/*-z14.zip` → map from OPFS → route → reload still has the data; no console errors.
Screenshots: `docs/agents/screenshots/phase3/`.

**Measured (Chromium headless, software WebGL, real Oberstdorf data)**
- Routing worker: ready in 230–360 ms after start, of which read 15–37 ms, JSON parse 6–47 ms, network build
  42–75 ms, search index 2 ms (precomputed, PWA) / 8–17 ms (built, desktop); 6211 nodes, 9167 edges. The rest is
  starting the worker itself. Node: 59 ms for read + parse + network + index. Far below the 1 s goal (§3.2).
- Import of the 45.6 MB z14 ZIP into OPFS incl. SHA-256 of every file: 0.63–0.79 s (sync access handles).
- `build:pwa` output (`app/dist`, 1.9 MB): main JS 1236 KB (343 KB gzip, almost all MapLibre), MapLibre worker 551 KB
  (157 KB gzip), routing worker 39 KB (15 KB gzip), import worker 13 KB, CSS 93 KB (15 KB gzip, mostly maplibre-gl.css).

**How to verify (owner)**
- `npm install`, then (with data from `npm run build` and `npm run build:pwa-data`):
- `npm run dev:desktop` → <http://localhost:5173>: map, press **Plan route** (or P), click two points on runs → route
  and the Route sheet. Ctrl+C stops Vite, the desktop server and TileServer GL together.
- `npm run dev:pwa` → <http://localhost:5174>: no-data screen → **Load data from build/** (or **Import data file** and
  pick `build/pwa/…-z14.zip`) → map from the browser storage. The orange wrench at the left edge opens the dev overlay
  (try *iPhone safe areas*). Use Chrome DevTools device mode (iPhone) for touch.
- `npm start` → <http://localhost:8081> (desktop build). `npm test`, `npm run test:e2e`.

**Open issues / notes**
- TODO phase 5: `npm run dev:pwa -- --phone` (mkcert HTTPS on the LAN) and `npm run preview:pwa` (with service worker);
  `persist()` and the storage screen.
- TileServer GL cannot start in the cloud environment (`libOpenGL.so.0` missing); the launchers keep going without it.
  Not a code problem; check `npm start` once on the Mac.
- OPFS + sync access handles were tested in Chromium only. Check on the iPhone in phase 5 (Safari ≥ 16.4).
- The ZIP must be rebuilt with `npm run build:pwa-data` to get German labels in the PWA (new manifest field `language`);
  older ZIPs work with English labels.
- Not yet in the UI (later phases): 3D toggle, search, info cards (explore taps are logged to the console), saved
  routes, settings menu, sheet drag/large detent, desktop side panel, nearest names for route points.
