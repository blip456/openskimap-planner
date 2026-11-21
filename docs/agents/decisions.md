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

## 2026-11-20 · phases 3–7 · design spec (designer)
Full spec: `docs/design/spec.md`, tokens: `docs/design/tokens.css`, mockups: `docs/design/mockups/`.
- **Accent = iOS system blue** (`#007AFF` / `#0A84FF`), the only tint colour. Run colours never style UI chrome.
  Why: matches the native test app and iOS; the piste blue stays a map colour.
- **Medium sheet floats 8 px above the tab bar** (strong glass, inset 8); **large sheet is solid** and edge to edge,
  and the tab bar floats over it with a mask fade. Why: plan §8.3 keeps the tab bar visible; a solid large sheet
  saves the biggest blur.
- **Undo + redo in one capsule, hidden when there is nothing to undo/redo**; compass in its own button under the 3D
  capsule; the mode pill is centred in the width left of the compass column. Why: fixes the overlap, cut-off compass
  and invisible disabled undo seen in the native app (plan §8.2).
- **Plan + Locate row 24 px above the tab bar**, the map credit line sits in that gap; MapLibre attribution control off,
  full credits in Menu › About. At medium detent the two buttons ride on the sheet edge.
- **Glass budget as area + count** (≤ 30 % of the viewport, ≤ 6 surfaces normally, ≤ 9 peak) instead of plan §8.5's
  "3–5 surfaces". Why: the plan's layout already has 6 small glass controls; cost is mostly blurred area. Moving
  fallback (`data-map-moving`) only if profiling on the iPhone shows dropped frames.
- **Chart readout replaces the chart header while scrubbing** (no floating bubble). Why: a bubble covered the
  segmented control and could leave the cell on narrow screens.
- **iPhone: tapping a route marker opens it in the Route sheet** instead of removing it (desktop keeps
  click-to-remove). Why: accidental removals with fingers; removing is one tap in the list. Drag lifts the marker
  26 px above the finger.
- **Search results never add a point directly**: they open the info card with the "Use this spot" actions, as the
  current web planner does (the native app added the point at once).
- **Landscape phone uses the desktop arrangement** (left panel with segmented tabs), no bottom bar.
- **Dynamic Type** through `html { font: -apple-system-body }` on touch Safari + rem for sheet content; map chrome
  stays px. Desktop root 15 px.
- **Map style stays light in dark mode**; only the UI follows the system theme.
- **Icons: Lucide** (`@lucide/svelte`, per-icon imports) + 3 custom SVGs (location-heading, compass needle, logo).

## 2026-11-20 · phase 2 · zoom per build, caches, data ZIP (senior engineer)
- **Argument parsing in `scripts/lib/build-args.mjs`** (pure, tested). `z<N>` = terrain N (1-18), basemap min(N, 15), ski
  unchanged; long flags override `z<N>`, which overrides `resorts.json`. Ranges: terrain 1-18, basemap 1-15, ski 8-18
  (the ski tiles start at zoom 8). Unknown options and bad numbers stop the build with a clear message.
- **Estimate:** tile count per zoom comes from the resort bboxes (`tileRange`, an upper bound when resorts overlap).
  Size = tiles x 155 KB, a constant measured on the Oberstdorf z14 extract (150-156 KB per tile for zoom 12-14; the
  estimate is within 10% of the real 36 MB file). The question above zoom 16 uses the zoom that will really be
  downloaded (after checking what Mapterhorn has), `--yes` skips it, no terminal without `--yes` aborts.
- **Highest available terrain zoom:** for each `6-x-y` high-resolution file the build reads the PMTiles header
  (`maxZoom`); each file is extracted up to `min(N, its maxZoom)`. Missing files fall back to the zoom 12 planet file. Both
  cases are logged.
- **Caches:** `build/work/terrain/z<N>/<region hash>.pmtiles`, `build/work/basemap/z<N>/<region hash>.pmtiles` (+ `.json`
  with the Protomaps build), `build/work/contours-cache/<key>.pmtiles` (key = terrain key + intervals, so contours follow
  the terrain). Files in `build/tileserver/data` are hard links to the cache entry (copy if linking fails). Files from the
  older layout are adopted into the cache when their state key matches. `--refresh-basemap` ignores the caches.
- **Actual zoom:** `build/build-info.json` has `zoom` (read from the PMTiles headers) and `requested`; the same goes in
  `state.json` and in a new `zoom` field of the planner JSON (old planner ignores it).
- **Search places at low basemap zoom:** places come from the basemap at its max zoom, so a basemap below 13 has no huts or
  restaurants. The build prints a note. Not worked around (would need a second basemap download).
- **Data ZIP:** the planner file in the ZIP is the planner JSON plus `searchIndex` and `skiAreas` (one file, one parse in
  the worker); `build/planner/*.json` for the old planner is unchanged. `manifest.plannerFormat.precomputed` says so.
  Manifest: `formatVersion` 1, `buildDate`, `source` (OpenSkiData date, Protomaps build), `zoom` {terrain, basemap, ski}
  (actual), `resorts` (with `planner` path), `files` {path, size, sha256}. Terrain and contours are optional for the reader
  (a lighter package is possible later); the builder always includes all four.
- **Fonts:** stacks come from the styles' `text-font`; the 3 Noto Sans stacks are packed. Ranges: 0, 256, 512, 768, 8192
  always, plus ranges with characters in label-like fields of the planner data, ski GeoJSON and basemap tiles. For the
  Oberstdorf data that is only the 5 base ranges (1.3 MB for 3 stacks instead of about 70 MB).
- **Core additions (no DOM, no Node):** `zip-records.ts` (local/central/end records, ZIP64), `sha256.ts` (incremental,
  because WebCrypto cannot hash in chunks; the app can use it or inject its own), `data-package.ts` (reader: ZIP64 central
  directory, STORE only, manifest validation, SHA-256 check by chunks). The Node writer is `scripts/lib/zip-writer.mjs`
  (two passes: hash, then write; real CRC in the headers, no data descriptors). `makeZip` is unchanged (golden test).
- **ZIP64:** entry sizes and offsets of 4 GB and more, and 65,535 entries or more, use ZIP64 records. Tested with forced
  records and with a virtual 5 GB archive for the reader; a real 4 GB file is not part of the tests.
- **`npm test`** now also runs `test:scripts` (`scripts/test/*.test.mjs`).

## 2026-11-20 · phase 3 · app skeleton, data sources, workers, desktop server (senior engineer)
- **Imports of the core:** Vite alias `@core` → `packages/core/src` (+ `paths` in `app/tsconfig.json`), with the `.ts`
  extension as in the rest of the repo (`import { SkiNetwork } from '@core/routing/index.ts'`). One root package.json.
- **Build target from the Vite mode:** `vite build --mode pwa|desktop`; the config defines `import.meta.env.VITE_TARGET`.
  Works on every OS without setting environment variables. **Deviation:** the desktop build goes to
  `app/dist-desktop`, the PWA build (Vercel) to `app/dist`. Why: one folder for both meant `build:pwa` silently
  replaced what `npm start` serves. `npm start` now always runs `build:desktop` first (~2 s).
- **TypeScript projects:** `app/tsconfig.json` (DOM, main thread + Svelte, checked by svelte-check),
  `tsconfig.worker.json` (WebWorker lib, `src/workers/`), `tsconfig.test.json` (+ Node types, Vitest tests),
  `tsconfig.node.json` (vite config + Playwright). `npm run typecheck` runs all of them plus the core. The core
  tsconfig now also has `noUnusedLocals` (the app config found two unused imports in the core).
- **DataSource** (`app/src/lib/data/types.ts`): as plan §3.1, but `plannerData()` returns `{ kind: 'url', url }` (desktop)
  or `{ kind: 'blob', blob }` (OPFS File). The routing worker reads it itself, so the main thread never parses the
  2 MB JSON. `readAsset()` serves fonts/sprites for the local build.
- **Stable PMTiles names:** a `NamedSource` wrapper gives every archive a fixed key, so the style says
  `pmtiles://basemap` (`ski`, `terrain`, `contours`) in both builds; desktop uses `FetchSource` (HTTP Range), PWA uses
  `FileSource(await handle.getFile())`. The core style builders got an optional `urls` parameter; without it they
  return exactly the old styles (checked byte for byte against `build/tileserver/styles/*.json`, plus a core test).
- **`localdata://` protocol** for glyphs and sprites from OPFS. Glyph ranges that are not in the ZIP (only the ranges the
  labels need are packed) get an empty answer instead of an error, so no console errors.
- **Manifest `language`** (optional field, default `en`): the PWA needs the label language for the basemap style. Added
  by `build:pwa-data` (format stays 1; older ZIPs show English labels). Desktop reads it from `resorts.json`.
- **OPFS layout and atomic swap:** `openskimap/pkg-<timestamp>/…` + an empty `.complete` marker written last; the app
  uses the newest folder with a marker. Creating an empty file is atomic; renaming folders is not available in every
  browser (`FileSystemHandle.move` for folders). Unfinished folders are removed at the start of the next import, old
  packages after a successful one. So a failed or cancelled import keeps the old data.
- **Import worker:** one pass per file: `blob.slice` chunk (4 MB) → SHA-256 (core JS hasher) → write. Writes with
  `FileSystemSyncAccessHandle` in the dedicated worker (awaits each call, so pre-16.4 Safari's promise-returning
  methods also work), falls back to `createWritable`. The free space is checked first (`navigator.storage.estimate`).
  Storage is behind a small `StorageDir` interface with an in-memory version for the unit tests.
- **RPC helper** (`app/src/lib/rpc/rpc.ts`): `expose(api, endpoint)` / `wrap<Api>(endpoint)`, typed by the API
  interface; errors keep `name`, `message`, `code`; `transfer(value, [buffers])` in both directions; worker events
  (`emit`/`on`) for import progress. The routing worker exposes the `RoutingEngine` class directly (testable in Node).
- **Routing worker start-up is logged** (`[routing] … ready in N ms`, with read/parse/network/search parts) and shown in
  the dev overlay. It uses the precomputed `searchIndex`/`skiAreas` when present (PWA); desktop builds them (the
  build's planner JSON has no precomputed parts; ski areas are built on first request).
- **Desktop server** (`server/server.mjs`, no framework): serves `app/dist-desktop`, `/data/{planner,tiles,fonts,sprites}`
  (only these four folders of `build/`, file-name patterns + `safeJoin`), Range/HEAD/ETag/If-Range, `/api/capabilities`,
  `/api/routes*`, `/api/resolve`. It does no routing: `POST /api/routes` takes the summary and GPX from the app.
  `routes-store.mjs` and the Google link code are **copies** of the `planner/` files until `planner/` is removed in
  phase 4. Port 8081 (same as the legacy planner; run one at a time).
- **Launchers:** `scripts/lib/launch.mjs` (process groups; optional children). TileServer GL is optional in `start`
  and `dev:desktop` (only gpx.studio needs it).
- **Dev-only code:** the dev overlay is loaded with `if (import.meta.env.DEV) import(...)`, the "Load data from build/"
  button and the `/__dev/pwa-data` middleware (Vite `apply: 'serve'`) exist only in dev. `npm run test:e2e` fails if
  any of their strings is found in a production bundle.
- **Simulated safe areas:** the dev overlay sets `--safe-top/right/bottom/left` on `<html>` (inline style overrides the
  `env()` defaults of `tokens.css`), as spec §1.10 describes.
- **Initial camera:** the resort bbox *covers* the screen (`coverZoom`), instead of `fitBounds` (contain), which showed
  a thin strip of map with empty areas around it on a portrait phone.
- **New route hidden by the sheet → `fitBounds`** into the free area (spec §2.9), only when it is not fully visible.
- **Phase-3 UI shortcuts:** the sheet has only the medium detent (no drag yet); on screens ≥ 900 px it is a centred
  560 px sheet (the desktop side panel is phase 7) and the Plan/Locate buttons stay at the bottom. Menu, search and
  locate buttons show a "comes in phase N" toast. Route point titles are coordinates (nearest names in phase 4).
- **Test hook:** `?e2e` in the URL sets `window.__map`, so the smoke tests can turn coordinates into screen points.
- **Smoke tests:** `@playwright/test` 1.63.0 pinned (see lessons). Four projects: desktop build at 1280×800 and at iPhone
  size (390×844, touch), PWA build at both sizes. The PWA build is served by `app/e2e/static-server.mjs` (static, like
  Vercel), the desktop build by the real desktop server with project-folder routes off.

## 2026-11-20 · phase 4a · route features in the new app (senior engineer)
- **State shape.** `RouteState` (points, plan mode, options, result, undo history, saved-route link, collapsed legs,
  nearest names), `UiState` (open sheet, detent, Route sub-page, toast, map feedback: highlight, profile cursor, fit
  requests, flashed point row), `SavedState` (library of the open storage place), and `AppState.display`
  (`DisplayData`, same keys as the old `state.display`; 4b's Map sheet changes it). Pure helpers live in
  `app/src/lib/route/` (options, history, profile, steps), `lib/share.ts`, `lib/keyboard.ts`, `lib/saved/stores.ts`.
- **Persistence key `openskimap-planner-v1`** (`version: 1` inside), separate from the phase 3 settings key. When it
  is missing, the old planner's `ski-planner-v1` is read once (same origin on the desktop, port 8081), so the route
  and settings of the old planner carry over. Every field is cleaned on load (`cleanPlannerData`); when storage is
  full the history is dropped and the save is retried (as the old planner). Points, view and the saved-route link
  are dropped when the stored resort is not the one opened. "Open sections" are now the open sheet, its detent and
  the Route sub-page (the old `<details>` sections do not exist any more).
- **Undo history: 50 steps** for points + route settings, stored with the state (the old planner kept 100 in memory
  and stored 50; now it is 50 everywhere, as the task asks).
- **Too many points** (25) is a toast, not a route error (the old planner had a separate error line for it).
- **Routing debounce 150 ms** (old `scheduleRoute`), stale answers ignored by a request id. Saving and sharing call
  the worker again with the route name, so the GPX `<name>` is the route name (old planner did the same on save).
- **Map padding at the large detent** stays at the medium value: at large the sheet covers the map anyway, and a
  padding of almost the whole height would make the camera jump. The padding is only set after the sheet settles.
- **Auto-fit only for a new route** (no route before): after a marker drag the map no longer jumps (phase 3 fitted
  every changed route that was partly hidden).
- **BottomSheet geometry:** one element as tall as the large detent; medium is a `translateY`. At medium the part
  below the tab bar is cut off with `clip-path` (bottom corners 32) and left/right insets of 8 are switched with the
  "look" when the drag passes the halfway point; the body gets bottom padding so all content can be scrolled with a
  wheel. At medium the body has `touch-action: none` (every touch drag moves the sheet), at large `pan-y` + a
  `touchmove` handler (non-passive) that takes over a downward drag at `scrollTop 0`. Plan/Locate ride on the sheet
  via the `--sheet-y` / `--sheet-progress` variables the sheet sets on `<html>`.
- **Chart readout replaces the chart header** (spec decision) instead of a floating bubble; the task's "value bubble"
  is this readout (distance, elevation, gradient, run kind + name). Touch: horizontal drag > 6 px scrubs (pointer
  capture, events stop at the chart so the sheet does not move), vertical drag scrolls/moves the sheet; a tap shows
  one point; release keeps it 1 s, then fades. Mouse: hover. Keyboard: ←/→ (Shift: 10 %), the chart is a
  `role="slider"`.
- **Marker drag with pointer events** (not MapLibre's `draggable`): touch lifts the marker 26 px above the finger
  (after 150 ms or the first move), mouse keeps the grab offset. The marker element stops `touchstart`/`mousedown`/
  `click`, so the map neither pans nor adds a point. A **mouse click removes** the point, a **touch tap opens the
  Route sheet and flashes the row** (decided per pointer type, not per device). Markers are kept and updated in
  place, so only a new marker plays the drop-in animation.
- **Share decision:** share sheet only when `navigator.canShare({ files })` is true **and** the device is not a
  desktop (hover + fine pointer). macOS browsers can share files too, but the desktop keeps downloading as the old
  planner did. A closed share sheet (`AbortError`) is not an error; other share errors fall back to a download.
- **Saved routes:** `BrowserRouteStore` uses the old database `ski-planner` / store `routes` (version 1, keyPath
  `id`) and the same record fields, so routes saved by the old planner on the same origin appear. Records without
  points/resort are skipped. `ServerRouteStore` sends the summary and GPX (the new desktop server does not route).
  Delete asks no question; the toast "Route deleted · Undo" puts the record back (browser: same id and dates;
  project folder: a new id, the server cannot re-create an id). Edit mode (header) shows ⊖ buttons; touch swipes;
  with a mouse every row has a delete button.
- **Undo on the phone at the large detent** is not reachable (the large sheet covers the top row, as designed); the
  user drags the sheet down first. Desktop has ⌘Z / Ctrl+Z.
- **Test hooks:** `?e2e` also sets `window.__app` (the `AppState`), so Playwright can read points and results.
- **Parity test with the old code:** `app/test/legacy-parity.test.ts` cuts the old functions out of
  `planner/public/app.js` and compares profile points, gradient, segments (both modes), step texts and distance
  markers on 36 real routes. It skips itself when `planner/` is removed in 4b.

## 2026-11-21 · phase 4b · explore, search, Map sheet, menu, desktop panel, planner/ removed (senior frontend engineer)
- **Layout breakpoint:** the desktop arrangement (left panel, map toolbar, right column with compass, zoom and locate,
  floating info card, menu popover) is used from **900 px window width**, in both builds (`ui.wide`). Below that the
  iPhone layout. Landscape phones (spec §3.10) are left for phase 7.
- **Panel tabs keep the testids `tab-route|saved|map`** (segmented buttons get an optional `testid`), and the panel's
  body has `data-testid="sheet-body"`, so the route tests run on both layouts. The panel is never closed; Esc does not
  close it (spec §3.11). Sheet headers have an optional close button (none in the panel).
- **Info card state** is separate from the open tab (`ExploreState.card`): on the iPhone the sheet shows the card
  instead of the tab content and no tab is selected; closing it returns to the tab sheet. A "Use this spot" action
  opens the Route tab. The card shows the tile's data at once and then the worker's details (stale answers ignored).
- **Card content changes vs the old popup:** the lift title is the name only; type and seats moved to the subtitle
  ("Chairlift · 6 seats", spec §2.13). Three key numbers on top (run: Length · Descent · Steepest; lift/station:
  Length · Rise · Ride time; place: Elevation), then the actions, then all old rows under "Details". The old row texts
  (fmtKm with 2 decimals, fmtSlope, liftRows) are unchanged; a parity test compares them with the old functions.
- **Elevation profile in cards reuses `ProfileChart`** with a one-step route made from the feature geometry (runs:
  steepness slices, lifts: lift colour; lifts drawn bottom → top as before). Props `title`, `showPoints`, optional
  `onmode`. Touch scrubbing and the map cursor work the same as for routes.
- **Search pin is orange** (`--orange`, like the old planner and the task), not the red map pin of spec §2.24: red is
  already the destination marker colour. It is a DOM marker (one at a time).
- **Search:** the worker does the local search; coordinates and full Google Maps links are parsed in the browser;
  short links go to `/api/resolve` only with the capability `googleShortLinks` (the existing name; the task called it
  `resolveShortLinks`). Without it the row says the long link is needed. "Search online" rows only in online mode;
  Nominatim is called from the browser (`geocode` of the core, its 1 request/s limit). On the iPhone the field sits
  above the keyboard (`visualViewport`), the tab bar and the open sheet are hidden while searching (no glass on glass).
- **Base maps:** `effectiveBasemap(choice, online)`; the choice is kept when online mode is off. OpenFreeMap gets the
  runs and lifts from the core overlay style with `pmtiles://ski` (no tile server needed). Hillshading/3D use the
  local terrain first, Mapterhorn online only as fallback in online mode. When an online map fails (OpenFreeMap style
  fetch, or a tile error from an online host) the app shows a toast and uses the offline map for the rest of the
  session (`onlineFailed`), until the user picks a base map again. Map errors from online hosts are not logged as
  console errors (they are expected without network).
- **Style switches** use `setStyle(…, { diff: false })`; every `style.load` re-adds the route, explore, ski-area and
  steepness layers and the arrow images, and a `styleVersion` counter re-runs the map effects.
- **`setPadding` only when the padding really changes,** and the sheet padding is `H − round(0.475 × H)` (no longer
  `ui.sheetTop`, which lags behind a detent change). Every `setPadding` stops a running camera animation (found by
  the 3D tilt test, see lessons).
- **Compass:** shown while the map is turned (|bearing| > 1°) or tilted without 3D; tap = north (and flat unless 3D
  is on). Scale bar (old planner) only on the desktop layout.
- **Menu:** modal large sheet (iPhone) / popover over the panel (desktop). Data page (PWA) shows the manifest summary
  and *Import data file…*; deleting data, `persist()` and the full storage screen stay in phase 5. Appearance has
  Solid interface and Units; "Keep screen on" is phase 6. About shows the version from package.json
  (`import.meta.env.VITE_APP_VERSION`, set in `vite.config.ts`).
- **Routes backup:** "Import backup…" first counts the routes in the file and asks (spec §2.23, `<dialog>`).
- **planner/ removed.** `routes-store.mjs` and the Google link code already lived in `server/`. The legacy-parity test
  now uses `packages/core/test/reference/app-route.legacy.mjs`: the old pure functions cut out of `app.js` with the
  same extractor before deleting it (profile, gradient, steps, distance markers, lift rows, crumbs, pinActions), so it
  no longer skips. Dropped from the old UI on purpose: the `window.skiPlanner` console helper (tests use `?e2e`) and
  the "layers" button copy of the Map section (the Map tab replaces it).

## 2026-11-21 · phase 5 · PWA + import (senior engineer)
- **Icons:** `scripts/icons.mjs` (from `ios-app-test`, adapted to `app/public/`) renders `favicon-32.png`,
  `apple-touch-icon.png` (180, full-bleed, opaque), `icon-192.png`, `icon-512.png` and `icon-maskable-512.png`
  (full-bleed background, drawing scaled to 72 % so it stays inside the safe circle). The PNGs are committed, so the
  Vercel build does not need sharp. `npm run icons` after a logo change; a script test checks sizes and opacity.
- **Home screen name:** the manifest `name` stays "Ski route planner" (what the app shows). `short_name` and
  `apple-mobile-web-app-title` are "Ski planner", because iOS cuts names longer than about 12 characters under
  the icon. Easy to change in `app/vite.config.ts` (`APP_SHORT_NAME`) and `index.html`.
- **Service worker:** vite-plugin-pwa 2 (`generateSW`), only added to the Vite plugins for the `pwa` mode. It is
  registered by `src/lib/pwa/register.ts` with `workbox-window` (`injectRegister: false`), loaded with a dynamic
  import behind `import.meta.env.VITE_TARGET === 'pwa' && !DEV` (a literal, so the desktop build drops the chunk;
  `TARGET` from `platform/` was not enough for Rollup). `registerType: 'prompt'`, `skipWaiting: false`,
  `clientsClaim: true` (the first visit is controlled at once, so the next start works offline). Precache: html, js,
  mjs (MapLibre worker), css, svg, png, webmanifest. No runtime cache: online hosts (OSM, OpenSnowMap,
  OpenFreeMap, Mapterhorn, Protomaps fonts, Nominatim) are an explicit `NetworkOnly` route; the data is read from
  OPFS as files, so nothing of it goes through the worker. `npm run test:e2e` fails when `app/dist-desktop` has
  `sw.js`, a manifest or Workbox code.
- **Update flow:** "New version available · Reload" capsule (top, like a toast; above the tab bar when the top is
  covered). Reload sends `SKIP_WAITING`, reloads on `controlling`. "✕" hides it until the next start. The app also
  checks for a new version when it comes back to the front (`visibilitychange`), because iOS keeps home screen apps
  alive for days.
- **Import errors** have a code (`not-data`, `damaged`, `no-space`, `other`) that crosses the worker boundary in the
  RPC `code` field; the UI shows a title per code ("Wrong file", "The file is damaged", "Not enough space") plus the
  message and a hint. A compressed ZIP counts as "Wrong file". `QuotaExceededError` (and the old Safari code 22)
  during writing becomes "Not enough space"; the half-written folder is removed as before.
- **persist():** asked after every successful import (not on start). The Data page shows "Keep data: On/Off/Unknown"
  with a plain note, and an "Ask to keep the data" row while it is Off. Storage numbers come from
  `navigator.storage.estimate()` (they include the browser's own overhead, so "Used by this app" is a bit more than
  the data size).
- **Delete data:** stops the routing worker, leaves the map (the status goes to `no-data`, the map unmounts and
  releases the files), then removes every `pkg-*` folder. Saved routes, settings and the stored route points stay,
  so importing the same data again brings the last route back.
- **Online gating:** `AppState.onlineUsable = settings.online && navigator.onLine`. The base map, Mapterhorn terrain,
  the Nominatim row and Google short links all use it. Without network an online base map falls back to the offline
  map with one toast and comes back by itself when the network returns (the user's choice is kept). Search says
  "No internet right now…" instead of offering online search. Google short links on the desktop now also need online
  mode (before: only the server capability), as the task asks; long Google Maps links are parsed offline as before.
  External links in info cards (website, OpenStreetMap) are plain links and are not hidden.
- **`--phone`:** no `vite-plugin-mkcert` (deviation): it downloads the mkcert binary from GitHub at run time, which
  fails behind firewalls and adds a hidden download. Instead `scripts/dev-pwa.mjs` uses an installed `mkcert`
  (`brew install mkcert`), makes a certificate for localhost, `<host>.local` and the LAN addresses into
  `build/certs/` (made again when the addresses change), starts Vite with `--host 0.0.0.0` and prints the URLs and
  the iPhone trust steps. Without mkcert it stops with a clear message. mkcert is not installed in the cloud
  environment; the HTTPS path was tried with a fake `mkcert` (openssl self-signed) and `curl -k`. `--phone` also works
  for `preview:pwa` (needed to test the service worker on the iPhone without Vercel).
- **Vercel:** `vercel.json` with `installCommand: npm ci --ignore-scripts` (the native packages of TileServer GL,
  canvas and sqlite3 are not needed for the static build and would slow it down or fail), build `npm run build:pwa`,
  output `app/dist`, SPA rewrite for every path except `assets/`, `sw.js`, `workbox-*` and the manifest (a missing
  asset gives a 404, not index.html), `no-cache` for `/`, `/index.html`, `/sw.js`, the manifest, a one-year immutable
  cache for `/assets/*` and `workbox-*.js`, `application/manifest+json` for the manifest.
- **Toast overlap (4b review):** `toastPlacement()` puts toasts (and the update prompt) above the tab bar while the
  menu or a large sheet is open on the phone; the desktop layout keeps them at the top.

## 2026-11-21 · phase 6 · iPhone features (senior engineer)
- **Where the code is:** pure logic in `app/src/lib/location/` (`locate.ts` button state machine, `heading.ts`
  compass maths, `start.ts` Start-from-my-location limits), the store `lib/stores/location.svelte.ts` (GPS watch,
  visibility, compass events, injectable browser APIs for the unit tests), the map layers
  `lib/map/location-layers.ts`, `lib/wake-lock.ts`, `lib/touch.ts`, `ui/LocateButton.svelte`.
- **GPS only while visible:** `watchPosition` (high accuracy, `maximumAge` 5 s, `timeout` 20 s) runs while the user
  has turned location on AND the page is visible. `visibilitychange` hidden → `clearWatch` and the compass listeners
  are removed; visible → started again. No background tracking. After the first use the GPS keeps running while the
  app is on screen (the dot stays), also in the "off" state after "Stop following". A tap while "Finding your
  location" cancels and stops the GPS.
- **Locate states** follow spec §2.6 with two small changes: (1) after *Follow + heading* the next tap goes to *Off*
  but the dot stays (the GPS keeps running, as in Apple Maps); the tap after that centres at once. (2) *Denied /
  unavailable*: a tap tries again (the user may have changed the setting) and shows the plain message as a toast
  again if it fails; there is **no extra info sheet** (deviation: the toast has the same text; one less screen).
- **Follow and gestures:** a hand pan (`dragstart` with an `originalEvent`) leaves follow mode; a hand rotation
  (`rotatestart` with an `originalEvent`) turns *Follow + heading* into *Follow*. A two-finger pinch also pans in
  MapLibre, so a pinch while following stops following too (Apple Maps keeps following on a pinch; accepted for now).
  Explicit centring zooms in to at least 15; following keeps the zoom. A mode change alone never moves the camera,
  so it does not stop a running animation (the turn to north after a compass tap; see lessons).
- **Heading:** iOS `webkitCompassHeading` (+ `screen.orientation.angle`), else an *absolute* `alpha`
  (`deviceorientationabsolute` on Chrome/Android, 360 − alpha). Relative `alpha` is ignored (it is not a compass).
  Smoothing: exponential along the shortest turn (factor 0.35), then a dead band of 2° and at most 10 updates per
  second. The map turns to `current + shortest difference`, so 359° → 0° is a 1° turn, not a full spin. Each update is
  an `easeTo` of 250 ms. `DeviceOrientationEvent.requestPermission()` is called synchronously inside the Locate tap
  (iOS needs the direct tap). On a desktop with a mouse (`(hover: hover) and (pointer: fine)`) there is no heading
  state: Follow → Off.
- **Cone:** shown whenever a heading is known (after the permission on iOS; on Android at once), not only in heading
  mode. 70° wide, 40° when `webkitCompassAccuracy` < 15°. Symbol layer with `icon-rotation-alignment: map`, so it stays
  right when the map turns. The "searching" pulse is on the button only, not on the dot (there is no dot before the
  first fix).
- **Accuracy circle:** circle layer whose radius is `r0 × 2^zoom` (exponential interpolation), with `r0` computed per
  fix from metres and latitude (512 px tiles). Real size at every zoom without updates per frame. Hidden above 2 km.
- **Start from my location:** button in the empty Route sheet (filled, the main action; "Plan route" becomes the
  second button as the spec says) and "My location" next to Reverse / Clear when there are points (both builds).
  The worker `nearest` now has a `start` option (only nodes a route can leave, like `route()` does) and is a core
  method `SkiNetwork.nearest()` with unit tests. **Insert, not replace:** with points the new start goes in front
  (old A becomes B: "from here to there"); when the old A is within 30 m of the new start it is replaced instead (no
  double point). Undo works as for any point change.
- **Start limits** (`START_LIMITS` in `lib/location/start.ts`): more than **400 m** to the nearest run/lift (the
  router's own `SNAP_DISTANCE`) → "You are … from the nearest run or lift. Start from my location works in the ski
  area." and nothing changes; accuracy worse than **± 100 m** → "Your location is not exact enough …"; **75–400 m** →
  set, with "You are far from the runs. Start set at the nearest lift or run." (spec copy); a fix older than **30 s** is
  not used (the app waits up to 20 s for a new one).
- **Wake lock:** Menu › Appearance › "Keep screen on while planning" (saved), shown only where the browser has
  `navigator.wakeLock`. "While planning" = while the map is open and on screen (simplest rule to understand); the
  lock is asked again after the page was hidden. All errors are silent.
- **GPX / backup share:** already done in 4a/4b with one helper (`shareFile`): share sheet with a file where
  `canShare({ files })` is true and the device is not a desktop, else a download; a cancelled share is not an error;
  other share errors fall back to a download. The backup JSON uses the same path. No change needed.
- **Touch:** `html, body { touch-action: pan-x pan-y }` (no page pinch-zoom or double-tap zoom; scrolling works),
  the map keeps `touch-action: none` (MapLibre does pinch, rotate and two-finger tilt), and iOS `gesturestart/
  gesturechange/gestureend` are cancelled on the document (`lib/touch.ts`). The viewport meta is unchanged
  (no `user-scalable=no`, which iOS ignores anyway).
- **Update prompt on the first-run screen** (phase 5 note): it is now part of the page flow above the logo
  (`placement="inline"`), so it never covers the logo.

## 2026-11-21 · phase 7 · Liquid Glass polish, landscape, accessibility, performance

- **Text colours for WCAG AA (deviation from the iOS system values in spec §1.1).** The task asks for 4.5:1. The
  iOS values do not reach it: `#007AFF` on white is 4.0:1 (3.1:1 on the grey capsule buttons), white on `#007AFF`
  4.0:1, `#FF3B30` 3.6:1, `#FF9500` 2.2:1, and the 60 % secondary label 3.4:1 (3.3:1 on the grouped background).
  New values in `tokens.css` (light / dark): `--accent` `#005EC4` / `#6CB4FF`, new `--accent-fill` (filled buttons,
  tinted Plan route) `#005EC4` / `#0A6FD8`, `--red` `#C4000F` / `#FF8A82`, `--orange` `#C93400` (light only),
  `--label-2` 78 % / 70 %. They look very close to iOS; only next to each other you see the blue is a bit deeper.
  Checked by `app/test/contrast.test.ts` (maths) and axe in `app/e2e/design.spec.ts` (the real page).
- **Text on glass.** Glass mixes with the map. Worst cases: white snow, and a grey (rgb 90) darker than the darkest
  blurred part of the Oberstdorf map (rgb 102, 110, 104, measured on screenshots). To pass 4.5:1 over both:
  light `--glass-fill` 0.6 → 0.7; dark `--glass-fill` 0.7 → 0.86 and `--glass-fill-strong` 0.84 → 0.88 (the map stays
  light in dark mode, so dark glass sits on white snow). New tokens `--glass-accent` (`#004CB8` / `#64ADFF`: selected
  tab, 3D on, locate, active map buttons, mode pill icon) and `--glass-label-2` (secondary text on glass; the medium
  sheet sets `--label-2` to it).
- **Increase contrast and Reduce transparency are solid.** `prefers-contrast: more` now also sets
  `--glass-filter: none` (its fills are 92–98 % opaque anyway, so the blur only cost time). `prefers-reduced-transparency`
  gets the same hairline border as the Solid interface switch.
- **Glass budget.** At rest on the iPhone: 6 blurred surfaces, 11 % of the screen (menu, 3D, Plan, Locate, tab bar,
  search). Desktop at rest: 7 (the panel header + toolbar + right column), 5 % of the screen. **Deviation:** with the
  sheet at medium the blurred area is about 53 % (the sheet alone is 41 %), more than the 30 % rule of spec §5.1.
  The spec's own medium sheet geometry (top at 47.5 % of the height, strong glass) cannot meet 30 %; spec §5.1 names
  the medium sheet as the one big blurred surface. Measured in Chromium (software rendering): panning with the
  glass sheet 14 fps vs 17 fps with the Solid interface. Kept as designed; the owner checks smoothness on the iPhone
  (`iphone-test-phase7.md`). If frames drop there, the next step is the `data-map-moving` fallback of spec §5.5
  (already in `tokens.css`, not switched on).
- **Bug found by the glass budget check:** the medium sheet had **no blur in Chromium**. The CSS minifier drops
  `backdrop-filter` when `-webkit-backdrop-filter` follows it, and Chromium ignores the prefixed one. Safari was fine.
  Fixed (prefixed first) + lint test (lessons.md).
- **Landscape phone (spec §3.10).** Layout rule: height < 500 and wider than high → landscape, at any width (a big
  iPhone on its side is 932 × 430, ≥ 900 wide). Panel left (`8 + safe-left`, top/bottom 8, 360 wide, radius 24)
  with the same parts as the desktop panel: glass header with search field + menu + Route · Saved · Map segmented,
  **solid body** (deviation: spec says strong glass; a 360 px glass panel would be 43 % of the screen, and the
  solid body is easier to read). Map buttons are 48 px (touch): undo + 3D top right, compass under them, Plan route
  bottom left of the map area with a panel button next to it (hides the panel; the menu button then moves to the top
  left of the map), Locate bottom right. No zoom buttons (pinch). The info card shows **in the panel** (no tab
  selected, like the iPhone sheet); a tab tap closes it. The Menu is the iPhone modal sheet (640 wide, centred).
  The "Ctrl K" hint is hidden on touch screens. Map padding left = panel right edge (368).
- **Desktop toolbar 36 px (spec §3.11),** only with a mouse (`pointer: fine`): panel button, Plan route, undo/redo,
  3D, compass, zoom group, locate. A wide touch screen keeps 48 px buttons.
- **Tab bar height:** the capsule was 72 px high (content-box + 4 px padding); now 64 as in spec §2.3.
- **Segmented control keyboard:** one tab stop, ←/→ (and ↑/↓) choose and move the focus (WAI-ARIA radio group).
- **Focus rings inside groups** are drawn inside the row (`outline-offset: -3px`), because the rounded groups clip
  everything outside.
- **Chips row** (route summary) is focusable (`tabindex=0`, `role=group`, label "More route details"): it scrolls
  sideways and must be reachable with the keyboard (axe `scrollable-region-focusable`).
- **Menu loads on first use** (dynamic import; −5 KB gzip at start). The service worker precaches the chunk, so it
  also opens offline.
- **E2E speed:** two Playwright workers (`E2E_WORKERS`, default 2); older phase screenshot folders are only rewritten
  with `E2E_ALL_SHOTS=1` (they are a record of how the app looked then, and rewriting them made git noisy). A shared
  imported-data fixture was not done: an import takes about 1 s, and OPFS belongs to one browser context.
- **Removed** the unused `app/src/ui/RouteSheet.svelte` (phase 3 leftover, not imported anywhere).
