# OpenSkiMap local: tile server + beginner ski route planner

A fully local setup built from [OpenSkiData](https://openskidata.org):

1. **Tile server** ([TileServer GL](https://tileserver.readthedocs.io)) that renders
   - `ski-basemap`: a complete JPG ski map (hillshade, contours, OSM roads/forest/labels, runs and lifts)
   - `ski-overlay`: a transparent PNG with only runs and lifts

   Both can be used as custom layers in [gpx.studio](https://gpx.studio).
2. **Route planner** (web app for the desktop and the iPhone): tap or click start and destination, get a
   beginner-friendly route over runs and lifts with step-by-step directions, and share or download it as GPX for
   gpx.studio.

Everything works offline after the build. Internet is only needed by `npm run build`, and by the optional online
maps and online search of the planner (*online mode*).

## Requirements

| Tool | Install | Used for |
| --- | --- | --- |
| Node.js ≥ 24 (26 tested) | `brew install node` | everything |
| tippecanoe | `brew install tippecanoe` | building vector tiles |
| pmtiles | `brew install pmtiles` | extracting basemap/terrain for your resorts |
| GDAL | `brew install gdal` | contour lines |

> **Node 26:** TileServer GL 5.7.0 officially supports Node 20/22/24. Its native renderer
> (`@maplibre/maplibre-gl-native`) only ships Node 26 binaries in pre-release `6.5.0-pre.1`, which
> `package.json` pins through `overrides`. If rendering ever breaks after an update, remove the override and run
> the tile server with Node 24 LTS (`brew install node@24`).

## Quick start

```sh
npm install
npm run build     # ~1 minute: filter ski data, download extracts, build tiles + planner data
npm start         # tile server on :8080 and planner on :8081 (builds the app the first time)
```

- Planner: <http://localhost:8081>
- Tile server overview: <http://localhost:8080> (only needed for the gpx.studio links)

The planner is one app with two builds (see `docs/pwa-plan.md`): the **desktop build** that `npm start` serves, and
the **PWA build** for the iPhone, which keeps the map data in the browser storage. For development:

- `npm run dev:desktop`: desktop version with hot reload on <http://localhost:5173> (also starts the desktop server
  and the tile server).
- `npm run dev:pwa`: iPhone (PWA) version on <http://localhost:5174>, data from the browser storage. Import the ZIP
  from `npm run build:pwa-data`, or press *Load data from build/*. No service worker here (it would get in the way
  of hot reload).
- `npm run dev:pwa -- --phone`: the same over HTTPS on your Wi-Fi, so you can open it on the iPhone (see below).
- `npm run preview:pwa`: builds the real PWA and serves it on <http://localhost:4174> **with** the service worker, to
  test install, offline start and the update prompt. `npm run preview:pwa -- --phone` does this over HTTPS on the Wi-Fi.
- `npm run build:desktop` / `npm run build:pwa`: production builds (`app/dist-desktop`, `app/dist`). Only the PWA
  build has a service worker and a web app manifest.
- `npm run icons`: makes all app icons (home screen, manifest, favicon) from `app/public/logo.svg`.

### Testing on the iPhone from your Mac (`--phone`)

The iPhone needs HTTPS for storage, location and the service worker. `--phone` uses a certificate from
[mkcert](https://github.com/FiloSottile/mkcert):

1. Once on the Mac: `brew install mkcert` and `mkcert -install`.
2. `npm run dev:pwa -- --phone`. It prints the addresses to open on the iPhone (same Wi-Fi), e.g.
   `https://your-mac.local:5174/`, and where mkcert's `rootCA.pem` is.
3. Once on the iPhone: AirDrop `rootCA.pem` to the iPhone, install the profile (Settings › General › VPN & Device
   Management), then turn on full trust for it (Settings › General › About › Certificate Trust Settings).

The certificate is kept in `build/certs/` and made again when your Mac's addresses change.

### Hosting the iPhone app on Vercel

`vercel.json` has everything: Vercel runs `npm run build:pwa` and publishes `app/dist` as a static site (no
serverless functions). `sw.js`, `index.html` and the manifest are never cached by the browser, so updates arrive;
the files in `assets/` have a hash in their name and are cached for a year. Every push gets a preview link with
HTTPS that you can open and add to the Home Screen.

## Using the tiles in gpx.studio

In gpx.studio open **Map layers (⚙) → Custom layers**, paste one URL, set **max zoom** (18–20 is fine,
the server renders any zoom) and choose basemap or overlay:

| Layer | URL | Type |
| --- | --- | --- |
| Full ski map (JPG) | `http://localhost:8080/styles/ski-basemap/{z}/{x}/{y}@2x.jpg` | Basemap |
| Runs & lifts only (PNG) | `http://localhost:8080/styles/ski-overlay/{z}/{x}/{y}@2x.png` | Overlay |
| Full ski map, runs coloured by steepness (JPG) | `http://localhost:8080/styles/ski-basemap-steepness/{z}/{x}/{y}@2x.jpg` | Basemap |
| Runs by steepness & lifts only (PNG) | `http://localhost:8080/styles/ski-overlay-steepness/{z}/{x}/{y}@2x.png` | Overlay |

The *steepness* styles colour every ~50 m slice of a downhill run by its measured gradient instead of the official
difficulty: green < 10%, blue 10–25%, red 25–40%, black > 40% (approximate European piste guidelines).

Notes:

- `@2x` gives sharp 512 px tiles on retina screens. Remove it (or use `@3x`) as you like.
  `.webp` and `.png` work for both styles too.
- JPG has no transparency. Use the JPG as a **basemap**, and the PNG for an overlay on top of gpx.studio's own maps.
- gpx.studio runs on HTTPS and loads tiles from `http://localhost`. Chrome and Firefox allow this; Safari
  may block it as mixed content.
- Outside your resort areas the basemap is empty (only the resorts are extracted).

Lifts carry direction arrows from zoom 13: **›** points towards the top station, **‹ ›** marks lifts you can ride
both ways. "Both ways" comes from OpenStreetMap (`oneway=no`) or from the lift type (cable cars, funiculars and
railways shuttle up and down). Drag lifts and `oneway=yes` lifts are up only. For gondolas and chairlifts without
that information the arrow points up, and the info card says riding down is not specified in the data.

The tile server also serves the vector style (`/styles/ski-basemap/style.json`) if you prefer a vector custom layer.

## Route planner

The screen is the map. On the iPhone (and in narrow windows) the controls float on the map: the **menu** (≡) top
left, **undo/redo** and **3D** top right, **Plan route** and **my location** above the tab bar, and at the bottom the
tab bar **Route · Saved · Map** with a round **search** button next to it. Each tab opens a sheet: drag it up for more,
down to close. On a desktop window (900 px and wider) the same contents are in a panel on the left (search field,
menu button and the tabs at the top), and the map toolbar has *Plan route*, undo/redo and 3D. The **panel** button
hides the panel.

The map has two modes, switched with the **✏️ Plan route** button or the **P** key:

- **Explore** (default): tap or click a run, lift, lift station or place for its info card. With a mouse, hovering
  highlights what a click would open. Taps never add route points by accident.
- **Plan route**: every tap adds a route point, even right on top of a run or lift. Press **P** or **Esc**, or ✕ in the
  "Tap the map to add points" pill, to go back to exploring.

Search results and info cards can add points in both modes.

In plan mode, tap to set the start, then the destination. More taps add stops along the way. Points are lettered
A, B, C… in route order (green start, blue stops, red destination):

- **Drag** a marker to move it (on the iPhone it lifts above your finger).
- **Click** a marker with the mouse to remove it. On the iPhone a tap on a marker shows it in the Route sheet; remove
  it there with ⓧ. The remaining points are re-lettered, so if you remove A, B becomes the new A.

The route updates immediately. The **Route** tab shows the time, distance and descent, the points (Reverse, Clear),
warnings, the gradient profile and the directions per leg (**A → B**, **B → C**, …), each with its own time,
distance, lifts and descent. Tap a leg header to collapse it; hover it (mouse) to highlight that part on the map, or
press ⤢ to zoom to it.

The **gradient profile** shows the elevation along the whole route, with the route points (A, B, C…) marked. Switch
its colours between **Official** (the piste difficulty of each run) and **Steepness** (the measured gradient of every
~30–50 m slice: green < 10%, blue 10–25%, red 25–40%, black > 40%). Lifts are purple, paths and walking parts grey.
Drag a finger along the chart (or hover it with the mouse) to see the distance, elevation, gradient and run at that
point, with a marker on the map.

**Share GPX** (the share button in the Route header) opens the share sheet on the iPhone and downloads the file on
the desktop. The GPX has a track (with elevation), a waypoint per route point (A, B, C…) and a waypoint for every lift
and run, named per leg (e.g. `B→C 2. Take lift: 28 Zweiländerbahn`). Open it in gpx.studio with *File → Open*.

**Route settings** (the last row of the Route tab) has the runs you are allowed to ski, *Prefer easier runs*, *Use
ski paths*, what happens when no route is found, the lift types, *Avoid drag lifts*, *Ride lifts down*, the waiting
time per lift, your speed and the maximum walk between runs and lifts (see below).

### Saved routes

The **Saved** tab saves the current route with a **name** and a **folder** (pick an existing one or type a new name;
default *My routes*). Saved routes are listed by folder:

- **Tap a route** to open it again. The resort, the points and the settings it was planned with all come back,
  so you get exactly the same route (undo works).
- After changes, **Save changes** updates it, **Save as new route** keeps the old one and makes a copy. The Route tab
  shows *Changed since you saved it* when there are unsaved changes.
- **Delete** a route by swiping it to the left (iPhone), with **Edit**, or with the delete button (mouse). The toast
  offers **Undo**. **Share folder (ZIP)** shares or downloads one ZIP file with a GPX file for every route in a folder.

**Where routes are saved** (desktop build: switch at the top of the Saved tab):

| Place | How | Good to know |
| --- | --- | --- |
| **This device** (default) | IndexedDB in the browser | Lost when you clear the browser data, so use **Settings › Routes backup › Export backup** / **Import backup** (one JSON file with all routes) to keep a copy or move routes to another device. |
| **Project folder** (desktop build) | JSON files in `saved-routes/` on the desktop server | Only for local use; shared by all browsers on your computer. **Settings › Routes backup › Copy all to this browser** copies them into browser storage. `saved-routes/` is in `.gitignore`. |

Each saved route also keeps the GPX made when saving, so it stays downloadable after the map data is updated.

**Turning the project folder off:** start the desktop server with `PLANNER_SERVER_ROUTES=0` (for example
`PLANNER_SERVER_ROUTES=0 npm run server`). The *Project folder* option then disappears and the `/api/routes`
endpoints are turned off.

### Info cards

In explore mode, tap (or click) a run, lift, lift station, hut, peak or village. It is highlighted on the map and its
info card opens: on the iPhone in a sheet (drag it up for all details), on the desktop as a card at the top right of
the map.

- **Lifts:** type and seats (e.g. *Chairlift · 6 seats*), length, rise and ride time, and in the details direction,
  length along the cable, vertical, speed, vertical speed, average slope, capacity, bubble/heating, and an elevation
  profile.
- **Runs:** difficulty, length, descent and steepest section, and in the details vertical, average slope, grooming,
  one-way/lit/snowmaking/gladed/patrolled, a note when the steepest section does not match the official colour, and an
  elevation profile where every slice is coloured by its steepness (green < 10%, blue 10–25%, red 25–40%,
  black > 40%). Drag along the profile (or hover it) to read the elevation, distance and slope of each slice.
- **Lift stations:** which lift, bottom/top/middle station, boarding/exit, plus the lift's numbers.
- **Places** (huts, peaks, villages, …): type and elevation.
- Country › region › ski area, and links to the OpenStreetMap source, website and Wikidata where available.
- **Use this spot in your route:** buttons to use the tapped spot as **start / destination / stop**.

A tap on empty map closes an open card.

### Search

Tap the round **search** button next to the tab bar (iPhone) or use the search field at the top of the panel
(desktop, **⌘K** / **Ctrl+K**; ↑/↓ and Enter pick a result). Picking a result drops an **orange pin** and opens its
card with the *Use this spot in your route* buttons.

| You type | Result |
| --- | --- |
| A name: `Walsergund`, `Kanzelwandbahn`, `Riezlern`, `Hotel …`, a peak or hut | Offline search over runs (pin at the top), lifts (pin at the bottom station), ski areas, villages, peaks, huts, restaurants, hotels, bus stops, parking, … |
| Coordinates: `47.3481, 10.2160`, `47°20'53.4"N 10°12'57.7"E`, `N 47° 20.890' E 010° 12.962'`, `geo:47.3,10.2` | Pin at exactly that position (lat/lon order, hemispheres N/S/E/W/O supported) |
| A Google Maps link: `https://www.google.com/maps/place/…`, `…?q=47.3,10.2` | Exact position read from the link |
| A Google Maps short link: `https://maps.app.goo.gl/…` | Desktop build only: the desktop server follows the link (needs internet) and reads the position. The iPhone app explains that you need the long link. |
| *Search online for "…"* (last result row, online mode only) | Looks the text up in OpenStreetMap Nominatim (needs internet, only when you pick it) |

Some shared short links (typically from the mobile app) only contain an address, not coordinates. In that case the
address is looked up in OpenStreetMap and the pin is marked **approximate**.

### Settings (≡ menu)

| Page | What you set |
| --- | --- |
| **Resort** | The resort to show (all resorts of the built data). |
| **Online mode** | Off: everything works without internet. On: adds the online maps and online search. Default: off in the iPhone app, on in the desktop build. Saved. |
| **Data** (iPhone app) | The installed data (resorts, build date, zoom levels), the size of each part, the storage used and available, **Keep data** (whether the browser promised to keep the data), **Import new data file…** and **Delete data**. |
| **Routes backup** | Export backup, Import backup…, and (desktop with project folder) Copy all to this browser. |
| **Appearance** | **Solid interface**: buttons and panels without the see-through effect (easier to read). Saved. |
| **gpx.studio** (desktop build) | The tile links for gpx.studio, each with a *Copy* button. |
| **About & credits** | Version, data sources and licences. The small credit line on the map opens it too. |

### Map

The **Map** tab has everything about what you see:

- **Show:** ski runs, lifts, cross-country trails, and touring & sled routes (incl. winter hiking). Hidden types
  also disappear from the labels and can't be tapped.
- **Run colours:** *Official difficulty* (the piste colour from OpenStreetMap) or *Steepness*: every ~50 m part of
  a run gets the colour of its real gradient (green < 10%, blue 10–25%, red 25–40%, black > 40%), so you can see
  where a "blue" run is really green, or where it has a steep red bit. Run info cards also say when the steepest
  part doesn't match the official colour.
- **Extra:**
  - *Ski areas in colour:* only alpine skiing counts (runs, ski paths and lifts). Every ski area gets its own colour:
    an outline, a halo around its runs and lifts (the lines keep their difficulty colours), and its name on the map.
    Areas that contain other ski areas (e.g. *Kleinwalsertal-Oberstdorf*) are shown as a dashed **region** outline.
    A legend lists the region with its ski areas: hover an entry to highlight it, tap or click it to zoom there.
  - *Route arrows* show which way you are going; *route distances* show how far into the route you are (every
    100 m / 250 m / 500 m / 1 km…, depending on the route length).
- **Terrain:** *3D terrain* shows the mountains in 3D (also the **3D** button on the map). The map tilts when you
  switch it on; tilt it with two fingers (or right-click drag / Ctrl + drag). When the map is turned, the **compass**
  button appears; tap it to point north again. 3D uses the terrain from the built data.
- **Base map** (online mode only):
  - *Ski map (offline)*: the map from your built data (Protomaps basemap + runs and lifts). Always available; all
    map features work with it.
  - *OpenSnowMap*: OpenStreetMap tiles with the piste overlay of [OpenSnowMap](https://www.opensnowmap.org). Runs
    and lifts are part of the picture there, so *Show*, *Run colours* and the info cards on runs and lifts are not
    available. Routing, search and saved routes work as usual.
  - *OpenFreeMap + pistes*: the [OpenFreeMap](https://openfreemap.org) vector map with the OpenSkiData runs and lifts
    from your built data on top. Everything works like on the ski map.

  Without internet the app shows "No internet. Using the offline map." and switches back to the offline map. When
  online mode is turned off, the offline map is used.

### Keyboard shortcuts (desktop)

| Shortcut | Action |
| --- | --- |
| P | Toggle plan mode |
| Esc | Close the top-most thing: the menu, the search, the info card or search pin; otherwise leave plan mode |
| ⌘K / Ctrl+K | Jump to the search field |
| ⌘Z / Ctrl+Z | Undo the last change to the route points or route settings |
| ⌘Y / Ctrl+Y or ⇧⌘Z | Redo |

Undo/redo is also the ↶ / ↷ capsule on the map (it only shows when there is something to undo). Inside text fields
the shortcuts keep their normal text-editing behaviour.

### Speed

Under *Route settings › Speed* you choose **Beginner / Intermediate / Confident**, and under *Speed per run colour*
you can set your average speed (km/h, including short stops) per run colour: green, blue, red, black, black ◆◆,
freeride and unknown, plus ski paths and walking.

The speeds are used for all time estimates (per step, per leg and in total) and for choosing the route: if you
are slow on red, the planner prefers a slightly longer blue alternative.

| Preset (km/h) | Green | Blue | Red | Black | Black ◆◆ | Freeride | Ski paths | Walk |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Beginner (default) | 12 | 14 | 10 | 7 | 5 | 5 | 8 | 3 |
| Intermediate | 18 | 22 | 20 | 14 | 10 | 10 | 12 | 3.5 |
| Confident | 25 | 32 | 35 | 28 | 22 | 18 | 15 | 4 |

Lift time is the ride time from the data (or an estimate per lift type) plus the average waiting time per lift.

### Saved in your browser

Everything is kept in the browser's local storage, so a reload or a new visit continues where you left off:
the resort, route points and route name, all routing and speed settings, the map options, online mode, the solid
interface, plan mode, the open tab, collapsed route legs, the map position and the undo/redo history (last 50 steps).
Routes and settings of the old planner (before phase 4) are taken over on the first start.

### How the routing works

- Runs can only be skied downhill: OSM drawing direction / `oneway`, otherwise judged by elevation. Connection
  paths go both ways, with an uphill penalty.
- Lifts go uphill and are split at middle stations. Gondolas, cable cars, chairlifts and funiculars can optionally
  be ridden down. Drag lifts never.
- Runs without a difficulty shorter than 150 m are treated as station access paths.
- Times are rough estimates: beginner skiing speeds, lift duration from the data (or estimated per lift type) plus
  waiting time.
- Areas that aren't connected by runs/lifts (e.g. Fellhorn ↔ Ifen, which needs the ski bus) are reported as such.
  Plan them separately.

**Always check the official piste map, signs and conditions on the day.** OSM data can be incomplete or outdated,
and closed runs/lifts are not known to the planner.

## Adding resorts

Edit `resorts.json`. Each resort lists **exact** OpenSkiData ski-area names (or `{ "id": "…" }` for names
that exist more than once). The build stops with suggestions if a name is not found or is ambiguous.

```json
{
  "id": "zillertal-arena",
  "name": "Zillertal Arena",
  "skiAreas": ["Zillertal Arena"],
  "marginKm": 2
}
```

Then run `npm run build`. The basemap, terrain and contours are re-extracted automatically because the region
changed. Restart `npm start` so the servers pick up the new files, and pick the resort in **Settings › Resort**. For
the iPhone, build a new data file (`npm run build:pwa-data`) and import it.

Settings in `resorts.json`:

| Setting | Default | Meaning |
| --- | --- | --- |
| `language` | `de` | Label language of the basemap |
| `basemapMaxZoom` | 15 | Max zoom of the OSM extract (15 is the Protomaps maximum; higher zooms are overzoomed) |
| `terrainMaxZoom` | 14 | Max zoom of the Mapterhorn elevation extract (up to 18 available; each level ≈ 4× download) |
| `skiMaxZoom` | 16 | Max zoom of the ski vector tiles (higher zooms are overzoomed) |
| `contourInterval` / `contourIndexInterval` | 20 / 100 | Contour spacing in metres |

Raster tiles can be requested at **any zoom** (e.g. z18–z20). Vector data is overzoomed, so going higher than z17
only needs a higher `terrainMaxZoom` if you want sharper hillshading.

## Updating the data

- `npm run build`: re-downloads OpenSkiData only if the local copy is older than 24 hours **and** a newer build
  exists (OpenSkiData allows at most one automated download per day).
- `npm run build -- --only=ski`: rebuild only ski tiles, styles and planner data from the local download (seconds).
- `npm run build -- --refresh-basemap`: re-extract the latest Protomaps basemap, terrain and contours.
- `npm run build -- --refresh`: force a new OpenSkiData download (respect the once-per-day rule).
- `npm test`: type check and tests of the shared code, the build scripts, the desktop server and the app.
- `npm run test:e2e`: smoke tests of both app builds in Chromium (needs `npm run build` and `npm run build:pwa-data`).

### Zoom level per build

The map pictures can be built sharper or smaller. Add `z<N>` to the build command:

```sh
npm run build z12           # small: terrain and basemap up to zoom 12
npm run build z15           # sharper hillshading
npm run build -- --terrain-zoom=16 --basemap-zoom=14 --ski-zoom=16   # each one on its own
```

- `z<N>` sets the terrain to zoom N (1 to 18) and the basemap to the smaller of N and 15. Ski runs stay at 16.
  The long options win over `z<N>`, and `z<N>` wins over `resorts.json`.
- Before the terrain download the build shows how many tiles and how many MB to expect. Above zoom 16 it asks
  you to confirm (use `--yes` to skip the question). Where Mapterhorn has no data for a zoom, the build says so and
  uses the highest zoom that exists.
- Every zoom is stored in `build/work/` (for example `build/work/terrain/z14/`). When you go back to a zoom you built
  before, nothing is downloaded again.
- Below basemap zoom 13 the map has no huts and restaurants, so the search finds fewer places.

## Data file for the phone

```sh
npm run build:pwa-data        # pack the current build/ into one ZIP
npm run build:pwa-data z12    # build at zoom 12 first (if needed), then pack
```

This creates `build/pwa/openskimap-data-YYYY-MM-DD-z<terrain zoom>.zip`. It holds the map files, the planner data
(with the search index and ski areas already computed), the fonts the labels need and the icons. The ZIP is not
compressed, so the phone can copy the big files straight out of it. At the end the command prints the size of every
file and the total. `manifest.json` inside the ZIP lists the zoom levels, the data dates and a SHA-256 for each file.

To get it onto the iPhone: AirDrop the ZIP (it lands in Files › Downloads) or save it in iCloud Drive. In the app,
tap **Import data file** and pick it. Do not unzip it. The app checks every file; if something is wrong you get a
clear message and your old data stays. After the first visit the app starts without internet (the service worker
keeps the app, the data lives in the browser storage). A step-by-step test list is in
`docs/agents/iphone-test-phase5.md`.

## Project layout

```
resorts.json              resort definitions + build settings
scripts/build.mjs         build pipeline
scripts/start.mjs         npm start: tile server + desktop server with the desktop build
packages/core/            shared logic in TypeScript (no DOM, no Node APIs): routing network, Dijkstra,
                          GPX export, search, info cards, ski areas, map styles; tests with `npm test`
app/                      the planner app (Vite + Svelte 5 + TypeScript), one code base for both builds
  src/lib/                state, data sources, map layers, routing worker client, import of the data file
  src/ui/                 components (map, sheets, desktop panel, menu, search, info cards)
  test/, e2e/             Vitest unit tests and Playwright tests (`npm run test:e2e`)
server/                   desktop server: the desktop build, the files of build/, project-folder routes,
                          Google Maps short links
saved-routes/             routes saved to the "Project folder"
build/                    everything `npm run build` creates (not in git)
  downloads/              OpenSkiData downloads (kept to respect the once-per-day download rule)
  work/                   intermediate files (filtered GeoJSON, contour lines, terrain pieces)
  tileserver/             what TileServer GL serves:
    config.json             server config
    data/                   map tiles (PMTiles: ski, basemap, terrain, contours)
    styles/                 map styles
    fonts/, sprites/        label fonts and icons
  planner/                runs, lifts and places per resort, used for routing and search
```

Deleting `build/` is safe: `npm run build` recreates it (the OpenSkiData download is then fetched again).

## Troubleshooting

- **`npm` cache errors (root-owned files):** the project uses a local cache via `.npmrc`. To fix the global cache:
  `sudo chown -R $(id -u):$(id -g) ~/.npm`, then remove the line from `.npmrc`.
- **`objc[…]: Class GNotificationCenterDelegate is implemented in both …`:** harmless warning from two native
  image libraries in TileServer GL on macOS.
- **Planner says "The desktop server has no map data":** run `npm run build` first, then `npm start` again.
- **gpx.studio links don't load:** the tile server isn't running. Use `npm start`, or `npm run tiles` in a second
  terminal.
- **Node fails with `Library not loaded: …dylib` after a Homebrew update:** run `brew upgrade node`.

## Data & licenses

Data: OpenSkiData / OpenSkiMap.org, © OpenStreetMap contributors ([ODbL](https://opendatacommons.org/licenses/odbl/)),
Skimap.org, Who's On First, © [Mapterhorn](https://mapterhorn.com/attribution) (terrain),
[Protomaps](https://protomaps.com) basemap (OSM). Fonts and sprites from
[protomaps/basemaps-assets](https://github.com/protomaps/basemaps-assets) (OFL).

These tiles are built and hosted locally from the downloadable OpenSkiData files. Using the vector tiles at
`tiles.openskimap.org` directly is not permitted.

The online base maps load tiles straight from their providers while you browse: OpenStreetMap
([tile usage policy](https://operations.osmfoundation.org/policies/tiles/)), OpenFreeMap, OpenSnowMap pistes (© opensnowmap.org,
CC-BY-SA; pistes-only tiles may be used with attribution, no bulk downloading) and Mapterhorn elevation.
