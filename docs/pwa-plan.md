# Plan: iPhone PWA + desktop build from one code base

Branch: `iphone-pwa` · Status: **draft for review** · Nothing in this plan is built yet.

## 1. Goal

Rebuild the ski route planner as **one shared frontend with two builds**:

| | **PWA build** | **Desktop build** |
| --- | --- | --- |
| Where it runs | Static site on **Vercel**, installed on the iPhone home screen. Also usable in a desktop browser. | Local Node.js server on the development machine (like today's `npm start`). |
| Map data | **Imported from a ZIP file** and stored on the device. | Read from `build/` on disk through the local server. |
| Routing, search, info cards | In the browser (Web Worker). | In the browser (Web Worker), the same code. |
| Node backend | None. | Serves the app and the data files, TileServer GL for gpx.studio, routes in the project folder, Google Maps short links. |
| gpx.studio section | Hidden. | Shown. |

The design is **mobile first** and responsive: on a large screen it gets a desktop layout. It uses a Liquid Glass style that follows Apple's design (see §8).

### Decisions taken

| Topic | Decision |
| --- | --- |
| Data on the phone | **File import only.** No hosted download. A local command builds the ZIP. |
| Later | GitHub Action that builds the data ZIP (backlog, §12). |
| Hosting | Vercel, static. **No serverless functions.** |
| Framework | **Vite + Svelte 5 + TypeScript**, MapLibre GL JS, `pmtiles`. |
| Where routing runs | In the browser (Web Worker) in **both** builds. |
| gpx.studio | Only in the desktop build (decided by the build, not by device type). |
| Google Maps short links | Desktop build only. Full Google Maps links and coordinates work everywhere. |
| Online / offline | A setting with two modes (see §6). |
| Location | Position when the app is open. No background tracking. Compass heading included. |
| GPX on the phone | Not stored as a file. Shared with the iOS share sheet (`navigator.share`). |

## 2. Target repository layout

```
resorts.json                 resort definitions (unchanged)
package.json                 one package; scripts for both builds
packages/
  core/                      shared logic, TypeScript, no DOM and no Node APIs
    src/geo.ts                 haversine, bbox helpers         (from scripts/lib/geo.mjs)
    src/ski.ts                 lift/run classes, colours       (from scripts/lib/ski.mjs, piste.mjs, slope.mjs)
    src/styles/                map style builders              (from scripts/lib/styles.mjs)
    src/routing/graph.ts       SkiNetwork, Dijkstra, options   (from planner/graph.mjs)
    src/gpx.ts                 GPX export                      (from planner/graph.mjs toGpx)
    src/search.ts              local search index + query      (from planner/search.mjs, offline part)
    src/geoparse.ts            coordinates + Google Maps URLs  (from planner/public/geoparse.js)
    src/feature-info.ts        info card details               (from planner/feature-info.mjs)
    src/ski-areas.ts           ski-area outlines               (from planner/ski-areas.mjs)
    test/                      node:test unit tests + golden route tests
app/                         Vite + Svelte 5 frontend (both builds)
  index.html
  vite.config.ts             vite-plugin-pwa only for the PWA target
  public/                    icons, apple-touch-icon, manifest assets
  src/
    main.ts
    lib/
      platform/                build target + capabilities (pwa | desktop)
      data/                    DataSource interface
        local.ts                 PWA: files in OPFS (imported ZIP)
        server.ts                desktop: files over HTTP from the Node server
        import/                  ZIP reader + import worker (writes to OPFS)
      worker/                  routing worker (core: graph, search, feature-info)
      map/                     MapLibre setup, pmtiles protocol, styles, layers, location, compass
      stores/                  Svelte stores: settings, route points, undo/redo, display, mode
      routes/                  saved routes (IndexedDB; project folder on desktop)
      share/                   GPX share / download
    ui/                        Svelte components (glass bar, sheets, cards, charts, settings)
server/                      desktop backend (Node, no framework)
  server.mjs                   serves app/dist, build/ data files (with Range support),
                               /api/capabilities, /api/routes* (project folder), /api/resolve
  routes-store.mjs             (from planner/routes-store.mjs)
scripts/
  build.mjs                    data build (unchanged role: downloads + tiles + planner data)
  build-pwa-data.mjs           packs the data ZIP for the phone (§5)
  start.mjs                    desktop: tile server + desktop server
docs/
  pwa-plan.md                  this file
  backlog.md                   later work (GitHub Action, …)
```

The current `planner/` folder stays working until the new app reaches feature parity (end of phase 4). After that it is removed.

### npm scripts (target)

| Script | What it does |
| --- | --- |
| `npm run build` | Data build, as today (needs tippecanoe, pmtiles, GDAL). Accepts a zoom level, e.g. `npm run build z12` (see §5.1). |
| `npm run build:pwa-data` | Packs `build/` into `build/pwa/openskimap-data-<date>-z<zoom>.zip` for import on the phone. Also accepts a zoom level: `npm run build:pwa-data z13` builds the data first if needed. |
| `npm run build:app` | Builds the PWA into `app/dist` (this is what Vercel runs). |
| `npm run build:desktop` | Builds the app for the desktop target. |
| `npm start` | Desktop: TileServer GL + desktop server with the desktop app. |
| `npm run dev:desktop` | Development of the desktop version: Vite dev server (hot reload) + desktop server + TileServer GL. See §2.1. |
| `npm run dev:pwa` | Development of the PWA: Vite dev server with the PWA target, data from the browser's storage. See §2.1. |
| `npm run dev:pwa -- --phone` | Same, but reachable from your iPhone on the local network over HTTPS. |
| `npm run preview:pwa` | Builds the real PWA and serves it locally, with service worker, to test install and offline. |
| `npm test` | Unit tests of `packages/core` + app tests. |

### 2.1 Development workflow

You can run both versions while developing and give feedback on them. Both use Vite with hot reload: a code change shows up in the browser at once, without losing the map position.

**`npm run dev:desktop`** opens the desktop version on <http://localhost:5173>. It starts three things:
- the Vite dev server for the frontend,
- the desktop server, which serves the data from `build/` and the desktop API,
- TileServer GL, for the gpx.studio links.

It behaves like `npm start`, but with hot reload and source maps for debugging.

**`npm run dev:pwa`** opens the PWA version on <http://localhost:5174>. It runs the Vite dev server with `VITE_TARGET=pwa`, with no desktop server and no tile server, exactly like on Vercel. The data comes from the browser's storage, just like on the iPhone.

- **Getting data in:** use the real import flow with the ZIP from `npm run build:pwa-data`. Chrome and Safari on the Mac support the same storage (OPFS).
- **Quick option for development only:** a button *Load data from build/*. The dev server offers the latest ZIP from `build/pwa/`, and the app imports it through the same import code as on the phone. So you don't need to pick a file each time, and the import itself still gets tested.
- **Service worker:** it is off in `dev:pwa`, because it gets in the way of hot reload. Install and offline behaviour are tested with `npm run preview:pwa`.
- **Development overlay:** a small panel, only in dev builds, that can:
  - show simulated iPhone safe areas (notch, home indicator), because desktop browsers don't have them,
  - switch between online and offline mode,
  - set a fake GPS position and compass heading on the map (for example "stand at the top of the Kanzelwandbahn").

**Three ways to look at the PWA, from quick to most realistic:**

| How | Good for | Limits |
| --- | --- | --- |
| **Chrome DevTools device mode** (iPhone size, touch, location override) on `dev:pwa` | Fast layout and touch work: sheets, bar, chart scrubbing | Chrome engine, not Safari. Safe areas only through the dev overlay. |
| **Xcode iOS Simulator** (Safari on a simulated iPhone, Mac only) on `dev:pwa` or `preview:pwa` | Real iOS Safari: safe areas, add to home screen, standalone mode, simulated GPS position | Free with Xcode. No real compass or GPS, and performance differs from a real phone. |
| **Your iPhone** on `npm run dev:pwa -- --phone` or a Vercel preview | Everything real: GPS, compass, smoothness, share sheet | Location, storage and service workers need HTTPS (see below). |

**HTTPS for the iPhone during development.** Location, storage and the service worker only work on HTTPS, or on `localhost`, which the phone can't use for your Mac. There are two options:
- `--phone` starts Vite on your local network with a certificate made by **mkcert**. You install mkcert's root certificate on the iPhone once (a profile in Settings). After that the phone trusts `https://<your-mac>.local:5174`.
- Simpler, but not live: push the branch. Vercel makes a **preview deployment** for every push, with its own HTTPS link that you can open and install on the phone.

The plan supports both. The README will explain the one-time mkcert setup.

## 3. Architecture

### 3.1 One frontend, two data sources

The app only talks to a `DataSource` interface:

```ts
interface DataSource {
  listResorts(): Promise<ResortInfo[]>;
  plannerData(resortId: string): Promise<ArrayBuffer | ResortData>; // runs, lifts, places, precomputed index
  pmtilesSource(name: 'ski' | 'basemap' | 'terrain' | 'contours'): pmtiles.Source | null;
  glyphsUrl(): string;   // fonts
  spriteUrl(): string;   // icons
}
```

- **`LocalDataSource` (PWA):** reads from OPFS (Origin Private File System). Map files are opened with `pmtiles.FileSource(file)`, which reads byte ranges straight from the stored file. Nothing big is loaded into memory. Fonts and sprites come from OPFS through a small `addProtocol` handler.
- **`ServerDataSource` (desktop):** the same files over HTTP from the desktop server (PMTiles with Range requests).

The map style is built **in the browser** by the shared style builder (`packages/core/src/styles`). That is the same code TileServer GL uses for its styles today. It points the sources at `pmtiles://…` in both builds. So the map looks the same everywhere, and the desktop map no longer depends on TileServer GL. TileServer GL is only needed for the gpx.studio image tiles.

### 3.2 Routing worker

A Web Worker loads the resort data once, builds the `SkiNetwork` and the search index, and answers:

- `route(points, options)` → result + GPX
- `search(query)` → local hits
- `feature(id)` → info card details
- `skiAreas()` → outlines (precomputed in the data build if possible)
- `nearest(point)` → nearest run/lift/station, for "start from my location"

Communication uses a small typed request/response wrapper over `postMessage`. Rebuilding the network after an app restart should take well under a second. This is measured in phase 3. If it is too slow, the build step precomputes the graph.

### 3.3 Build target and capabilities

`import.meta.env.VITE_TARGET` is `pwa` or `desktop`. On desktop the app also asks `/api/capabilities` (tile server URL for gpx.studio, project-folder routes on/off). The UI shows features based on these capabilities, never on device sniffing:

| Feature | PWA | Desktop |
| --- | --- | --- |
| gpx.studio links | – | ✓ |
| Routes in the project folder | – | ✓ (if enabled) |
| Google Maps short links | – | ✓ |
| Import data ZIP / storage screen | ✓ | – (data comes from `build/`) |
| Installable PWA + offline cache | ✓ | – |

## 4. What moves where (from today's code)

| Today | New place | Notes |
| --- | --- | --- |
| `planner/graph.mjs` | `packages/core/routing` | Port to TS without changing behaviour. Golden tests compare routes with the old code. |
| `planner/search.mjs` (index + local search) | `packages/core/search.ts` | Nominatim `geocode` becomes a browser call (online mode only). `resolveGoogleLink` stays on the desktop server. |
| `planner/feature-info.mjs`, `ski-areas.mjs` | `packages/core` | `concaveman` works in the browser. Ski areas precomputed in the data build if possible. |
| `planner/public/geoparse.js`, `zip.js`, `route-stores.js` | `packages/core` / `app/src/lib/routes` | |
| `planner/public/app.js` (3,000 lines) | Svelte components + stores | Rewritten per feature, not copied 1:1. |
| `planner/server.mjs` | `server/server.mjs` | Only file serving, capabilities, project-folder routes, short links. |
| `scripts/lib/styles.mjs` | `packages/core/styles` | Used by the data build (TileServer GL styles) and by the app. |

## 5. Data ZIP for the phone (`npm run build:pwa-data`)

Input: the output of `npm run build`. Output: `build/pwa/openskimap-data-YYYY-MM-DD.zip`.

```
manifest.json            format version, build date, OpenSkiData date, resorts, file list with size + SHA-256
planner/resorts.json
planner/<resort>.json    runs, lifts, places (+ precomputed search index and ski areas)
tiles/ski.pmtiles
tiles/basemap.pmtiles
tiles/terrain.pmtiles
tiles/contours.pmtiles
fonts/<stack>/<range>.pbf   only the ranges needed (Latin + common symbols), not all 256 per font
sprites/light*.json|png
```

- The ZIP uses **no compression** ("stored"). PMTiles are already compressed inside. Because of this, the import can copy each file straight from the picked file to OPFS in chunks, without unpacking in memory. That matters on the iPhone with files of 100+ MB.
- **Import flow on the phone:**
  1. Settings → Data → *Import data file*.
  2. Pick the ZIP from Files (iCloud Drive, AirDrop download, …).
  3. A worker checks `manifest.json`, copies the files to a temporary OPFS folder with a progress bar, and checks sizes and hashes.
  4. Then it swaps the new data in for the old in one step, so a failed import never breaks the existing data.
- **Storage screen:** installed resorts, build date, space used, free quota (`navigator.storage.estimate()`), delete.
- `navigator.storage.persist()` is requested after the first import. Its result is shown on the storage screen.
- Size: `terrainMaxZoom` has the biggest effect. The build prints the ZIP size per file, so you can decide on zoom 13 or 14 for the terrain.

### 5.1 Zoom level per build

Today the zoom levels are fixed in `resorts.json` (`terrainMaxZoom`, `basemapMaxZoom`, `skiMaxZoom`). You can now also set them per build on the command line, to try out sharpness against file size. `resorts.json` stays the default.

**Short form:** `npm run build z<N>` or `npm run build:pwa-data z<N>`, for example:

```sh
npm run build z12          # small: terrain and basemap up to zoom 12
npm run build z15          # sharper hillshading and basemap detail
npm run build:pwa-data z13 # build the data at zoom 13 and pack the ZIP
```

`z<N>` sets the **maximum level of detail of the map pictures**:

| Data | Effect of `z<N>` | Why |
| --- | --- | --- |
| Terrain (hillshading, 3D, contours) | max zoom = N (1–18) | This drives both the sharpness and most of the size: every extra level is about 4× more terrain tiles. |
| Basemap (roads, forest, labels) | max zoom = min(N, 15) | Protomaps has no data above 15. Above that the map is zoomed in from 15 ("overzoomed"), which looks fine. |
| Ski runs and lifts | unchanged (16) | Small files. Lower zooms would make the run and lift lines visibly coarse when you zoom in. |

You can still zoom the map in further than N. The app then enlarges the last level, so the hillshading just gets softer.

**Long form**, to set each one separately: `npm run build -- --terrain-zoom=16 --basemap-zoom=14 --ski-zoom=16`. These override `z<N>`, and `z<N>` overrides `resorts.json`.

**Practical details:**
- Before downloading, the build shows an estimate of the number of terrain tiles and the size. Above zoom 16 it asks for confirmation (skip it with `--yes`), because zoom 17–18 can mean several GB.
- High-resolution terrain above zoom 12 only exists in some regions; the Alps are covered. Where it is missing, the build says so and uses the highest available level.
- Extracts are kept per zoom level in `build/work/`. Switching back to a zoom you built before reuses the stored files instead of downloading again.
- The ZIP file name contains the zoom (`…-z13.zip`) and `manifest.json` records all three zoom levels. The app's storage screen shows them, so you can see which version is on the phone.
- The desktop build simply uses whatever was built last.

## 6. Online and offline mode

A switch in Settings (also visible as a small status in the glass bar). Default: **offline** in the PWA, **online** on desktop.

| | Offline | Online (adds) |
| --- | --- | --- |
| Map | Protomaps ski map from the imported data, 3D terrain from imported terrain | OpenSnowMap map; OpenFreeMap + OpenSkiData pistes (pistes from local data); Mapterhorn online terrain as fallback |
| Search | Local names, coordinates, full Google Maps links | "Search online" (Nominatim). Short links: desktop only |
| Routing, info cards, saved routes, location | ✓ | ✓ |

If the phone has no network while in online mode, the app shows a hint and falls back to the offline map. The app itself (HTML/JS/CSS) is always cached by the service worker, so it starts without network in both modes.

## 7. iPhone features

| Feature | How | Notes |
| --- | --- | --- |
| **My location** | `navigator.geolocation.watchPosition` while the app is visible; stops on `visibilitychange` hidden. Blue dot + accuracy circle (own MapLibre layer, so it matches the design). | Works offline (GPS). iOS may ask for permission again from time to time; the app handles "denied" with a clear message. |
| **Start from my location** | Button: snaps the position to the nearest run/lift/station (worker `nearest`) and sets it as point A. | The main use case: standing still, plan the next route. |
| **Compass heading** | `DeviceOrientationEvent.requestPermission()` on a tap, then `webkitCompassHeading`. Cone on the blue dot; optional "map follows heading". | Permission must be asked from a direct tap. |
| **Follow / centre** | Locate button: centre once → follow → follow with heading (like Apple Maps). | |
| **Screen on** | Optional Screen Wake Lock while planning. | Test on device (support in home screen apps depends on iOS version). |
| **GPX sharing** | `navigator.share({ files: [gpxFile] })` → Save to Files, AirDrop, … ; fallback to a normal download on desktop. Same for the route backup JSON. | |
| **Smooth map** | MapLibre (WebGL) with pinch-zoom, rotate, two-finger tilt. Limited number of glass elements over the map (§8). `touch-action` set so iOS doesn't zoom the page. | Measure on a real iPhone. |

Not in scope: background tracking, push notifications, turn-by-turn navigation.

## 8. Design: Liquid Glass, mobile first

Real Liquid Glass (with light refraction) only exists in native iOS 26 apps. On the web we copy its **structure and feel** with CSS. The refraction effect is left out on purpose: Safari doesn't render SVG filters in `backdrop-filter` (WebKit bugs 245510, 313914).

### 8.1 Principles we follow (from Apple's HIG / WWDC25)

- **Two layers.** The map is the content. Glass is used **only** for the navigation layer floating on top: bottom bar, sheet, map control groups. No glass on glass, no glass inside content (cards, lists, charts use solid surfaces).
- **Floating bottom bar.** A centred capsule with round buttons inside, floating above the home indicator, not full width. It shrinks (icons only, smaller) when the sheet is pulled up or while the map is being moved.
- **Sheets.** Bottom sheet inset from the screen edges, with detents (small ≈ summary, medium ≈ half, large ≈ full). At full height it attaches to the edges and becomes solid.
- **Concentric shapes.** Capsules have radius = half their height. Inner radius = outer radius − padding, so buttons sit neatly inside the bar and the sheet follows the screen corners.
- **Touch targets** of at least 44 × 44 pt. Icons can be smaller as long as the hit area is 44.
- **Tint only for the main action** (e.g. *Plan route* / *Start from my location*), using the app's accent colour. Run colours stay the official piste colours.
- **System font:** `system-ui, -apple-system, "SF Pro Text", sans-serif`.

### 8.2 Bottom bar (iPhone)

```
 ╭──────────────────────────────────────────╮
 │  (🔍)   (✏️ Plan)   (📍)   (⛰ Layers)  (⚙) │   ← one glass capsule, round buttons
 ╰──────────────────────────────────────────╯
```

Search · plan mode · my location (tap: centre, again: follow, again: follow with compass) · map layers sheet · settings. The exact set is decided in phase 4 with the screens. Undo/redo, 3D and the compass reset sit in a small glass group on the map, top right.

### 8.3 Sheets

| Sheet | Small | Medium | Large |
| --- | --- | --- | --- |
| **Route** | Total time, distance, lifts, descent; Share GPX | Directions per leg + gradient profile | Settings for this route, save |
| **Info card** (tap on run/lift/place) | Name, type, key numbers, *use as start/destination/stop* | Full stats + profile | – |
| **Search** | Search field + results (keyboard open) | | |
| **Layers / Settings / Data** | | Map options, online/offline switch, import, storage | |

Drag rules: below the top detent every drag moves the sheet. At the top detent the content scrolls, and a downward drag at scroll position 0 moves the sheet again. The map gets `padding` equal to the sheet height, so the route is never hidden behind it. Own Svelte implementation with pointer events (no React libraries).

### 8.4 Desktop layout (≥ 900 px wide)

The same components, arranged like Apple Maps on Mac: the sheet becomes a **floating panel on the left** (glass header, solid content), the bottom bar becomes a toolbar at the top of the panel, keyboard shortcuts and hover stay. gpx.studio links appear in Settings (desktop build only).

### 8.5 Glass recipe and performance

- One CSS component `Glass`: `backdrop-filter: blur(20px) saturate(170%)` (+ `-webkit-` prefix), a translucent fill (light and dark variant), a 1 px light top highlight and a soft shadow.
- **At most 3–5 blurred surfaces at once**, because each blur over the moving WebGL map is redrawn every frame. Buttons share the blur of their group instead of each having their own.
- Never animate the blur radius. Animations only use `transform` and `opacity`.
- If the profiling on the iPhone shows dropped frames while panning, the bar switches to a more opaque fill without blur during map movement.
- **Accessibility:** Safari doesn't support `prefers-reduced-transparency`, so there is an in-app **"Solid interface"** switch. `prefers-contrast: more` gives solid borders and darker fills. `prefers-reduced-motion` turns off sheet springs and map fly animations. Dark mode follows the system.

### 8.6 iOS layout details

- `viewport-fit=cover`, `apple-mobile-web-app-status-bar-style: black-translucent`; the map runs under the status bar, and the UI respects `env(safe-area-inset-*)`.
- Full-screen layout with `position: fixed; inset: 0` (avoids `vh`/`svh` differences in standalone mode).
- `touch-action` on the map and controls, `overscroll-behavior: none`, no text selection or long-press callout on UI chrome, no double-tap page zoom.
- iOS 26 ignores `theme-color` and samples the page background instead, so the html background is set on purpose.
- Several iOS 26.x safe-area bugs have been reported (inset reading 0, viewport shifting after the keyboard closes). They are tested on your iPhone in phase 7.

## 9. Interaction changes (mouse → touch)

| Today (desktop) | New (touch first, mouse still works) |
| --- | --- |
| Hover a run/lift to highlight | Tap highlights and opens the info card in a bottom sheet. Hover stays on devices with a mouse (`(hover: hover)` media query). |
| Hover the elevation/gradient chart | Drag a finger along the chart (pointer events). The value tooltip follows the finger, and a marker moves on the map. |
| Click map in plan mode adds a point | Tap adds a point in plan mode. Long-press adds a point in explore mode. Drag markers with a finger (bigger hit area). |
| Side panel with sections | Bottom sheet with detents (small: route summary · medium: directions · large: everything). On desktop a side panel. |
| Keyboard shortcuts | Kept on desktop. On the phone: undo/redo buttons. |
| Layers button | Glass button → sheet with map options. |
| Right-drag to tilt | Two-finger drag (MapLibre default) + 3D button. |

## 10. Phases

Each phase ends with a check (tests, build, screenshots in iPhone and desktop size) and a commit on `iphone-pwa`. You review after phases 3, 5 and 7.

| # | Phase | Result |
| --- | --- | --- |
| 1 | **Shared core** | `packages/core` in TypeScript, unit tests, golden route tests against the old `graph.mjs`. Old planner still works, using the core. |
| 2 | **Data ZIP + zoom levels** | `npm run build:pwa-data`, manifest, limited font ranges, precomputed search index/ski areas. Zoom per build (`z<N>` and long flags), size estimate, cache per zoom. Size report. |
| 3 | **App skeleton** | Vite + Svelte + TS, map from PMTiles via `DataSource` (desktop server + local), routing worker, a basic route on screen. Desktop server replaces `planner/server.mjs`. `dev:desktop` and `dev:pwa` work (incl. *Load data from build/* and the dev overlay). Worker start time measured. |
| 4 | **Feature parity** | Route points, directions per leg, gradient profile, info cards, search, saved routes, settings (runs, lifts, speed, map), undo/redo, ski areas, 3D, online maps, gpx.studio (desktop). Old `planner/` removed. |
| 5 | **PWA + import** | Manifest, icons, service worker (vite-plugin-pwa), import flow, storage screen, `persist()`, offline/online switch. Vercel config. `preview:pwa` and `dev:pwa -- --phone` (mkcert). |
| 6 | **iPhone features** | Location, start from my location, compass, follow modes, wake lock, GPX share. |
| 7 | **Liquid Glass UI + responsive** | Final design, desktop layout, accessibility (reduce transparency/motion), performance pass. |
| 8 | **Docs** | README for both builds, Vercel setup, how to move the ZIP to the iPhone. |

Phases 6 and 7 can partly overlap with 4: components are built in the new design from the start; phase 7 is the polish.

## 11. Testing and risks

**Testing**
- `packages/core`: `node:test`, including golden tests (same points → same route as the old code).
- App: Playwright smoke tests in iPhone and desktop viewports (Chromium in this environment). WebKit/iOS-specific behaviour (OPFS, compass, location prompts, share sheet, home screen) **can only be checked on your iPhone**. Each phase that touches these lists what to test.
- Real data: the cloud environment can install tippecanoe and GDAL (apt) and the pmtiles CLI. So the sub-agents can run `npm run build` for the Oberstdorf region to test with real data.

**Risks**

| Risk | Mitigation |
| --- | --- |
| Large ZIP on the phone (terrain) | Size report; lower `terrainMaxZoom`; uncompressed ZIP copied in chunks. |
| OPFS writing on iOS Safari | Write in a worker with `createSyncAccessHandle` (supported since iOS 16.4/17). Verify early in phase 5 with a test page on the iPhone. |
| iOS deletes stored data | `persist()`; storage screen shows status; the ZIP can always be imported again; route backup export. |
| Liquid Glass blur over the WebGL map costs performance | Few glass elements, no animated blur, solid fallback with "Reduce Transparency". |
| Location permission asked again by iOS | Clear UI states; the app keeps working without location. |
| Porting 3,000 lines of UI | Feature checklist from the current README; parity checked before deleting `planner/`. |
| Node version | `package.json` wants Node ≥ 24 (for TileServer GL). The app and core do not depend on it; Vercel builds with its default Node. |

## 12. Backlog (not in this project)

- **GitHub Action that builds the data ZIP:** installs tippecanoe, pmtiles and GDAL, runs `npm run build` + `npm run build:pwa-data`, and attaches the ZIP to a GitHub Release (or as a workflow artifact). Runs on demand and on a schedule. Respect the OpenSkiData rule of at most one download per day. You then download the ZIP on the phone and import it. A hosted download inside the app is **not** planned.
- Turn-by-turn "next step" while skiing along a planned route.
- More resorts in the ZIP / one ZIP per resort.
