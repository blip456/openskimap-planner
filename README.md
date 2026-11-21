# OpenSkiMap local: ski route planner for iPhone and desktop

A ski route planner built from [OpenSkiData](https://openskidata.org). You tap a start and a destination. The app
finds an easy route over runs and lifts, shows step-by-step directions, and shares the route as a GPX file (for
example for [gpx.studio](https://gpx.studio)).

There is one app and two builds:

| | iPhone app (PWA) | Desktop build |
| --- | --- | --- |
| For | iPhone (and any modern browser), installed to the Home Screen | Your computer |
| Where the map data lives | In the browser storage of the phone. You import one ZIP file. | In the `build/` folder, served by a small local server |
| Works without internet | Yes, after the first visit and the import | Yes, after `npm run build` |
| Hosting | Any static host, for example Vercel (`docs/vercel.md`) | `npm start` on your computer |
| Online mode (extra maps and search) | Off by default | On by default |
| gpx.studio tile links | No | Yes (TileServer GL) |

Internet is needed only for `npm run build` (and `npm run build:pwa-map-data`) and for the optional *online mode*.

Guides:

- `docs/iphone-guide.md`: how to use the app on the iPhone (install, import the data, location, update).
- `docs/vercel.md`: how to host the iPhone app on Vercel.
- `docs/pwa-plan.md`: the plan and design decisions of this project.

## Requirements

| Tool | Install (macOS) | Used for |
| --- | --- | --- |
| Node.js 24 or newer | `brew install node@24` | everything |
| tippecanoe | `brew install tippecanoe` | building vector tiles |
| GDAL (`gdal_contour`) | `brew install gdal` | contour lines |
| pmtiles CLI | `brew install pmtiles` | extracting basemap and terrain for your resorts |
| mkcert (optional) | `brew install mkcert` | only for `--phone` (HTTPS test on the iPhone) |

> **Node 26:** TileServer GL 5.7.0 officially supports Node 20, 22 and 24. Its native renderer
> (`@maplibre/maplibre-gl-native`) only ships Node 26 binaries in the pre-release `6.5.0-pre.1`, which `package.json`
> pins through `overrides`. If rendering breaks after an update, remove the override and use Node 24.

Run `npm install` once.

## Quick start: desktop

```sh
npm run build        # about 1 minute: filter ski data, download extracts, build tiles and planner data
npm start            # tile server on :8080, planner on :8081 (builds the desktop app first)
```

- Planner: <http://localhost:8081>
- Tile server overview: <http://localhost:8080> (only needed for the gpx.studio links)

You can set the zoom level: `npm run build z12` (see "Zoom levels" below).

For development, `npm run dev:desktop` starts the desktop server, the tile server and a Vite dev server with hot
reload on <http://localhost:5173>.

## Quick start: iPhone app (PWA)

```sh
npm run build                 # once, if build/ does not exist yet
npm run build:pwa-map-data        # packs the resorts.json map (build/regions/oberstdorf-kleinwalsertal/) into one ZIP: build/pwa-map-data/openskimap-data-YYYY-MM-DD-z14.zip
npm run build:pwa-map-data z12    # or: smaller ZIP at zoom 12 (builds the data first if needed)
npm run dev:pwa               # app on http://localhost:5174, no service worker (hot reload)
npm run preview:pwa           # builds the real PWA and serves it on http://localhost:4174 with the service worker
npm run dev:pwa -- --phone    # HTTPS on your Wi-Fi, to open it on the iPhone
```

- In `dev:pwa` the data comes from the browser storage. Import the ZIP, or press *Load data from build/*.
- Use `preview:pwa` to test install, offline start and the update prompt. `npm run preview:pwa -- --phone` does the
  same over HTTPS.
- To put the app on the internet, see `docs/vercel.md`. The data ZIP is never hosted. You move it to the phone
  yourself (see `docs/iphone-guide.md`).

### Testing on the iPhone from your Mac (`--phone`)

The iPhone needs HTTPS for storage, location and the service worker. `--phone` uses a certificate from
[mkcert](https://github.com/FiloSottile/mkcert):

1. Once on the Mac: `brew install mkcert` and `mkcert -install`.
2. `npm run dev:pwa -- --phone`. It prints the addresses to open on the iPhone (same Wi-Fi), for example
   `https://your-mac.local:5174/`, and where mkcert's `rootCA.pem` is.
3. Once on the iPhone: AirDrop `rootCA.pem` to the iPhone, install the profile (Settings › General › VPN & Device
   Management), then turn on full trust for it (Settings › General › About › Certificate Trust Settings).

The certificate is kept in `build/certs/` and made again when your Mac's addresses change.

## Zoom levels

You can build the map sharper or smaller. Add `z<N>` to the build command:

```sh
npm run build z12           # small: terrain and basemap up to zoom 12
npm run build z15           # sharper hillshading
npm run build:pwa-map-data z13  # build at zoom 13 and pack the ZIP
npm run build -- --terrain-zoom=16 --basemap-zoom=14 --ski-zoom=16   # each one on its own
```

What `z<N>` sets:

| Data | Max zoom | Note |
| --- | --- | --- |
| Terrain (hillshading, 3D, contours) | N (1 to 18) | Gives the sharpness and most of the size. Each level is about 4 times more tiles. |
| Basemap (roads, forest, labels) | the smaller of N and 15 | Protomaps has no data above 15. |
| Ski runs and lifts | 16 (unchanged) | Small files. |

The long options win over `z<N>`. `z<N>` wins over `resorts.json`. Without any of them the defaults are terrain 14,
basemap 15, ski 16.

Sizes of the data ZIP for the Oberstdorf resort (the ZIP file name has the terrain zoom):

| Build | Terrain / basemap / ski zoom | ZIP size |
| --- | --- | --- |
| `z12` | 12 / 12 / 16 | about 12.5 MB |
| default (`npm run build`) | 14 / 15 / 16 | about 45.6 MB |
| `z17` | 17 / 15 / 16 | estimate: 11,335 terrain tiles, about 1.6 GB. Not built yet. |

`z15` and `z16` have not been measured. The build prints the expected tiles and MB before the terrain download, and
`build:pwa-map-data` prints the size of every file at the end.

- Above zoom 16 the build asks you to confirm. Use `--yes` to skip the question.
- Where Mapterhorn has no data for a zoom, the build says so and uses the highest zoom that exists.
- Every zoom is stored in `build/work/` (for example `build/work/terrain/z14/`). When you go back to a zoom you built
  before, nothing is downloaded again.
- You can zoom the map further than N. The app enlarges the last level, so the hillshading gets softer.
- `z14` is not the same as the default: `z14` also sets the basemap to 14, the default basemap is 15. To go back to
  the defaults, run `npm run build` without a zoom.
- Below basemap zoom 13 the map has no huts and restaurants, so the search finds fewer places.
- The desktop build uses whatever was built last. The iPhone app uses the ZIP you imported. The Menu › Data page
  shows its zoom levels.

## Data file for the iPhone

`npm run build:pwa-map-data` creates `build/pwa-map-data/openskimap-data-YYYY-MM-DD-z<terrain zoom>.zip`. It holds the map files,
the planner data (with the search index and ski areas already computed), the fonts the labels need and the icons. The
ZIP is not compressed, so the phone can copy the big files straight out of it. `manifest.json` inside the ZIP lists
the zoom levels, the data dates and a SHA-256 for each file.

To get it onto the iPhone: AirDrop the ZIP (it lands in Files › Downloads) or save it in iCloud Drive. In the app, tap
**Import data file** and pick it. Do not unzip it. The app checks every file. If something is wrong you get a clear
message and your old data stays. The full steps are in `docs/iphone-guide.md`.

## npm scripts

The scripts are grouped by topic. The order in `package.json` follows the same groups.

**1. Map data** (needs internet for the first download; run once, then again when the data changes)

| Script | What it does |
| --- | --- |
| `npm run build` | Builds the map data for the desktop and the phone in `build/regions/<resort id>/` (the id of the first resort in `resorts.json`, today `oberstdorf-kleinwalsertal`). Accepts `z<N>` and the `--terrain-zoom`, `--basemap-zoom`, `--ski-zoom`, `--yes`, `--only=ski`, `--refresh`, `--refresh-basemap` options. |
| `npm run build:ski` | Only rebuilds ski tiles, styles and planner data from the local download (seconds). Same as `build -- --only=ski`. |
| `npm run build:pwa-map-data` | Packs the resorts.json map (`build/regions/<resort id>/`) into the data ZIP for the iPhone. Accepts `z<N>`. Offline, no download. |

**2. Development** (hot reload, for changing the code)

| Script | What it does |
| --- | --- |
| `npm run dev:desktop` | Desktop app on http://localhost:5173 with hot reload. Also starts the desktop server (:8081) and TileServer GL (:8080). |
| `npm run dev:pwa` | iPhone app on http://localhost:5174 with hot reload, no service worker. Add `-- --phone` for HTTPS on your Wi-Fi. |

**3. Run without hot reload** (the built app, as the user gets it)

| Script | What it does |
| --- | --- |
| `npm start` | Desktop: builds the desktop app, then starts TileServer GL (:8080) and the desktop server (:8081). Ctrl+C stops both. |
| `npm run server` | Only the desktop server (:8081). |
| `npm run tiles` | Only TileServer GL (:8080), for the gpx.studio links. |
| `npm run preview:pwa` | Builds the PWA and serves it with the service worker on :4174, to test install, offline start and updates. Add `-- --phone` for HTTPS. |

**4. Production builds** (the output goes to `app/dist-pwa` or `app/dist-desktop`)

| Script | What it does |
| --- | --- |
| `npm run build:pwa` | Production build of the iPhone app into `app/dist-pwa` (with service worker and manifest). This is what Vercel runs. |
| `npm run build:desktop` | Production build of the desktop app into `app/dist-desktop`. No service worker. |

**5. Assets**

| Script | What it does |
| --- | --- |
| `npm run icons` | Makes all app icons from `app/public/logo.svg`. |

**6. Checks and tests** (`npm test` before every handover)

| Script | What it does |
| --- | --- |
| `npm test` | Runs `typecheck` and all the unit tests below, in this order. |
| `npm run typecheck` | TypeScript and Svelte checks for all packages. |
| `npm run test:core` | Unit tests of `packages/core`. |
| `npm run test:scripts` | Tests of the build scripts. |
| `npm run test:server` | Tests of the desktop server. |
| `npm run test:app` | Vitest tests of the app. |
| `npm run test:e2e` | Browser tests (Playwright, Chromium) of both builds. Builds both apps first and fails if dev-only code is in a production bundle. |

## Online and offline mode

Switch it in **Menu › Online mode**. The default is off in the iPhone app and on in the desktop build.

| | Offline | Online mode adds |
| --- | --- | --- |
| Map | The ski map from your data (Protomaps basemap, runs, lifts, 3D terrain). | OpenSnowMap, and OpenFreeMap with your runs and lifts on top. Online terrain as a fallback. |
| Search | Names, coordinates and full Google Maps links. | *Search online* (OpenStreetMap Nominatim). Short Google links only in the desktop build. |
| Routing, info cards, saved routes, location | Yes | Yes |

If the phone has no network in online mode, the app shows a note and uses the offline map. The app itself is always
cached by the service worker, so it starts without a network in both modes.

## Tests

- `npm test`: typecheck and all unit tests (core, scripts, server, app). Run it before every handover.
- `npm run test:e2e`: browser tests of both builds in Chromium. It needs `npm run build` and `npm run build:pwa-map-data`
  first. Add `-- --trace off` to keep the output small.
- Some things only a real iPhone can show. The checklists are listed in `docs/iphone-guide.md` under "Testing".

## Using the tiles in gpx.studio (desktop build)

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
- **Terrain:** *Terrain* shows or hides everything that comes from the Mapterhorn elevation data: hillshading,
  contour lines and 3D. *3D terrain* shows the mountains in 3D (also the **3D** button on the map); switching it on
  also turns *Terrain* back on. The map tilts when you switch it on; tilt it with two fingers (or right-click drag /
  Ctrl + drag). When the map is turned, the **compass** button appears; tap it to point north again. On the offline
  ski map the terrain comes only from the built data (never online); the online maps use Mapterhorn online.
- **Base map** (online mode only; each choice shows where its data comes from):
  - *Ski map (offline)*: OpenSkiData + Protomaps, from your built data. Always available; all map features work with
    it, and it never goes online.
  - *OpenFreeMap*: the [OpenFreeMap](https://openfreemap.org) vector map with the OpenSkiData runs and lifts from your
    built data on top, and Mapterhorn online terrain. Everything works like on the ski map.
  - *OpenSnowMap*: OpenStreetMap tiles with the piste overlay of [OpenSnowMap](https://www.opensnowmap.org) and
    Mapterhorn online terrain. Runs and lifts are part of the picture there, so *Show*, *Run colours* and the info
    cards on runs and lifts are not available. Routing, search and saved routes work as usual.

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
the iPhone, build a new data file (`npm run build:pwa-map-data`) and import it.

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

- `npm run build`: downloads OpenSkiData again only if the local copy is older than 24 hours **and** a newer build
  exists (OpenSkiData allows at most one automated download per day).
- `npm run build -- --only=ski` (or `npm run build:ski`): rebuild only ski tiles, styles and planner data from the
  local download (seconds).
- `npm run build -- --refresh-basemap`: get the latest Protomaps basemap, terrain and contours again.
- `npm run build -- --refresh`: force a new OpenSkiData download (respect the once-per-day rule).
- After a new build, run `npm run build:pwa-map-data` and import the new ZIP on the iPhone.

## Project layout

```
resorts.json              resort definitions and build settings
packages/core/            shared logic in TypeScript (no DOM, no Node APIs): routing network, Dijkstra, GPX,
                          search, info cards, ski areas, map styles. Tests: packages/core/test
app/                      the planner app (Vite + Svelte 5 + TypeScript), one code base for both builds
  src/lib/                state, data sources, map layers, routing worker client, import of the data file
  src/ui/                 components (map, sheets, desktop panel, menu, search, info cards)
  public/                 logo and icons (made by `npm run icons`)
  test/, e2e/             Vitest tests and Playwright tests
  dist/, dist-desktop/    build output of the PWA and the desktop build (not in git)
server/                   desktop server: the desktop build, the files of build/, project-folder routes,
                          Google Maps short links
scripts/                  build.mjs (data build), build-pwa-map-data.mjs (the ZIP), start.mjs, dev-desktop.mjs,
                          dev-pwa.mjs, icons.mjs, e2e.mjs, measure-perf.mjs; lib/ and test/
docs/                     guides (iphone-guide.md, vercel.md), the plan, design spec, notes of the agents
vercel.json               settings for hosting the PWA on Vercel
saved-routes/             routes saved to the "Project folder" (desktop, not in git)
build/                    everything the builds create (not in git)
  regions/                one folder per map build. The resorts.json build is regions/<resort id>/ (named after the first resort in resorts.json), and every
                          "Build region" build is regions/<id>/. Each holds the same things:
    oberstdorf-kleinwalsertal/  (the resorts.json map) planner/ (runs, lifts, places per resort, for routing and search), tileserver/
                          (PMTiles data, styles, config for TileServer GL), build-info.json
  tileserver/fonts, sprites/  fonts and sprites, shared by every map build
  downloads/              OpenSkiData downloads (kept to respect the once-per-day download rule)
  work/                   shared caches (basemap, terrain and contour extracts per zoom)
  pwa/                    the data ZIP files for the iPhone (the main one and one per region)
  certs/                  mkcert certificate for `--phone`
```

Deleting `build/` is safe: `npm run build` recreates it (the OpenSkiData download is fetched again).

## Troubleshooting

- **`npm` cache errors (root-owned files):** fix the global cache with `sudo chown -R $(id -u):$(id -g) ~/.npm`.
- **`objc[…]: Class GNotificationCenterDelegate is implemented in both …`:** harmless warning from two native image
  libraries in TileServer GL on macOS.
- **The app says "The desktop server has no map data":** run `npm run build` first, then `npm start` again.
- **gpx.studio links do not load:** the tile server is not running. Use `npm start`, or `npm run tiles` in a second
  terminal.
- **Node fails with `Library not loaded: …dylib` after a Homebrew update:** run `brew upgrade node`.
- **`--phone` says mkcert is missing:** `brew install mkcert`, then `mkcert -install`.
- iPhone problems (data gone, import fails, map blank, location): see `docs/iphone-guide.md`.

## Credits and licences

The same list is in the app under **Menu › About & credits**.

Data and map sources, built into the data you create:

- [OpenSkiData / OpenSkiMap.org](https://openskidata.org): runs, lifts and ski areas.
- [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors: map data, [ODbL](https://opendatacommons.org/licenses/odbl/).
- [Skimap.org](https://skimap.org) (ski area data) and [Who's On First](https://whosonfirst.org) (places), both via OpenSkiData.
- [Mapterhorn](https://mapterhorn.com/attribution): terrain (elevation).
- [Protomaps](https://protomaps.com): basemap built from OpenStreetMap. Fonts and icons from
  [protomaps/basemaps-assets](https://github.com/protomaps/basemaps-assets) (OFL).

These tiles are built and kept locally from the downloadable OpenSkiData files. Using the vector tiles at
`tiles.openskimap.org` directly is not permitted.

Online maps (only in online mode). They load tiles straight from the provider while you browse:

- OpenStreetMap tiles ([tile usage policy](https://operations.osmfoundation.org/policies/tiles/)).
- [OpenFreeMap](https://openfreemap.org): online vector map.
- [OpenSnowMap](https://www.opensnowmap.org): piste tiles, © opensnowmap.org, CC-BY-SA. Pistes-only tiles may be
  used with attribution. No bulk downloading.
- Search online uses OpenStreetMap Nominatim.

Always check the official piste map, signs and conditions on the day.
