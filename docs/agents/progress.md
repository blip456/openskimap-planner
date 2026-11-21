# Progress and handover log

| Phase | Status |
| --- | --- |
| 0 Plan | done (merged to main) |
| 1 Shared core | done (waiting for commit) |
| 2 Data ZIP + zoom levels | done (waiting for commit) |
| 3 App skeleton + dev commands | done (waiting for commit) |
| 4 Feature parity | done (4a + 4b), waiting for commit; `planner/` removed |
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

### 2026-11-20 · phase 4a · senior frontend engineer · everything about the route
**Done**
- Route points: plan mode (tap/click adds A, B, C…, max 25 → toast), colours start/stop/end, nearest run/lift name
  as point title (worker `nearest`, ≤ 150 m), markers dragged with pointer events (touch lifts the marker 26 px
  above the finger; mouse keeps the grab offset), mouse click on a marker removes it, a touch tap opens the Route
  sheet and flashes the row. Reverse, Clear, remove (✕) in the list.
- Routing through the worker, debounced 150 ms, stale answers ignored; errors ("No route found" block with a
  Route settings button), warnings (harder runs, gaps, lifts down, moved points) as rows.
- `BottomSheet` (spec §2.9): medium + large detents, drag on handle/header always and on the body at medium, velocity
  projection, close below medium − 80 px, scroll handoff at large (touch), map padding after settling, safe areas,
  keyboard on the handle (↑/↓/Enter), Esc closes, reduced motion fades. Plan/Locate ride on the sheet.
- Route sheet: header (route name or "Route", resort · "Changed since you saved it" / "N points", Share GPX,
  Close), summary + chips (skiing, lifts, ascent, avg/max gradient), points, warnings, gradient profile (official /
  steepness, A/B/C marks, axes, legend, touch scrubbing + hover + ←/→, readout in the header, cursor on the map),
  directions per leg (collapsible and remembered, hover/tap highlights, zoom button, step tap zooms), route arrows
  and distance markers (read from `app.display.showArrows/showDistances`).
- Route settings sub-page (Runs grid, Prefer easier, Use ski paths, No route found?, Lifts, Avoid drag lifts, Ride
  lifts down + types, waiting time stepper, Speed presets with active highlight, "Speed per run colour" sub-page,
  Max walk slider). Undo/redo (50 steps, points + settings) with the glass capsule, ⌘Z/Ctrl+Z, ⌘Y/Ctrl+Y/⇧⌘Z, P, Esc.
- Persistence (`openskimap-planner-v1`, migrates the old `ski-planner-v1`), Saved tab (save / save changes / save as
  new, folder field + picker, open, delete by swipe / Edit mode / button, Undo toast, GPX per route, folder ZIP,
  This device | Project folder on the desktop), GPX share/download decision.
- Files: `app/src/lib/route/*`, `lib/share.ts`, `lib/keyboard.ts`, `lib/saved/stores.ts`,
  `lib/stores/{route,ui,saved}.svelte.ts`, `lib/stores/planner-persist.ts`, `ui/BottomSheet.svelte`,
  `ui/sheet-physics.ts`, `ui/{SheetHeader,SubPageHeader,Switch,Segmented,UndoRedo,Toast}.svelte`, `ui/lists.css`,
  `ui/route/*`, `ui/saved/*`, `ui/MapView.svelte`, `App.svelte`.

**Tests**
- `npm test`: typecheck + 73 core + 14 script + 19 server + **85 app** (Vitest, 11 files; new: route-lib, persist,
  share, saved (fake-indexeddb + the real desktop server for the project folder), legacy-parity (old app.js
  functions vs the new ones on 36 real routes; skips when `planner/` is gone), more store tests).
- `npm run test:e2e`: 8 tests (4 projects × smoke + `route.spec.ts`). The route test plans 3 points by tapping,
  drags B, undo/redo, marker tap, sheet drag to large, profile scrub with touch (CDP touch events) or mouse, steepness
  mode, collapses a leg, settings change (blue off → route changes/warns) + preset + undo, share (stubbed
  `navigator.share` on the phone, download on the desktop), save, folder ZIP, reload (points, open sheet, saved
  route, name, undo history, collapsed leg), clear + open saved, body drag handoff, swipe-delete + Undo, P/Esc.
- Screenshots: `docs/agents/screenshots/phase4a/` (route medium, large, profile scrub, settings, saved; iPhone and
  wide, both builds).

**Parity checklist (route features of the old planner → new place)**

| Old planner | New place | State |
| --- | --- | --- |
| Plan mode button, P, Esc, mode hint | Plan button, mode pill, keyboard | done |
| Click map adds point, max 25 | `RouteState.tap/addPoint` + toast | done |
| Markers A, B, C, colours, drag, click removes | `MapView` markers (touch tap opens the row) | done |
| Point list, Reverse, Clear | Route sheet `PointList` | done (titles: nearest name) |
| scheduleRoute, stale protection, errors, warnings | `RouteState` + `RouteBody` | done |
| Summary chips incl. avg/max gradient | `RouteSummary` | done |
| Gradient profile (official/steepness, A/B/C, axes, hover, map cursor) | `ProfileChart` (+ touch, keyboard) | done |
| Directions per leg, collapsed legs remembered, hover highlight, zoom | `Directions` | done |
| Route arrows, distance markers | `route-layers.ts` | done (toggles: Map sheet, 4b) |
| Runs / Lifts / Speed / Advanced settings | Route settings sub-pages | done |
| Undo/redo + shortcuts, history stored | `History`, `UndoRedo`, `keyboard.ts` | done |
| localStorage state | `planner-persist.ts` | done (map view saved; resort switch UI is 4b) |
| Save / Save as new / status / folder datalist | Saved sheet | done |
| Saved list by folder, open, delete, GPX, ZIP | Saved sheet | done |
| This browser / Project folder | segmented control (desktop with `projectFolderRoutes`) | done |
| Download GPX | Share GPX (share sheet / download) | done |
| Export / import backup, "Copy all to this browser" | store methods exist (`exportBackup`, `importBackup`, `getWithGpx`) | **4b** (Menu › Routes backup) |
| Info cards, search, pin actions | – | **4b** |
| Map options (layers, colours, ski areas, basemap, 3D, arrows/distances toggles) | `app.display` is ready | **4b** |
| Resort switch | `app.switchResort(id)` exists | **4b** (Menu › Resort) |
| Desktop side panel | `RouteHeader/RouteBody`, `SavedHeader/SavedBody` are separate parts | **4b** |
| gpx.studio links | – | **4b** |

**Notes for 4b**
- Sheet contents are header + body components that take `app`; put them in a desktop panel without the BottomSheet.
- The top-right row in `App.svelte` (`.top-right`) holds the undo capsule; add the 3D capsule after it.
- `MapView.onmaptap` is called first on every tap; explore-mode info cards go after `route.tap()` (now logs).
- `UiState.fitTo`, `setHighlight`, `profileCursor` can be reused by info cards and search.
- The old planner's `planner/public/route-stores.js` is ported; when `planner/` goes, `legacy-parity.test.ts`
  skips itself (delete it then, or keep a copy of the old functions in `packages/core/test/reference/`).

**Open issues**
- Not checked on a real iPhone: share sheet with files, touch drag feel, `clip-path` + `backdrop-filter` on Safari.
- At the large detent the undo capsule is under the sheet on the phone (by design).
- Route point names use the nearest run/lift; the old planner showed coordinates. Places (huts) are 4b's search data.

### Orchestrator review of 4a screenshots (for 4b)
Fix in 4b: (1) summary chips overflow the right edge on iPhone width (wrap or horizontal scroll with fade);
(2) list separators in the point list extend past the row/group edge; (3) profile x-axis labels "3 km" and
"3.6 km" overlap (skip a tick label that is too close to the end label); (4) the profile legend is hidden behind
the tab bar at the large detent — content needs bottom padding = tab bar height + safe area.

### 2026-11-21 · phase 4b · senior frontend engineer · feature parity part 2, planner/ removed
**Done**
- **4a review fixes:** (1) summary chips: one scrolling line with a fade at the right edge while there is more;
  (2) separators: `.grp` gets its own stacking context (WebKit clips positioned children at the rounded corners) and
  a separator is never wider than its row (they run to the trailing edge, as in iOS and the mockups); (3) profile
  x-axis: a tick is dropped when its label would touch the end label (by estimated label width), and the end label
  is the real total ("68 m", not "100 m"); (4) large sheet: bottom padding = tab bar + its distance from the bottom +
  24, and the fade covers only the tab bar area. Checked in `screenshots/phase4b/*-route-*.png`.
- **Explore mode / info cards:** tap (touch) or click a run, lift, lift station or place → card with crumbs, key
  numbers, "Use this spot in your route" (start / destination / stop / replace start, as `pinActions`), steepness
  note, piste-section note, elevation profile (ProfileChart with slope colours, touch scrubbing, map cursor), all
  old detail rows, tags, description, links. Whole-geometry highlight (all tile pieces + same-piste sections) and a
  lighter whole-piste highlight from the worker details; mouse hover highlight on `(hover: hover)` devices. iPhone:
  sheet (medium/large); desktop: floating card top right. Tile data first, then `feature(id)` from the worker.
- **Search:** round button next to the tab bar (iPhone: field above the keyboard, results in a glass panel, sheet
  and tab bar hidden while searching); desktop: field in the panel header, ⌘K / Ctrl+K, ↑/↓/Enter/Esc. Local search
  (runs pin at the top, lifts at the bottom station, places), coordinates, full Google Maps links, short links via
  `/api/resolve` only with `googleShortLinks` (else a clear hint), "Search online for …" (Nominatim from the
  browser) only in online mode, offline hint. A result drops an orange pin and opens its card.
- **Map tab:** Show (4 switches), Run colours (official / steepness + legend), Extra (ski areas in colour with
  legend: hover/tap emphasises, tap zooms; route arrows; route distances), Terrain (3D), Base map (online mode only:
  Ski map (offline), OpenSnowMap, OpenFreeMap + pistes from the local ski tiles; fallbacks with a toast, also when
  online mode is switched off). 3D capsule top right, compass when turned (tap → north), lift/one-way arrow images,
  scale bar on the desktop layout.
- **Menu (≡):** Settings root (Resort › , Online mode switch, Data › (PWA), Routes backup › , Appearance › ,
  gpx.studio › (desktop build), About & credits ›), sub-pages with back button and edge swipe; iPhone modal large
  sheet, desktop popover; Esc closes. Online mode (default off in the PWA, on on the desktop) and Solid interface are
  saved. Data: installed data from the manifest + Import data file (phase 3 pipeline, progress, errors). Backup:
  export, import with "Add N routes?" dialog, Copy all to this browser (project folder). About: version, sources,
  licences; the credit line on the map opens it. Menu button shows a dot in online mode (orange without network).
- **Desktop layout ≥ 900 px:** floating panel (glass header with search + menu + segmented Route · Saved · Map, solid
  body reusing the sheet headers/bodies), map toolbar (panel button, Plan route + P, undo/redo, 3D), right column
  (compass, zoom +/−, locate), floating info card, menu popover. Checked at 1280×800 and 1440×900.
- **planner/ removed:** old frontend and `planner/server.mjs` deleted; `npm start` = TileServer GL + `server/server.mjs`
  with the desktop build; `planner` / `planner:legacy` scripts removed; the parity test uses frozen copies of the old
  functions (`packages/core/test/reference/app-route.legacy.mjs`) and now also compares lift rows, crumbs and the
  pin actions. README sections about the planner UI rewritten for the new UI.
- Files: `app/src/lib/explore/info-card.ts`, `lib/search/items.ts`, `lib/stores/{explore,search}.svelte.ts`,
  `lib/map/{layer-filter,basemaps,explore-layers,ski-area-layers,terrain,types}.ts`, `lib/gpx-studio.ts`,
  `ui/{DesktopPanel,Compass,TerrainButton,ConfirmDialog}.svelte`, `ui/info/*`, `ui/search/*`, `ui/map/MapBody.svelte`,
  `ui/menu/*`, plus changes in `App.svelte`, `MapView.svelte`, `app.svelte.ts`, `ProfileChart.svelte`.

**Tests**
- `npm test`: typecheck (core, workers, node, 2× svelte-check) + 73 core + 14 script + 19 server + **122 app**
  (Vitest; new `explore.test.ts`: info cards, pin actions, explore state, layer filter, base maps + online gating +
  OpenFreeMap fallback, search rows + search state (short links, online only, stale answers), settings persistence,
  ⌘K, gpx.studio links, axis labels, backup counting; `legacy-parity.test.ts` no longer skips). Mutation checks: the
  online gating of the search row and of the base map each make a test fail.
- `npm run test:e2e`: 16 tests (4 projects × smoke + route + 2 new in `explore.spec.ts`): tap a run → card with stats
  and profile (hover readout + map cursor with a mouse) → Start here; search a lift → pin → Go here → route (pin at
  the bottom station); coordinates; steepness colours and hidden lifts (layer visibility + no rendered lift
  features); ski-area legend (emphasis); 3D (terrain + pitch) and compass; base map choices by build; menu → Resort
  → back; Solid interface changes `--glass-filter` and survives a reload; gpx.studio only in the desktop build, Data
  only in the PWA; online mode with all external requests blocked → OpenSnowMap / OpenFreeMap fall back to the
  offline map with a toast; online search row only in online mode; desktop panel geometry at 1280×800, screenshot at
  1440×900. No console errors (failed requests to the blocked hosts are ignored in that one test).
- Screenshots: `docs/agents/screenshots/phase4b/` (info card, search, Map sheet, ski areas, menu, menu data (PWA),
  panel at 1280 and 1440, route-1…5 for the 4a fixes; iPhone and wide, both builds).

**Parity checklist (README of the old planner → new place)**

| Old planner | New place | State |
| --- | --- | --- |
| Route points, plan/explore modes, P, Esc, markers | 4a (see table above) | done |
| Directions, gradient profile, summary, warnings, settings, speed, undo/redo, persistence, saved routes | 4a | done |
| Hover highlight of runs/lifts/places | `MapView` mousemove (hover devices) + `hover-highlight` layers | done |
| Info cards: lifts, runs, stations, places, crumbs, links, steepness note, piste sections, profile with slope colours | `ExploreState` + `info-card.ts` + `InfoBody` (sheet / desktop card) | done |
| Use as start / destination / stop (pinActions) | card actions (`applyPinAction`, undoable) | done |
| First click on the map closes an open card | `emptyTap` | done |
| Search: names, coordinates, Google links, short links (server), online search | `SearchState` (online row only in online mode; short links only with the capability) | done |
| Search pin with actions, highlight of the found run/lift | orange pin + card, `search-highlight` | done |
| ⌘K / Ctrl+K, ↑/↓/Enter/Esc in results | `keyboard.ts`, `PanelSearch` | done |
| Map: base map (local / OpenSnowMap / OpenFreeMap), online errors | Map tab, `basemaps.ts` (online mode only, offline fallback) | done |
| 3D terrain (+ map button), Mapterhorn fallback | 3D capsule, Map tab, `terrain.ts` (local terrain; online only as fallback) | done |
| Show (runs, lifts, cross-country, touring & sled), run labels follow | `layer-filter.ts` | done |
| Run colours (official / steepness) + legend | `addSlopeLayer`, Map tab | done |
| Ski areas in colour + legend (hover, click to zoom) | `ski-area-layers.ts`, Map tab legend | done |
| Route arrows, route distances toggles | Map tab | done |
| Lift / one-way direction arrows as images | `useArrowImages` | done |
| Navigation control (zoom, compass), scale bar | desktop: zoom +/−, compass, scale bar; iPhone: compass (pinch to zoom) | done |
| Layers button copy of the Map section | Map tab (replaces it) | done (replaced) |
| Resort select | Menu › Resort | done |
| Export / import backup, Copy all to this browser | Menu › Routes backup | done |
| gpx.studio links with Copy | Menu › gpx.studio (desktop build) | done |
| Footer credits and licences | Menu › About & credits + credit line on the map | done |
| `window.skiPlanner` console helper | not carried over (tests use `?e2e` hooks) | dropped on purpose |
| Old server `/api/route`, `/api/search-index`, `/api/feature`, `/api/ski-areas`, `/api/geocode` | routing worker in the app; Nominatim from the browser | done (server only serves files, routes, short links) |

**How to verify**
- `npm test`; `npm run test:e2e` (needs `npm run build` + `npm run build:pwa-data`).
- `npm start` → <http://localhost:8081>: tap a run (card), ⌘K search, Map tab, ≡ menu. `npm run dev:pwa` for the
  iPhone build (Chrome device mode).
- `npm run build -- --only=ski` still works (ran it after the removal).

**Open issues / notes**
- Not checked on a real iPhone: the search field above the keyboard (`visualViewport`), the edge swipe back in the
  menu, glass cost of the search panel.
- Landscape phone layout (spec §3.10) is not done (phase 7). Between 600 and 899 px the iPhone layout is used.
- The desktop map toolbar uses the 48 px map buttons, not the 36 px capsules of spec §3.11 (phase 7 polish).
- The Data page has no Delete data / storage protection yet (phase 5, as planned).
- Map errors from online hosts are not logged; if an online map is broken for another reason the user only sees the
  fallback toast.

### Orchestrator review of 4b screenshots
- The toast ("Data imported") overlaps the large-sheet title (see `phase4b/pwa-iphone-menu.png`). Move toasts below the top safe area plus header, or above the tab bar, when a large sheet is open. Fix in phase 5 or 7.
