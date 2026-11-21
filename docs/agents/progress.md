# Progress and handover log

| Phase | Status |
| --- | --- |
| 0 Plan | done (merged to main) |
| 1 Shared core | done (waiting for commit) |
| 2 Data ZIP + zoom levels | done (waiting for commit) |
| 3 App skeleton + dev commands | done (waiting for commit) |
| 4 Feature parity | done (4a + 4b), waiting for commit; `planner/` removed |
| 5 PWA + import | done, waiting for commit and the owner's iPhone test (`docs/agents/iphone-test-phase5.md`) |
| 6 iPhone features | done, waiting for commit and the owner's iPhone test (`docs/agents/iphone-test-phase6.md`) |
| 7 Liquid Glass UI + responsive | done, waiting for commit and the owner's iPhone review (`docs/agents/iphone-test-phase7.md`) |
| 8 Docs | done, waiting for commit |
| Design | spec done (`docs/design/`) |
| Build region (owner request, after phase 8) | done, waiting for commit |

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

### 2026-11-21 · phase 5 · senior engineer · PWA + import
**Done**
- **Manifest + icons:** `scripts/icons.mjs` (from `ios-app-test`, `npm run icons`) makes favicon, apple-touch-icon
  (180, full-bleed), 192/512 and a maskable 512 from `app/public/logo.svg`. `index.html` has the iOS meta tags
  (`apple-mobile-web-app-capable`, `black-translucent`, `viewport-fit=cover`, title "Ski planner"), theme-color for
  light and dark, apple-touch-icon. Manifest name "Ski route planner", short name "Ski planner".
- **Service worker** (vite-plugin-pwa 2, PWA build only): precaches the app shell (HTML, JS, MapLibre/routing/import
  workers, CSS, icons, manifest); online hosts and Nominatim are network only; the data is never cached (OPFS).
  `src/lib/pwa/register.ts` (workbox-window) + `ui/UpdatePrompt.svelte`: "New version available · Reload", no
  forced reload; checks for updates when the app comes back to the front. Desktop build: no SW, no manifest.
- **Import + storage screen** (Menu › Data): installed data (resort, build date, ski data date, zoom levels), size per
  part from the manifest, storage used/available (`estimate()`) with a bar, "Keep data" (`persisted()`, asked with
  `persist()` after each import; plain note when Off + "Ask to keep the data"), Import new data file, Delete data with
  confirmation. First-run screen: plain steps (build ZIP, AirDrop/iCloud Drive → Files, import, do not unzip).
  Import errors have a code and a title: Wrong file / The file is damaged / Not enough space (incl.
  `QuotaExceededError`) / Import failed (`ui/ImportErrorBox.svelte`, `lib/data/storage-info.ts`).
- **Online/offline:** `AppState.onlineUsable` (switch AND `navigator.onLine`) gates online base maps, Mapterhorn
  terrain, Nominatim and Google short links; quiet fallback (one toast, back by itself when the network returns).
  The switch was already saved.
- **Vercel:** `vercel.json` (build `npm run build:pwa`, output `app/dist`, SPA fallback, no-cache for sw.js /
  index.html / manifest, immutable `assets/`, manifest MIME, `npm ci --ignore-scripts`, no functions).
- **Scripts:** `npm run preview:pwa` (build + serve with SW on :4174), `npm run dev:pwa -- --phone` and
  `npm run preview:pwa -- --phone` (`scripts/dev-pwa.mjs`, `scripts/lib/phone-https.mjs`: mkcert certificate for
  localhost, `<host>.local` and LAN IPs, prints the URLs and the trust steps; clear message when mkcert is missing).
- **4b review fix:** toasts go above the tab bar while the menu or a large sheet covers the top (`toastPlacement`).
- README sections (dev/preview/--phone/Vercel/Data page/getting the ZIP onto the phone), decisions, lessons.

**Tests**
- `npm test`: typecheck + 73 core + 20 script (6 new: icons, phone HTTPS, vercel.json) + 19 server + **139 app**
  (new `pwa.test.ts`: data parts, storage status/persist with fakes, import error codes incl. QuotaExceededError,
  online gating in search and `AppState`, saved switch, toast placement, manifest/SW config). Mutation check: removing
  `&& this.network` from `onlineUsable` fails the test.
- `npm run test:e2e -- --trace off`: **24 passed**. New `pwa-data.spec.ts` (both PWA projects): offline start (SW
  controls the page → `setOffline(true)` → reload → map from OPFS, route, local search); wrong file + damaged ZIP
  errors; data screen, delete (cancel + confirm, OPFS empty, still no data after reload), import again; update
  prompt (new sw.js → prompt → no auto reload → Reload loads the new version). Desktop spec: no SW registration, no
  manifest link. `scripts/e2e.mjs` fails if `app/dist-desktop` has sw.js, a manifest or Workbox code.
- Screenshots: `docs/agents/screenshots/phase5/` (first run, wrong file, damaged, data screen, storage, delete
  confirm, update prompt, offline route; iPhone + wide).

**How to verify**
- `npm test`; `npm run test:e2e -- --trace off`.
- `npm run preview:pwa` → <http://localhost:4174>: import the ZIP, DevTools › Application › Service workers shows
  `sw.js`; tick "Offline" and reload: the app and map still work. Menu › Data shows the storage screen.
- Owner on the iPhone: `docs/agents/iphone-test-phase5.md` (the phase 5 review).

**Open issues / notes**
- mkcert is not installed in the cloud environment: `--phone` was only tried with a fake mkcert (openssl
  self-signed + `curl -k`). The owner must try `npm run dev:pwa -- --phone` on the Mac (`brew install mkcert`,
  `mkcert -install`).
- Not checked on a real iPhone: OPFS sync access handles, `persist()` result in Safari vs Home Screen app, install,
  offline start, update prompt. The checklist asks for these values.
- In headless Chromium `persisted()` is false, so the screenshots show "Keep data: Off".
- `vercel.json` is not tried on Vercel yet (no access from here); the first preview deploy will show it.
- The update prompt sits at the top and can cover the logo on the first-run screen (small; phase 7 polish).

**Questions for the owner:** none blocking. Is "Ski planner" fine as the name under the home screen icon?

### 2026-11-21 · phase 6 · senior engineer · iPhone features
**Done**
- **My location:** `watchPosition` only while the user turned location on AND the page is visible (stops on
  `visibilitychange` hidden, starts again on visible; no background tracking). Blue dot (white ring, grey after
  30 s), accuracy circle in real metres (hidden above 2 km) and heading cone as MapLibre layers
  (`lib/map/location-layers.ts`), same colours in light and dark. Plain messages for denied, unavailable, timeout,
  insecure page (http) and no support; the app keeps working without location.
- **Locate button** (`ui/LocateButton.svelte`, iPhone bottom right and desktop right column): Show my location →
  (Finding your location) → Follow my location → Follow my location and heading → Stop following, icons per state
  (outline, filled, custom heading arrow, crossed-out), aria-labels from spec §6. Panning by hand leaves follow mode,
  turning by hand leaves heading mode. State machine in `lib/location/locate.ts`.
- **Compass:** `DeviceOrientationEvent.requestPermission()` synchronously inside the Locate tap (iOS), then
  `webkitCompassHeading` (absolute `alpha` elsewhere). Smoothing along the shortest turn, 2° dead band, max 10
  updates/s, map turns by the shortest way (359 → 0). The compass button still turns the map north; in heading mode
  it goes back to follow. Refused compass → "Compass is off…" toast, next tap stops following.
- **Start from my location:** filled button in the empty Route sheet, "My location" next to Reverse/Clear with
  points (both builds). Core `SkiNetwork.nearest(point, { start })` + worker `nearest(point, { start })`. Limits:
  > 400 m from the runs or accuracy worse than ± 100 m → message, nothing changes; 75–400 m → set with the "far"
  message. With points, the new start goes in front (old A becomes B); an old A within 30 m is replaced.
- **Keep screen on while planning:** Menu › Appearance (saved; only shown where `navigator.wakeLock` exists), asked
  again after the app was hidden, silent errors (`lib/wake-lock.ts`).
- **GPX / backup share:** checked; both use `shareFile` (share sheet with a file, else download). No gap found.
- **Touch:** `html, body { touch-action: pan-x pan-y }`, map `none`, iOS `gesture*` events cancelled
  (`lib/touch.ts`).
- **Phase 5 polish:** the update prompt on the first-run screen is part of the page above the logo (no overlap).
- Dev overlay: the fake GPS position now drives My location (`LocationState.setFake`).
- Docs: decisions (phase 6 entry: states, thresholds, insert vs replace, wake-lock rule), 2 lessons,
  `docs/agents/iphone-test-phase6.md` (owner checklist).

**Tests**
- `npm test`: typecheck + **78 core** (5 new: `nearest`, incl. `start`) + 20 script + 19 server + **169 app** (new
  `location.test.ts`, 30 tests: heading maths incl. wrap/smoothing/throttle, Locate state machine, the location store
  with a fake browser (visibility stop/restart, denied, insecure, timeout, stale, compass permission + refusal,
  requestFix, fake position), start limits + insert, worker `nearest` with `start`, accuracy circle size, wake lock
  (re-acquire, silent), setting saved, page gesture block). Mutation checks: `bearingTarget` returning the raw
  heading, and a doubled accuracy limit, each make a test fail.
- `npm run test:e2e -- --trace off`: **36 passed** (12 new in `location.spec.ts`, all 4 projects): blue dot +
  accuracy circle after the tap (`grantPermissions` + `setGeolocation`), centre, follow moves with the position,
  hand pan → centred; touch projects: heading mode with a stubbed iOS `requestPermission` (asked once), fake
  `deviceorientation` events → bearing 90 and cone rendered, 350 → 10 turns through north (no bearing > 25° on the
  way), compass tap → follow + north, stop following → north; desktop mouse: follow → off. Start from my location
  (snapped < 75 m, toast), too far, not exact, insert in front of an existing point. Denied: state, label, message,
  start button message, map still works. Touch: computed `touch-action`, CDP two-finger pinch + twist zooms and turns
  the map while `visualViewport.scale` stays 1. Keep screen on: switch, saved over reload.
- Screenshots: `docs/agents/screenshots/phase6/` (location dot, heading, route empty, start from my location,
  denied, Appearance; iPhone + wide, both builds). Older phase screenshots were refreshed by the run (they now show
  the working locate button).

**How to verify**
- `npm test`; `npm run test:e2e -- --trace off`.
- `npm run dev:pwa` → Chrome DevTools › Sensors: set a location near Oberstdorf (e.g. 47.4044, 10.2777), tap the
  arrow button; or use the dev overlay (wrench) › Fake GPS. Route tab › Start from my location.
- Owner on the iPhone: `docs/agents/iphone-test-phase6.md`.

**Open issues / notes**
- Not checked on a real iPhone: location and compass prompts, the feel of follow with heading (smoothing values may
  need tuning: `HeadingSmoother` factor 0.35, dead band 2°, 100 ms), wake lock in the Home Screen app, share sheet
  with the backup JSON (the share happens after an IndexedDB read; if iOS refuses it as "not from a tap", the
  fallback is a download).
- A two-finger pinch while following also stops following (MapLibre pans during a pinch); Apple Maps keeps following.
- The "searching" pulse is on the button only (no dot before the first fix).
- The inline update prompt on the first-run screen has no e2e test (the phase 5 update test runs with data).

**Questions for the owner:** none blocking. Is "insert the new start in front of the route" the behaviour you want,
or should "Start from my location" replace the current start?

### 2026-11-21 · phase 7 · product designer + front-end engineer · Liquid Glass polish, landscape, accessibility, performance
**Design audit (screens of 4a–6 vs spec + mockups) — gaps found and fixed**
1. The medium sheet had **no blur in Chromium** (CSS minifier dropped `backdrop-filter`; Safari was fine) → fixed + lint test.
2. Tab capsule was 72 px high, not 64 (padding added to the height) → `box-sizing: border-box`.
3. Text contrast: iOS system blue, red, orange and the 60 % secondary label are below 4.5:1 (axe: ~200 findings) →
   adjusted tokens (see decisions.md, phase 7), glass-specific text tokens, slightly more opaque glass fills.
4. No landscape layout (spec §3.10) → done.
5. Desktop toolbar used 48 px buttons → 36 px with a mouse (spec §3.11); info card and scale bar follow the narrower column.
6. "Ctrl K" and "P" hints were too light (`--label-3` on glass) → secondary glass text; Ctrl K hidden on touch screens.
7. Segmented controls had no arrow keys; focus rings inside the rounded groups were clipped; the scrolling chips row
   was not reachable by keyboard → fixed.
8. Glass budget at rest: iPhone 6 surfaces / 11 % of the screen, desktop 7 / 5 % (checked in e2e). With the sheet at
   medium: 8 surfaces / 53 % (the spec's own medium sheet is 41 %) — kept as designed, recorded as a deviation.
   No glass on glass; large sheet, panel bodies, menu, toasts and alerts are solid; no animated blur.
- Unused `app/src/ui/RouteSheet.svelte` removed.

**Done**
- **Landscape phone** (height < 500 and wider than high, any width): left panel 360 wide (glass header with search,
  menu, Route · Saved · Map; solid body), info card inside the panel, 48 px map buttons (undo + 3D top right, compass,
  panel button + Plan route bottom left of the map area, Locate bottom right), Menu as the modal sheet, map padding =
  panel edge. Rule in `layoutFor()` (`lib/stores/ui.svelte.ts`).
- **Accessibility:** Solid interface switch, `prefers-reduced-transparency` and now also `prefers-contrast: more` →
  no blur; `prefers-reduced-motion` → sheets fade, map camera jumps (was already in place; now tested); visible focus
  rings (inside groups too); radio-group keyboard on segmented controls; chips row focusable; profile chart is a
  `slider` with a text value (unchanged, checked). WCAG AA text contrast in light and dark.
- **Performance:** the Menu loads on first use (dynamic import, precached by the service worker).
  `scripts/measure-perf.mjs` measures bundle sizes, first map, worker start and pan frame rate. Code check: no work on
  every map move (only `moveend`, `rotate`, `pitch` handlers); nothing else worth removing.
- **E2E:** 2 workers by default (`E2E_WORKERS`), old phase screenshot folders only rewritten with
  `E2E_ALL_SHOTS=1`, failure screenshots kept. New `app/e2e/design.spec.ts` (8 runs): all main screens in light and
  dark with **axe** (serious/critical fail), 1440 px, glass budget, 36 px toolbar, landscape layout, reduced motion,
  reduced transparency / increased contrast, keyboard focus and arrow keys. `@axe-core/playwright` 4.14.0 added.
- Fixes found by the test runs: swipe-delete could delete twice (guard + unit test); a flaky Undo tap in the route
  test (tapped while the toast was still sliding in).

**Measured** (Chromium headless, software WebGL, no GPU: only compare numbers with each other; before → after)
| | before | after |
| --- | --- | --- |
| Main JS (desktop/PWA build) | 1409 KB, 399 KB gzip | 1393 KB, 394 KB gzip (+ Menu chunk 21 KB / 7 KB gzip, loaded on first use) |
| CSS | 128 KB, 22 KB gzip | 126 KB, 21 KB gzip |
| First map picture (iPhone size / 1280 wide) | 1.7 s / 3.3 s | 1.7–1.9 s / 2.8–3.4 s (same within noise) |
| Routing worker ready | 370–480 ms | 290–400 ms (same within noise) |
| Pan frame rate, iPhone size: no sheet / medium sheet glass / medium sheet solid | 13 / 15* / 18 fps | 12–13 / 14 / 17 fps |
| Full e2e suite | 9.7 min, 36 tests, 1 worker | 7.6 min, 43 tests, 2 workers (6.6 min with `E2E_WORKERS=3`) |

\* before, the sheet had no blur in Chromium (bug above), so "glass" was really solid there.

**How to verify**
- `npm test` (184 app tests; new `contrast.test.ts`, `css-lint.test.ts`, layout and double-delete tests).
- `npm run test:e2e -- --trace off` → 43 passed. Screenshots: `docs/agents/screenshots/phase7/` (iPhone portrait +
  landscape, wide 1280 + 1440, light + dark: map, route medium/large, info card, search, Map sheet, menu, data screen).
- `npm run build:desktop && node scripts/measure-perf.mjs` for the numbers above.
- Landscape on the desktop: Chrome DevTools device mode, iPhone, rotate.
- Owner on the iPhone: `docs/agents/iphone-test-phase7.md` (**owner review**).

**Open issues / notes**
- Blur cost on the real iPhone is unknown (no GPU here). If panning with the sheet open stutters, switch on the
  `data-map-moving` fallback of spec §5.5 (CSS is ready in `tokens.css`; set the attribute on `movestart`).
- Safari does not support `prefers-reduced-transparency` (as far as known); iPhone users use Solid interface.
- Dynamic Type in standalone mode and the search field above the keyboard are still only checkable on the iPhone
  (in the checklist).
- The colour tokens differ a little from iOS (darker blue / red in light mode) for WCAG AA; the owner may prefer the
  iOS look — easy to change in `tokens.css`, but the contrast tests will then fail on purpose.

**Questions for the owner:** none blocking. Is the slightly deeper blue (for readability) fine, or do you prefer the
exact iOS blue even if it is a bit harder to read?


### 2026-11-21 · phase 8 · technical writer · docs
**Done**
- `README.md` rewritten for the new structure: two builds (table), requirements, quick start for desktop and PWA, zoom
  levels with a size table (z12 12.5 MB, default 45.6 MB, z17 estimate 1.6 GB), data file, one table with all 19 npm
  scripts, online/offline, tests, project layout, troubleshooting, credits (same list as the About screen). The long
  usage sections (planner, saved routes, search, map, speed, routing, resorts) were kept. No mention of `planner/`.
- `docs/vercel.md`: import the repo, branch, settings come from `vercel.json`, no env vars, previews, custom domain,
  how to check service worker updates. States that the data ZIP is not hosted.
- `docs/iphone-guide.md`: for the end user, all points of the task, plus a "Testing" note that links the three
  iPhone checklists.
- `scripts/test/docs.test.mjs` (6 tests): every `npm run X` in README / vercel.md / iphone-guide exists; every script
  is in the README table and the table lists no missing script; no old `planner/` references; checklists linked.

**How to verify:** `npm test` (green); read the three docs.

**Open issues / notes**
- Only z12 and the default are measured. z15 and z16 sizes are not known (z17 is an estimate).
- `z14` is not the default build (basemap 14 instead of 15). Documented.
- The iOS Settings path for a denied location comes from the app's own message (Safari Websites); the exact name of the
  entry for a Home Screen app on a real iPhone is not checked. The guide also mentions Motion & Fitness for the
  compass, which is not verified on a real device.
- Vercel steps are written from `vercel.json`, not tried on Vercel.

### 2026-11-21 · after phase 8 · senior engineer · "Build region" (owner request)
A planning session (not written to `docs/pwa-plan.md`, since this came after it) agreed the design directly with the
owner: a desktop-only page to build a single-region ZIP, either by drawing a box or by searching a ski area, with an
explicit "save for later rebuild, or build once" choice. That session's implementation got interrupted partway
through; this entry picks it up, finds it essentially complete, verifies it, and closes it out. See decisions.md
("after phase 8 · Build region") for the agreed design and the deviations recorded during planning.

**Done (found already written, then verified and fixed)**
- `scripts/lib/region.mjs`: pure region helpers (box or ski-area-list region, validation, slugify, size estimate),
  shared by the build and the server.
- `scripts/build.mjs` / `scripts/build-args.mjs`: `--region=<file> --out=<dir>` builds one region into its own
  folder; a resort or region `bbox` skips the ski-area lookup and is built exactly as drawn (no margin); runs/lifts
  touching the box are kept whole past the edge; downloads and extract caches stay shared in `build/`.
  `scripts/build-pwa-data.mjs` / `scripts/lib/pwa-package.mjs`: the ZIP is named `<region-id>-<date>-z<N>.zip`.
- `server/region-builds.mjs` + wiring in `server/server.mjs`: ski-area search, size estimate, `regions.json`
  read/write (created only on first save), start/poll/cancel a build (one at a time, child process), list/download
  built ZIPs. Flag `PLANNER_REGION_BUILDS` (default on), reported in `capabilities()`.
- `app/src/lib/regions/` (`bbox.ts` box/corner maths, `layers.ts` map layers, `api.ts` client) and
  `app/src/ui/regions/RegionBuilder.svelte`: the "Build region" menu page (draw or search tab, live size estimate,
  Build → save-or-once dialog → progress log → download link, saved-regions list with Rebuild/Delete, built-ZIPs
  list). Wired into the menu (`RootPage.svelte`, behind `caps.regionBuilds`) and lazy-loaded from `App.svelte`.
- `app/src/lib/viewport.ts` was also present (unrelated small fix noted in decisions.md "iOS 26+ … bottom strip",
  already finished and documented by an earlier session).

**What I did this session**
- Found a leftover manual test run from the interrupted session: `build/pwa/test-ifen-box-2026-11-21-z12.zip` and
  `build/regions/test-ifen-box/` (not in git, not in `regions.json` — a one-off build, never saved). It was newer
  than the real Oberstdorf ZIP, so `app/test/real-data.test.ts` (which always picks the newest ZIP in `build/pwa/`)
  picked it up and failed on `engine.search('Nebelhorn')`, since that small test box doesn't include Nebelhorn.
  Deleted both; `npm test` is green again (194 app tests, no change to the test itself needed).
  **Lesson added** to `docs/agents/lessons.md`.
- Found two leftover dev processes from the interrupted session (`node server/server.mjs`, `vite --mode desktop`,
  started hours earlier) still bound to ports 8081/5173, serving the *old* `server.mjs` (no `regionBuilds` in
  `/api/capabilities`). Stopped them and started a fresh `npm run dev:desktop` so the current code is what runs.
- Manually verified the full page in a real (headless) Chromium session against the dev server, since this UI had
  never been run before: open Menu → Build region → Search tab → "Nebelhorn" returns the real ski area → picking it
  shows the size estimate ("About 4 × 4 km… roughly 5 MB")  → Draw tab → dragging on the map produces a bbox field →
  naming the region and clicking Build shows the save/build-once dialog. No console or page errors at any step. Did
  not run an actual build through the UI (would download real data and run tippecanoe/GDAL for several minutes); the
  server-side build pipeline itself is already covered by `server/test/region-builds.test.mjs` with a fake build
  script.
- Wrote this handover entry and the decisions.md entry; neither existed yet (the interrupted session had implemented
  the feature but not documented it).

**How to verify**
- `npm test` (green: 78 core + 37 scripts incl. region helpers + 29 server incl. 10 region-build tests + 194 app).
- `npm run dev:desktop` → Menu → "Build region" → try both tabs; a real build takes a few minutes (downloads +
  tippecanoe/GDAL) and writes a ZIP into `build/pwa/`.

**Open issues / notes**
- No Playwright (`app/e2e/`) spec for the Build region page, even though the component already has `data-testid`
  hooks for one. A full end-to-end test would need to run a real build (slow, needs network + tippecanoe/GDAL) or a
  stubbed build command injected into the server the way `region-builds.test.mjs` does — the current `app/e2e/`
  harness has no way to swap the server's build command for a fake one. Left open rather than guessing at a harness
  change; flagged here instead of adding a test that doesn't really exercise the real build.
- Not tried against a very large box (the `MAX_SPAN_DEG` / size-estimate refusal path) or against cancelling a
  real (not fake) build mid-way, since both need a real multi-minute build to reach.

**Questions for the owner:** none blocking. Want an e2e test for this page eventually (with a stubbed build), or is
the existing unit/integration coverage (region helpers + server with a fake build script) enough, since it's a
desktop-only tool you use yourself?

### 2026-11-21 · after phase 8 · Build region: finish (e2e, bundle fix) and npm scripts docs

**Done**
- Found the uncommitted state: none in tracked files. The only untracked item is `.claude/` (local settings, not for git).
  The "Build region" feature was committed in `d7f9a6c`. Its open issue was the missing e2e test, so that is what this
  session finished.
- `app/e2e/region-builder.spec.ts` (desktop-wide project): search "Nebelhorn", pick it, size estimate, name, Build →
  "Save this region?" dialog → Cancel. It never starts a real build.
- **Bug fixed:** `npm run test:e2e` failed its bundle check. The Build region chunk was in the PWA build and its text
  contained the dev-only label "Load data from build/". `App.svelte` now imports the page only when
  `VITE_TARGET !== 'pwa'`; the help text was reworded. See lessons.md (two new entries).
- npm scripts: `package.json` reordered by topic (data, development, run, production builds, assets, checks). No
  command changed. README "npm scripts" section rewritten as grouped tables. decisions.md has the details.

**How to verify**
- `npm test` (green: 78 core, 37 scripts, 29 server, 194 app).
- `npm run test:e2e` builds both apps and runs the bundle checks. In this environment it cannot find the pinned
  Chromium (see the Playwright lesson). Scratch config used here: a copy of `app/e2e/playwright.config.ts` outside the
  repo that sets `launchOptions.executablePath` to `~/Library/Caches/ms-playwright/chromium_headless_shell-1228/…`.

**Open issues**
- Pinned `@playwright/test` 1.63.0 needs Chromium 1243; the cache has 1228. Not changed (CLAUDE.md: no `playwright install`).
- The "Build region" menu row code is still in the PWA bundle, hidden at run time by `caps.regionBuilds`. Could be
  gated at build time too (wrap that section in the same `VITE_TARGET` check) if the owner wants it out of the phone bundle.

**Questions for the owner:** should the browser cache on this machine be updated to match the pinned Playwright?

### 2026-11-21 · after phase 8 · Build region: "Clean up files" (owner request)

**Done**
- `server/region-builds.mjs`: `cleanupItems()` (count and size per group) and `cleanup(keys)`. Routes `GET` and `POST
  /api/cleanup` in `server/server.mjs`. Groups: region build folders, region ZIPs, shared cache `build/work` (optional),
  downloads `build/downloads` (optional). See decisions.md "Clean up files".
- `app/src/ui/regions/RegionBuilder.svelte`: "Clean up files" section with checkboxes, sizes, a "Clean up…" button, a
  confirm dialog, and a result line. Escape does not close the page while the dialog is open.
- Tests: `server/test/region-cleanup.test.mjs` (7 tests, own temp folder). `app/e2e/region-builder.spec.ts` ticks the
  downloads item, opens the dialog and cancels.

**How to verify**
- `npm test` (78 core, 37 scripts, 36 server, 194 app: green).
- `npm run dev:desktop` → Menu → Build region → "Clean up files". Tick nothing and check the sizes. Only press
  "Clean up…" when you really want to delete something.

**Open issues**
- The browser suite ran before this change (44 passed, 9 skipped, exit 0). Only the Build region spec was re-run after it.
- The new section was not looked at in a screenshot; only the e2e checks it.
- A region whose id starts with `openskimap-data-` would have its ZIPs treated as the main ZIP: they are kept by
  "Clean up files". The id check (`ID_PATTERN`) allows that name, so the owner may want to reserve it.

### 2026-11-21 · after phase 8 · PWA output folder renamed to app/dist-pwa (owner request)

**Done:** the PWA build writes to `app/dist-pwa` (was `app/dist`), like `app/dist-desktop`. All references are updated
(see decisions.md "PWA output folder renamed"). The old generated `app/dist` was deleted.

**How to verify:** `npm run build:pwa` → `app/dist-pwa/sw.js` and `manifest.webmanifest` exist. `npm test` is green
(78 core, 37 scripts, 36 server, 194 app). The full browser suite (scratch config, see the Playwright lesson) is the
check that the PWA tests find the new folder.

**Open issue:** the Vercel project's output directory must be `app/dist-pwa` on the Vercel side if it was set by hand.
Not checked (no access to Vercel from here).

### 2026-11-21 · after phase 8 · Build region: delete one region (owner request)

**Done:** a trash button on each region ZIP. It deletes the ZIP and its `build/regions/<id>` folder (kept while another
ZIP of that region is left). Confirm dialog first. See decisions.md "delete one region". Server tests: 12 in
`server/test/region-cleanup.test.mjs`. Browser test with a fixture ZIP and folder in `region-builder.spec.ts`.

**How to verify:** `npm run dev:desktop` → Menu → Build region → "ZIP files" → trash on a region ZIP.

**Open issues:**
- At the start of this work `build/regions` (three test region builds) and `build/certs` (mkcert files for the phone)
  were no longer in `build/`. No code path found that deletes them on its own; the cause is not known. Not restored.
- The full browser suite was started before the last `build:desktop`, so desktop-iphone tests timed out on the
  replaced build. A clean rerun is needed.

### 2026-11-21 · after phase 8 · The default build moved into build/regions/default (owner request)

**Done:** `npm run build` writes to `build/regions/default/` (planner, tileserver, build-info.json). The desktop server,
`npm start`, `npm run tiles`, `build:pwa-data`, the e2e helpers and the tests read from there. Fonts, sprites,
downloads, work and the ZIPs stay in `build/`. See decisions.md "The default build lives in build/regions/default".
The existing files were moved by hand (no re-download) and `npm run build -- --only=ski` regenerated the config.

**How to verify:** `npm run build -- --only=ski` (needs the local download), `npm start` → the map loads. `npm run
build:pwa-data` → `build/pwa/openskimap-data-….zip` is written. `npm test` green (78 core, 37 scripts, 41 server, 194 app).

**Open issues:**
- Old leftovers in `build/work/` (for example `ski/`, `state.json` from the old default build) are not used any more.
  They can be removed with "Clean up files" (shared cache) or by hand.
- The Vercel setting is not affected (it uses `app/dist-pwa`).

### 2026-11-21 · after phase 8 · pwa-map-data names (owner request)

**Done:** `build/pwa` → `build/pwa-map-data`, `npm run build:pwa-data` → `npm run build:pwa-map-data`, and the script
file → `scripts/build-pwa-map-data.mjs`. All code, messages, tests and user guides use the new names (see decisions.md).
The existing ZIPs were moved, not rebuilt. `npm run build:pwa-map-data` writes the same file name as before, in the new folder.

**How to verify:** `npm run build:pwa-map-data` → the ZIP lands in `build/pwa-map-data/`. `npm test` green (78 core,
37 scripts, 41 server, 194 app). The browser suite is the check for the app text and the Build region page.

**Open issues:**
- The default folder name `build/regions/default/` is still open (the owner was asked whether to name it after the resort).
- A first run of the browser suite was stopped mid-way, because the folder move would have broken it. Rerun needed (in progress).

### 2026-11-21 · after phase 8 · Map folder named after the resort (owner request)

**Done:** `build/regions/default` → `build/regions/oberstdorf-kleinwalsertal`. The name comes from resorts.json through
`scripts/lib/map-folder.mjs`. `npm run tiles` is now `scripts/tiles.mjs`. See decisions.md.

**How to verify:** `npm run build -- --only=ski`, `npm run tiles`, `npm start`. `npm test` green (78 core, 37 scripts,
41 server, 194 app; one app test, `saved.test.ts` delete/undo, failed once under load and passed on reruns).

**Open issues:**
- `saved.test.ts` delete/undo timing: flaky under load. Not investigated yet.
- Dev servers started before the move must be restarted (they still read the old folder).
