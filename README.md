# OpenSkiMap local: tile server + beginner ski route planner

A fully local setup built from [OpenSkiData](https://openskidata.org):

1. **Tile server** ([TileServer GL](https://tileserver.readthedocs.io)) that renders
   - `ski-basemap`: a complete JPG ski map (hillshade, contours, OSM roads/forest/labels, runs and lifts)
   - `ski-overlay`: a transparent PNG with only runs and lifts

   Both can be used as custom layers in [gpx.studio](https://gpx.studio).
2. **Route planner** (local web app): click start and destination, get a beginner-friendly route over runs and
   lifts with step-by-step directions, and download it as GPX for gpx.studio.

Everything works offline after the build. Internet is only needed by `npm run build`, and by the optional
online base map in the planner.

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
npm start         # tile server on :8080 and planner on :8081
```

- Planner: <http://localhost:8081>
- Tile server overview: <http://localhost:8080>

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

The map has two modes, switched with the **✏️ Plan route** button (top left of the map) or the **P** key:

- **Explore** (default): hover a run, lift or place to highlight it, click it for its info card. Clicks never add
  route points by accident.
- **Plan route**: every click adds a route point, even right on top of a run or lift. Press **P** or **Esc** to go
  back to exploring.

Search results and info cards can add points in both modes.

In plan mode, click to set the start, then the destination. More clicks add stops along the way. Points are
lettered A, B, C… in route order (green start, blue stops, red destination):

- **Drag** a marker to move it.
- **Click** a marker (or ✕ in the list) to remove it. The remaining points are re-lettered, so if you remove A,
  B becomes the new A.

The route updates immediately. The directions are grouped per leg (**A → B**, **B → C**, …), each with its own
time, distance, lifts and descent. Click a leg header to collapse it, hover it to highlight that part on the map,
or press ⤢ to zoom to it.

Above the directions, the **gradient profile** shows the elevation along the whole route, with the route points
(A, B, C…) marked. Switch its colours between **Official** (the piste difficulty of each run) and **Steepness** (the
measured gradient of every ~30–50 m slice: green < 10%, blue 10–25%, red 25–40%, black > 40%). Lifts are purple,
paths and walking parts grey. Hover the chart to see the distance, elevation, gradient and run at that point, with a
marker on the map.

**Download GPX** saves a track (with elevation), a waypoint per route point (A, B, C…) and a waypoint for every lift
and run, named per leg (e.g. `B→C 2. Take lift: 28 Zweiländerbahn`). Open the GPX in gpx.studio with *File → Open*.

### Saved routes

Below the route you can give it a **name** and a **folder** (pick an existing one or type a new name; default
*My routes*) and press **Save**. Saved routes are listed under *Saved routes*, grouped by folder:

- **Click a route** to open it again. The resort, the points and the settings it was planned with all come back,
  so you get exactly the same route (⌘Z undoes it).
- After changes, **Save changes** updates it, **Save as new** keeps the old one and makes a copy. The planner
  shows *Changed since you saved it* when there are unsaved changes.
- **⬇** downloads one route as GPX, **🗑** deletes it.
- **Download all (ZIP)** next to a folder downloads one ZIP file with a GPX file for every route in that folder.

**Where routes are saved** (switch at the top of *Saved routes*):

| Place | How | Good to know |
| --- | --- | --- |
| **This browser** (default) | IndexedDB in the browser; the server only calculates the route | Works when the site is hosted. Lost when you clear the browser data, so use **Export backup** / **Import backup** (one JSON file with all routes) to keep a copy or move routes to another computer. |
| **Project folder** | JSON files in `saved-routes/` on the planner server | Only for local use; shared by all browsers on your computer. **Copy all to this browser** copies them into browser storage. `saved-routes/` is in `.gitignore`. |

Each saved route also keeps the GPX made when saving, so it stays downloadable after the map data is updated.

**Hosting the site:** start the planner with `PLANNER_SERVER_ROUTES=0`. The *Project folder* option then
disappears and the `/api/routes` endpoints are turned off; every visitor saves routes in their own browser.

### Info cards

Hover a run, lift, lift station, hut, peak or village to highlight it, and click it to open an info card (similar
to OpenSkiMap):

- **Lifts:** type and seats (e.g. *6p Gondola*), direction, length along the cable, vertical, ride time, speed, vertical
  speed, average slope, capacity, bubble/heating, and an elevation profile.
- **Runs:** difficulty, length, vertical, average slope, steepest section, grooming, one-way/lit/snowmaking/
  gladed/patrolled, and an elevation profile where every slice is coloured by its steepness
  (green < 10%, blue 10–25%, red 25–40%, black > 40%). Hover the profile to read the elevation, distance and
  slope percentage of each slice.
- **Lift stations:** which lift, bottom/top/middle station, boarding/exit, plus the lift's stats.
- **Places** (huts, peaks, villages, …): type and elevation.
- Country › region › ski area, and links to the OpenStreetMap source, website and Wikidata where available.
- Buttons to use the clicked spot as **start / destination / stop**.

Clicking empty map adds a route point as before. If a card is open, the first click on the map closes it.

### Search

The search box drops an orange pin. Its popup lets you use the location as start, destination or stop.

| You type | Result |
| --- | --- |
| A name: `Walsergund`, `Kanzelwandbahn`, `Riezlern`, `Hotel …`, a peak or hut | Offline search over runs (pin at the top), lifts (pin at the bottom station), ski areas, villages, peaks, huts, restaurants, hotels, bus stops, parking, … |
| Coordinates: `47.3481, 10.2160`, `47°20'53.4"N 10°12'57.7"E`, `N 47° 20.890' E 010° 12.962'`, `geo:47.3,10.2` | Pin at exactly that position (lat/lon order, hemispheres N/S/E/W/O supported) |
| A Google Maps link: `https://www.google.com/maps/place/…`, `…?q=47.3,10.2` | Exact position read from the link |
| A Google Maps short link: `https://maps.app.goo.gl/…` | The planner server follows the link (needs internet) and reads the position |
| *Search "…" online* (last result row) | Looks the text up in OpenStreetMap Nominatim (needs internet, only when you click it) |

Some shared short links (typically from the mobile app) only contain an address, not coordinates. In that case the
address is looked up in OpenStreetMap and the pin is marked **approximate**.

### Panel sections

The settings below the route are grouped in this order (only *Runs* is open at first):

| Section | What you set |
| --- | --- |
| **Runs** | Allowed run colours, *Prefer easier runs*, *Use ski paths* (connections between runs), and what happens if no route is found: use harder runs (with a warning) or show no route |
| **Lifts** | Allowed lift types (gondola, chairlift, train, T-bar, button lift, rope tow, magic carpet), *Avoid drag lifts*, *Ride lifts down* (per lift type), waiting time per lift |
| **Speed** | Your average speed per run colour (see below) |
| **Map** | Base map (local or online), 3D terrain, what is shown, run colours and extras (see below) |
| **gpx.studio** | The tile links for gpx.studio, each with a *Copy* button |
| **Advanced** | Max walk between runs and lifts (default 40 m): fixes small gaps where runs and lifts don't touch in the map data |

### Map

All map options are in the *Map* section of the panel, and also behind the **layers button** at the bottom left
of the map (both stay in sync; Esc or a click elsewhere closes it).

- **Base map:**
  - *Protomaps ski map (offline)*: the map built by `npm run build` (Protomaps basemap + runs and lifts), served
    by the local tile server. All map features below work with it.
  - *OpenSnowMap (online)*: OpenStreetMap tiles with the piste overlay of
    [OpenSnowMap](https://www.opensnowmap.org) and hillshading from Mapterhorn. Fully online: needs internet but
    not the tile server, and works everywhere in the world. Runs and lifts are part of the picture there, so
    *Show*, *Run colours* and the info cards on runs and lifts are not available. Routing, search, saved routes
    and *Ski areas in colour* work as usual.
  - *OpenFreeMap + OpenSkiData pistes (online)*: the [OpenFreeMap](https://openfreemap.org) vector map (online)
    with hillshading, and on top the same OpenSkiData runs and lifts as the Protomaps map (from the local tile
    server). Everything works like on the Protomaps map: info cards, *Show*, *Run colours*. Needs internet
    **and** the tile server; the runs and lifts only exist for the resorts in `resorts.json`.
- **3D terrain:** shows the mountains in 3D (also the **3D** button on the map, top right). The map tilts when
  you switch it on; tilt and turn it with right-click drag or Ctrl + drag, the compass button resets it. The local
  map uses the built elevation data; the online map (or a build without terrain) uses Mapterhorn's online elevation
  tiles.
- **Show:** ski runs, lifts, cross-country trails, and touring & sled routes (incl. winter hiking). Hidden types
  also disappear from the labels and can't be clicked.
- **Run colours:** *Official difficulty* (the piste colour from OpenStreetMap) or *Steepness*: every ~50 m part of
  a run gets the colour of its real gradient (green < 10%, blue 10–25%, red 25–40%, black > 40%), so you can see
  where a "blue" run is really green, or where it has a steep red bit. Run info cards also say when the steepest
  part doesn't match the official colour.
- **Ski areas in colour:** only alpine skiing counts (runs, ski paths and lifts; cross-country and hiking are
  ignored). Every ski area gets its own colour: an outline, a halo around its runs and lifts (the lines keep their
  difficulty colours), and its name on the map. Areas that contain other ski areas (e.g.
  *Kleinwalsertal-Oberstdorf*) are shown as a dashed grey **region** outline. A legend lists the region with its
  ski areas: hover an entry to highlight it, click it to zoom there. Off by default.
- **Route arrows** show which way you are going; **route distances** show how far into the route you are (every
  100 m / 250 m / 500 m / 1 km…, depending on the route length).

### Keyboard shortcuts

| Shortcut | Action |
| --- | --- |
| P | Toggle plan mode |
| Esc | Close the open info card or search pin; otherwise leave plan mode |
| ⌘K / Ctrl+K | Jump to the search box |
| ⌘Z / Ctrl+Z | Undo the last change to the route points or route settings |
| ⌘Y / Ctrl+Y or ⇧⌘Z | Redo |

Undo/redo is also available as the ↶ / ↷ buttons next to *Reverse* and *Clear*. Inside text fields the shortcuts keep their
normal text-editing behaviour.

### Speed

Under *Speed* you set your average speed (km/h, including short stops) per run colour: green, blue, red, black,
black ◆◆, freeride and unknown, plus ski paths and walking. The
**Beginner / Intermediate / Confident** buttons fill in typical values that you can then adjust.

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
the resort, route points and route name, all routing and speed settings, display options, plan mode, which panel
sections and route legs are open or collapsed, the map position and the undo/redo history (last 50 steps).

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
changed. Restart `npm start` so the tile server picks up the new files. The planner reloads data by itself.

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

## Project layout

```
resorts.json              resort definitions + build settings
scripts/build.mjs         build pipeline
scripts/start.mjs         runs tile server + planner together
packages/core/            shared logic in TypeScript (no DOM, no Node APIs): routing network, Dijkstra,
                          GPX export, search, info cards, ski areas, map styles; tests with `npm test`
planner/server.mjs        planner HTTP server (uses packages/core)
planner/public/           planner web UI (MapLibre GL JS)
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
- **Planner map is empty:** the tile server isn't running. Use `npm start`, or `npm run tiles` in a second terminal.
  Or switch to the online base map under *Map → Base map*.
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
