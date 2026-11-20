import * as maplibregl from '/vendor/maplibre-gl.mjs';
import { isGoogleMapsLink, isShortLink, parseCoordinates, parseGoogleMapsUrl } from '/geoparse.js';
import { DEFAULT_FOLDER, browserStore, serverStore } from '/route-stores.js';

const DIFFICULTY_INFO = {
  novice: { label: 'Green (novice)', color: '#2e9d3a' },
  easy: { label: 'Blue (easy)', color: '#1f6fd6' },
  intermediate: { label: 'Red (intermediate)', color: '#d8251d' },
  advanced: { label: 'Black (advanced)', color: '#111111' },
  expert: { label: 'Black ◆◆ (expert)', color: '#111111' },
  freeride: { label: 'Freeride / ski route', color: '#ef7d00' },
  unknown: { label: 'Unknown difficulty', color: '#7d7d7d' },
};
const LIFT_INFO = {
  gondola: 'Gondola / cable car',
  chair_lift: 'Chairlift',
  rail: 'Funicular / train',
  tbar: 'T-bar / J-bar',
  platter: 'Platter (button)',
  rope_tow: 'Rope tow',
  magic_carpet: 'Magic carpet',
};
const PLACE_KINDS = {
  ski_area: 'Ski area',
  locality: 'Village / locality',
  peak: 'Peak',
  saddle: 'Mountain pass',
  hill: 'Hill',
  alpine_hut: 'Mountain hut',
  wilderness_hut: 'Hut',
  shelter: 'Shelter',
  restaurant: 'Restaurant',
  cafe: 'Café',
  biergarten: 'Beer garden',
  bar: 'Bar',
  pub: 'Pub',
  fast_food: 'Fast food',
  hotel: 'Hotel',
  guest_house: 'Guest house',
  apartment: 'Apartment',
  chalet: 'Chalet',
  hostel: 'Hostel',
  bus_stop: 'Bus stop',
  bus_station: 'Bus station',
  station: 'Station',
  parking: 'Parking',
  ski_school: 'Ski school',
  ski_rental: 'Ski rental',
  ski: 'Ski shop',
  winter_sports: 'Winter sports',
  viewpoint: 'Viewpoint',
  information: 'Information',
  place_of_worship: 'Church / chapel',
  ticket: 'Tickets',
};
const SEARCH_BOOST = {
  ski_area: 45, locality: 35, lift: 30, run: 30, peak: 25, alpine_hut: 25, restaurant: 18, cafe: 15,
  biergarten: 15, hotel: 12, guest_house: 10, bus_stop: 8, ski_school: 12, ski_rental: 10,
  parking: -15, toilets: -25, information: -15,
};
const LIFT_DOWN_GROUPS = ['gondola', 'chair_lift', 'rail'];
const LIFT_COLOR = '#7b1fa2';
const WALK_COLOR = '#5f6b75';
const STORAGE_KEY = 'ski-planner-v1';
const MAX_POINTS = 25;

const $ = (id) => document.getElementById(id);
const el = (tag, props = {}, ...children) => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
};
const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');

const config = await (await fetch('/api/config')).json();
const validPoint = (p) => Array.isArray(p) && p.length >= 2 && p.every(Number.isFinite);
const storedResortOk = stored.resort && config.resorts.some((r) => r.id === stored.resort);
const state = {
  resort: storedResortOk ? stored.resort : config.resorts[0]?.id,
  options: {
    ...config.defaults,
    ...(stored.options ?? {}),
    speeds: { ...config.defaults.speeds, ...(stored.options?.speeds ?? {}) },
  },
  // the planned route is kept in the browser too, so a reload continues where you left off
  points: storedResortOk && Array.isArray(stored.points) ? stored.points.filter(validPoint).map((p) => [p[0], p[1]]) : [],
  routeName: typeof stored.routeName === 'string' ? stored.routeName : '',
  routeFolder: typeof stored.routeFolder === 'string' ? stored.routeFolder : '',
  savedId: storedResortOk && typeof stored.savedId === 'string' ? stored.savedId : null, // route opened from "Saved routes"
  routeStorage: stored.routeStorage === 'server' ? 'server' : 'browser',
  savedSnapshot: typeof stored.savedSnapshot === 'string' ? stored.savedSnapshot : null,
  collapsedLegs: new Set(Array.isArray(stored.collapsedLegs) ? stored.collapsedLegs : []),
  // open/closed state of the panel sections (Runs, Lifts, Your speed, Display, …), keyed by their title
  sections: stored.sections && typeof stored.sections === 'object' ? stored.sections : {},
  display: {
    showArrows: true,
    showDistances: true,
    showSkiAreas: false,
    colorBy: 'difficulty',
    profileColor: 'official', // route gradient chart: 'official' (piste difficulty) or 'steepness'
    basemap: 'local', // 'local' (own tile server, offline) or 'online' (OpenStreetMap + OpenSnowMap)
    terrain3d: false,
    ...(stored.display ?? {}),
    layers: { downhill: true, lifts: true, nordic: true, other: true, ...(stored.display?.layers ?? {}) },
  },
  planMode: stored.planMode ?? false,
  markers: [],
  result: null,
};

// Everything is stored in the browser (localStorage): settings, display options, plan mode, the route
// points and name, collapsed legs, the map view and the undo/redo history.
let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 150);
}
function saveNow() {
  const view = typeof map !== 'undefined' && map.loaded?.()
    ? { resort: state.resort, center: map.getCenter().toArray(), zoom: map.getZoom(), bearing: map.getBearing(), pitch: map.getPitch() }
    : stored.view;
  const data = {
    resort: state.resort,
    options: state.options,
    display: state.display,
    planMode: state.planMode,
    points: state.points,
    routeName: state.routeName,
    routeFolder: state.routeFolder,
    savedId: state.savedId,
    savedSnapshot: state.savedSnapshot,
    routeStorage: state.routeStorage,
    collapsedLegs: [...state.collapsedLegs],
    sections: state.sections,
    view,
    history: typeof undoStack !== 'undefined' ? { past: undoStack.past.slice(-50), future: undoStack.future.slice(-50) } : stored.history,
  };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // storage full: drop the history and try again
    data.history = null;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  }
}
window.addEventListener('pagehide', saveNow);

// ---------------------------------------------------------------------------
// Options UI

function checkbox(container, name, value, labelText, color, checked, onChange, title) {
  const input = el('input', { type: 'checkbox', name, value, checked });
  input.addEventListener('change', onChange);
  const label = el('label', { className: 'check', title: title ?? '' }, input);
  if (color) {
    const sw = el('span', { className: 'swatch' });
    sw.style.background = color;
    label.append(sw);
  }
  label.append(document.createTextNode(labelText));
  container.append(label);
}

function multiOption(containerId, key, entries) {
  const container = $(containerId);
  for (const [value, labelText, color, title] of entries) {
    checkbox(
      container, key, value, labelText, color, state.options[key].includes(value),
      () => {
        state.options[key] = [...container.querySelectorAll('input:checked')].map((i) => i.value);
        optionsChanged();
      },
      title,
    );
  }
}

// short labels for the checkboxes; the colour swatch says the rest
const DIFFICULTY_SHORT = {
  novice: 'Green', easy: 'Blue', intermediate: 'Red', advanced: 'Black', expert: 'Black ◆◆', freeride: 'Freeride', unknown: 'Unknown',
};
const LIFT_SHORT = {
  gondola: 'Gondola', chair_lift: 'Chairlift', rail: 'Train', tbar: 'T-bar', platter: 'Button lift', rope_tow: 'Rope tow', magic_carpet: 'Magic carpet',
};
multiOption('difficulties', 'difficulties', Object.entries(DIFFICULTY_INFO).map(([k, v]) => [k, DIFFICULTY_SHORT[k], v.color, v.label]));
multiOption('liftGroups', 'liftGroups', Object.keys(LIFT_INFO).map((k) => [k, LIFT_SHORT[k], null, LIFT_INFO[k]]));
multiOption('liftDownGroups', 'liftDownGroups', LIFT_DOWN_GROUPS.map((k) => [k, LIFT_SHORT[k], null, LIFT_INFO[k]]));

for (const key of ['preferEasier', 'includeConnections', 'avoidDragLifts', 'liftDown']) {
  $(key).checked = !!state.options[key];
  $(key).addEventListener('change', (e) => {
    state.options[key] = e.target.checked;
    optionsChanged();
  });
}
for (const radio of document.querySelectorAll('input[name="harderRuns"]')) {
  radio.checked = radio.value === state.options.harderRuns;
  radio.addEventListener('change', () => {
    state.options.harderRuns = radio.value;
    optionsChanged();
  });
}
$('liftWait').value = Math.round(state.options.liftWait / 60);
$('liftWait').addEventListener('change', (e) => {
  state.options.liftWait = Math.max(0, Number(e.target.value) || 0) * 60;
  optionsChanged();
});
$('linkDistance').value = state.options.linkDistance;
$('linkDistanceOut').textContent = state.options.linkDistance;
$('linkDistance').addEventListener('input', (e) => {
  $('linkDistanceOut').textContent = e.target.value;
});
$('linkDistance').addEventListener('change', (e) => {
  state.options.linkDistance = Number(e.target.value);
  optionsChanged();
});

for (const key of ['showArrows', 'showDistances', 'showSkiAreas']) {
  $(key).checked = state.display[key];
  $(key).addEventListener('change', (e) => {
    state.display[key] = e.target.checked;
    save();
    applyDisplay();
  });
}

for (const radio of document.querySelectorAll('input[name="colorBy"]')) {
  radio.checked = radio.value === state.display.colorBy;
  radio.addEventListener('change', () => {
    state.display.colorBy = radio.value;
    save();
    applyLayerFilter();
  });
}

for (const input of document.querySelectorAll('#layer-toggles input')) {
  input.checked = state.display.layers[input.dataset.layer];
  input.addEventListener('change', () => {
    state.display.layers[input.dataset.layer] = input.checked;
    save();
    applyLayerFilter();
  });
}

// Remember which panel sections are open or closed
for (const section of document.querySelectorAll('#panel > details')) {
  const key = section.querySelector('summary')?.textContent.trim();
  if (!key) continue;
  if (key in state.sections) section.open = !!state.sections[key];
  section.addEventListener('toggle', () => {
    state.sections[key] = section.open;
    save();
  });
}

// Personal speeds per difficulty (km/h)
const SPEED_FIELDS = [
  ['novice', 'Green', '#2e9d3a'],
  ['easy', 'Blue', '#1f6fd6'],
  ['intermediate', 'Red', '#d8251d'],
  ['advanced', 'Black', '#111111'],
  ['expert', 'Black ◆◆', '#111111'],
  ['freeride', 'Freeride', '#ef7d00'],
  ['unknown', 'Unknown', '#7d7d7d'],
  ['connection', 'Ski paths', '#5f6b75'],
  ['walk', 'Walking', '#5f6b75'],
];
const PRESET_NAMES = { beginner: 'Beginner', intermediate: 'Intermediate', confident: 'Confident' };

for (const [key, label, color] of SPEED_FIELDS) {
  const sw = el('span', { className: 'swatch' });
  sw.style.background = color;
  const input = el('input', { type: 'number', min: 1, max: 100, step: 1, id: `speed-${key}`, value: state.options.speeds[key] });
  input.addEventListener('change', () => {
    const v = Math.min(100, Math.max(1, Number(input.value) || state.options.speeds[key]));
    input.value = v;
    state.options.speeds = { ...state.options.speeds, [key]: v };
    updatePresetButtons();
    optionsChanged();
  });
  $('speeds').append(
    el('label', { htmlFor: `speed-${key}` }, sw, document.createTextNode(label)),
    el('span', { className: 'speed-input' }, input, document.createTextNode('km/h')),
  );
}
for (const [id, name] of Object.entries(PRESET_NAMES)) {
  const b = el('button', { type: 'button', textContent: name, title: `Fill in typical ${name.toLowerCase()} speeds` });
  b.dataset.preset = id;
  b.addEventListener('click', () => {
    state.options.speeds = { ...config.speedPresets[id] };
    syncOptionsUI();
    optionsChanged();
  });
  $('speed-presets').append(b);
}

function updatePresetButtons() {
  for (const b of $('speed-presets').querySelectorAll('button')) {
    const preset = config.speedPresets[b.dataset.preset];
    b.classList.toggle('active', Object.keys(preset).every((k) => Number(state.options.speeds[k]) === preset[k]));
  }
}
updatePresetButtons();

function updateLiftDownVisibility() {
  $('liftDownGroups').style.display = state.options.liftDown ? '' : 'none';
}
updateLiftDownVisibility();

function optionsChanged() {
  updateLiftDownVisibility();
  save();
  recordHistory();
  scheduleRoute();
}

// Put the settings controls back in line with state.options (used by undo/redo).
function syncOptionsUI() {
  for (const key of ['difficulties', 'liftGroups', 'liftDownGroups']) {
    for (const input of $(key).querySelectorAll('input')) input.checked = state.options[key].includes(input.value);
  }
  for (const key of ['preferEasier', 'includeConnections', 'avoidDragLifts', 'liftDown']) $(key).checked = !!state.options[key];
  for (const radio of document.querySelectorAll('input[name="harderRuns"]')) radio.checked = radio.value === state.options.harderRuns;
  $('liftWait').value = Math.round(state.options.liftWait / 60);
  $('linkDistance').value = state.options.linkDistance;
  $('linkDistanceOut').textContent = state.options.linkDistance;
  for (const [key] of SPEED_FIELDS) $(`speed-${key}`).value = state.options.speeds[key];
  updatePresetButtons();
  updateLiftDownVisibility();
}

$('url-basemap').value = `${config.tileserver}/styles/ski-basemap/{z}/{x}/{y}@2x.jpg`;
$('url-overlay').value = `${config.tileserver}/styles/ski-overlay/{z}/{x}/{y}@2x.png`;
$('url-basemap-steepness').value = `${config.tileserver}/styles/ski-basemap-steepness/{z}/{x}/{y}@2x.jpg`;
$('url-overlay-steepness').value = `${config.tileserver}/styles/ski-overlay-steepness/{z}/{x}/{y}@2x.png`;
for (const id of ['url-basemap', 'url-overlay', 'url-basemap-steepness', 'url-overlay-steepness']) {
  $(id).addEventListener('focus', (e) => e.target.select());
}
for (const btn of document.querySelectorAll('[data-copy]')) {
  btn.addEventListener('click', async (e) => {
    e.preventDefault();
    const input = $(btn.dataset.copy);
    try {
      await navigator.clipboard.writeText(input.value);
    } catch {
      input.select();
      document.execCommand('copy');
    }
    btn.textContent = 'Copied';
    setTimeout(() => {
      btn.textContent = 'Copy';
    }, 1500);
  });
}

// ---------------------------------------------------------------------------
// Resort + map

const resortSelect = $('resort');
for (const r of config.resorts) resortSelect.add(new Option(r.name, r.id, false, r.id === state.resort));
const currentResort = () => config.resorts.find((r) => r.id === state.resort);

// Online elevation tiles (Mapterhorn), used for 3D on the online map or when no terrain was built.
// High-resolution tiles only exist in some regions (e.g. the Alps); elsewhere the map falls back to lower zooms.
const ONLINE_DEM = {
  type: 'raster-dem',
  tiles: ['https://tiles.mapterhorn.com/{z}/{x}/{y}.webp'],
  tileSize: 512,
  encoding: 'terrarium',
  maxzoom: 14,
  attribution: '<a href="https://mapterhorn.com/attribution" target="_blank">© Mapterhorn</a>',
};

// Fully online map: OpenStreetMap with the transparent piste overlay of OpenSnowMap. Needs no tile server.
const ONLINE_STYLE = {
  version: 8,
  name: 'OpenStreetMap + OpenSnowMap',
  glyphs: 'https://protomaps.github.io/basemaps-assets/fonts/{fontstack}/{range}.pbf',
  sources: {
    osm: {
      type: 'raster',
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      maxzoom: 19,
      attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a> contributors',
    },
    dem: ONLINE_DEM,
    opensnowmap: {
      type: 'raster',
      tiles: ['https://tiles.opensnowmap.org/pistes/{z}/{x}/{y}.png'],
      tileSize: 256,
      maxzoom: 18,
      attribution: 'Pistes: <a href="https://www.opensnowmap.org" target="_blank">opensnowmap.org</a> (CC-BY-SA)',
    },
  },
  layers: [
    { id: 'osm', type: 'raster', source: 'osm' },
    {
      id: 'hillshade',
      type: 'hillshade',
      source: 'dem',
      paint: { 'hillshade-exaggeration': 0.3, 'hillshade-shadow-color': '#3d3527' },
    },
    { id: 'opensnowmap', type: 'raster', source: 'opensnowmap' },
  ],
};

// OpenFreeMap (online vector map, no API key) with hillshading and the OpenSkiData runs and lifts of the local
// tile server on top. The ski layers keep their ids, so info cards, steepness colours and "Show" work as usual.
// OpenFreeMap's glyph server has no "Noto Sans Medium"; the other maps do.
const OPENFREEMAP_FONT = ['Noto Sans Bold'];
let openFreeMapBase = null;
async function loadOpenFreeMapStyle() {
  openFreeMapBase ??= await (await fetch('https://tiles.openfreemap.org/styles/liberty')).json();
  const style = structuredClone(openFreeMapBase);
  const at = (id, fallback) => {
    const i = style.layers.findIndex((l) => l.id === id);
    return i < 0 ? fallback : i;
  };
  style.name = 'OpenFreeMap + OpenSkiData';
  style.sources.dem = ONLINE_DEM;
  style.layers.splice(at('water', 0) + 1, 0, structuredClone(ONLINE_STYLE.layers.find((l) => l.id === 'hillshade')));

  try {
    const overlay = await (await fetch(`${config.tileserver}/styles/ski-overlay/style.json`)).json();
    style.sources.ski = overlay.sources.ski;
    const fixFont = (l) => (l.layout?.['text-font'] ? { ...l, layout: { ...l.layout, 'text-font': OPENFREEMAP_FONT } } : l);
    const lines = overlay.layers.filter((l) => l.type !== 'symbol');
    const labels = overlay.layers.filter((l) => l.type === 'symbol').map(fixFont);
    // runs and lifts below OpenFreeMap's labels, their own labels on top (like the Protomaps ski map)
    style.layers.splice(at('waterway_line_label', style.layers.length), 0, ...lines);
    style.layers.push(...labels);
  } catch {
    showError(
      `Cannot reach the tile server at ${config.tileserver}, so the runs and lifts are missing. ` +
        'Start it with "npm start", or use the OpenSnowMap map.',
    );
  }
  return style;
}

async function styleFor(basemap) {
  if (basemap === 'online') return ONLINE_STYLE;
  if (basemap === 'openfreemap') {
    try {
      return await loadOpenFreeMapStyle();
    } catch {
      showError('Could not load OpenFreeMap (no internet?). Showing the OpenSnowMap map instead.');
      return ONLINE_STYLE;
    }
  }
  return `${config.tileserver}/styles/ski-basemap/style.json`;
}

// only the OpenSnowMap map has its pistes as pictures; the other maps use the OpenSkiData vector layers
const hasSkiLayers = () => state.display.basemap !== 'online';
const labelFont = () => (state.display.basemap === 'openfreemap' ? OPENFREEMAP_FONT : ['Noto Sans Medium']);

// reopen the map where you left it (if it was the same resort)
const savedView = stored.view?.resort === state.resort && Array.isArray(stored.view.center) ? stored.view : null;
const map = new maplibregl.Map({
  container: 'map',
  style: await styleFor(state.display.basemap),
  ...(savedView
    ? { center: savedView.center, zoom: savedView.zoom, bearing: savedView.bearing ?? 0, pitch: savedView.pitch ?? 0 }
    : { bounds: currentResort()?.bbox, fitBoundsOptions: { padding: 20 } }),
  maxZoom: 19,
  maxPitch: 85,
  attributionControl: { compact: true },
});
map.on('moveend', save);
map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');
map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-right');
map.on('error', (e) => {
  if (hasSkiLayers() && String(e.error?.message ?? '').includes('Failed to fetch')) {
    showError(
      `Cannot reach the tile server at ${config.tileserver}. Start it with "npm run tiles" (or "npm start"), ` +
        'or switch to the OpenSnowMap map (fully online) under Map → Base map.',
    );
  }
});

// ---------------------------------------------------------------------------
// Base map switch (local tile server / online) and 3D terrain

async function setBasemap(basemap) {
  if (basemap === state.display.basemap) return;
  state.display.basemap = basemap;
  save();
  showError(null);
  closeInfoCard();
  setHover(null);
  updateBasemapUI();
  const style = await styleFor(basemap);
  if (basemap !== state.display.basemap) return; // switched again while loading
  // diff: false rebuilds the style completely, so 'style.load' fires and the planner layers are added again
  map.setStyle(style, { diff: false });
}

function updateBasemapUI() {
  const online = !hasSkiLayers();
  for (const radio of document.querySelectorAll('input[name="basemap"]')) radio.checked = radio.value === state.display.basemap;
  $('online-hint').hidden = !online;
  $('ski-layer-options').hidden = online;
  $('run-colour-options').hidden = online;
  $('terrain3d').checked = state.display.terrain3d;
  terrainControl.update();
  layersControl.sync();
}

for (const radio of document.querySelectorAll('input[name="basemap"]')) {
  radio.addEventListener('change', () => radio.checked && setBasemap(radio.value));
}
$('terrain3d').addEventListener('change', (e) => setTerrain3d(e.target.checked));

// 3D uses its own elevation source: sharing one with the hillshade layer lowers the rendering quality.
function applyTerrain() {
  try {
    if (!state.display.terrain3d) {
      if (map.getTerrain()) map.setTerrain(null);
      return;
    }
    if (!map.getSource('terrain-3d')) {
      const local = map.getStyle().sources?.terrain;
      map.addSource('terrain-3d', local?.type === 'raster-dem' ? { ...local } : ONLINE_DEM);
    }
    map.setTerrain({ source: 'terrain-3d', exaggeration: 1.2 });
    map.setSky?.({
      'sky-color': '#9ec9f0',
      'horizon-color': '#e4eef7',
      'fog-color': '#f2f5f8',
      'sky-horizon-blend': 0.6,
      'horizon-fog-blend': 0.6,
      'fog-ground-blend': 0.85,
    });
  } catch {
    // the style is still loading (e.g. right after switching base maps); 'style.load' applies it again
  }
}

function setTerrain3d(on) {
  state.display.terrain3d = on;
  save();
  updateBasemapUI();
  applyTerrain();
  // tilt the map so the relief is visible, and flatten it again when 3D is switched off
  if (on && map.getPitch() < 30) map.easeTo({ pitch: 60, duration: 800 });
  else if (!on && map.getPitch() > 0) map.easeTo({ pitch: 0, duration: 600 });
}

class TerrainControl {
  onAdd() {
    this.container = el('div', { className: 'maplibregl-ctrl maplibregl-ctrl-group terrain-ctrl' });
    this.button = el('button', { type: 'button', className: 'terrain-btn', textContent: '3D' });
    this.button.addEventListener('click', () => setTerrain3d(!state.display.terrain3d));
    this.container.append(this.button);
    this.update();
    return this.container;
  }
  onRemove() {
    this.container.remove();
  }
  update() {
    if (!this.button) return;
    this.button.classList.toggle('active', state.display.terrain3d);
    this.button.setAttribute('aria-pressed', String(state.display.terrain3d));
    this.button.title = state.display.terrain3d ? 'Show the map flat (2D)' : 'Show the mountains in 3D (tilt with right-click drag)';
  }
}
const terrainControl = new TerrainControl();
map.addControl(terrainControl, 'top-right');

// Layers button on the map: a copy of the panel's Map section (base map, 3D, what is shown, colours, extras).
// Every copied input forwards to its original in the panel, so both always stay in sync.
const LAYERS_SVG =
  '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<path d="m12 2 10 5-10 5L2 7z"/><path d="m2 12 10 5 10-5"/><path d="m2 17 10 5 10-5"/></svg>';

class LayersControl {
  onAdd() {
    this.container = el('div', { className: 'maplibregl-ctrl layers-ctrl' });
    this.panel = el('div', { className: 'layers-panel', hidden: true });
    this.panel.setAttribute('role', 'dialog');
    this.panel.setAttribute('aria-label', 'Map layers');
    this.button = el('button', { type: 'button', className: 'layers-btn', title: 'Map layers' });
    this.button.innerHTML = LAYERS_SVG;
    this.button.setAttribute('aria-expanded', 'false');
    this.button.addEventListener('click', () => this.toggle());
    this.container.append(this.panel, el('div', { className: 'maplibregl-ctrl-group' }, this.button));
    this.build();
    // Esc while a checkbox in the panel has focus (the global shortcut ignores keys typed in inputs)
    this.panel.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      this.toggle(false);
      this.button.focus();
    });
    document.addEventListener('pointerdown', (e) => {
      if (this.isOpen() && !this.container.contains(e.target)) this.toggle(false);
    });
    return this.container;
  }
  onRemove() {
    this.container.remove();
  }
  build() {
    const source = $('map-options');
    this.pairs = [];
    this.mirrors = [];
    this.panel.replaceChildren(el('div', { className: 'layers-title', textContent: 'Map layers' }));
    for (const fieldset of source.querySelectorAll(':scope > fieldset')) {
      const copy = fieldset.cloneNode(true);
      // the legends are filled in by code and stay in the panel only
      copy.querySelectorAll('#slope-legend, #ski-area-legend').forEach((n) => n.remove());
      // ids must stay unique; remember which copied element mirrors which original (for hidden states)
      for (const node of [copy, ...copy.querySelectorAll('[id]')]) {
        if (!node.id) continue;
        this.mirrors.push([$(node.id), node]);
        node.removeAttribute('id');
      }
      const originals = fieldset.querySelectorAll('input');
      copy.querySelectorAll('input').forEach((input, i) => {
        const original = originals[i];
        // radios with the same name would form one group with the panel's radios
        if (input.name) input.name = `layers-${input.name}`;
        input.addEventListener('change', () => {
          if (input.type === 'radio' && !input.checked) return;
          original.checked = input.checked;
          original.dispatchEvent(new Event('change'));
          this.sync();
        });
        this.pairs.push([original, input]);
      });
      this.panel.append(copy);
    }
    source.addEventListener('change', () => this.sync());
    this.sync();
  }
  sync() {
    if (!this.pairs) return;
    for (const [original, copy] of this.pairs) copy.checked = original.checked;
    for (const [original, copy] of this.mirrors) copy.hidden = original.hidden;
  }
  isOpen() {
    return !this.panel.hidden;
  }
  toggle(open = !this.isOpen()) {
    if (open) this.sync();
    this.panel.hidden = !open;
    this.button.classList.toggle('active', open);
    this.button.setAttribute('aria-expanded', String(open));
  }
}
const layersControl = new LayersControl();
map.addControl(layersControl, 'bottom-left');
updateBasemapUI();

function switchResort(id, { keepPoints = false } = {}) {
  state.resort = id;
  resortSelect.value = id;
  save();
  if (!keepPoints) clearPoints();
  removeSearchPin();
  loadSearchIndex();
  if (state.display.showSkiAreas) loadSkiAreas();
  if (!keepPoints) map.fitBounds(currentResort().bbox, { padding: 20 });
}
resortSelect.addEventListener('change', () => switchResort(resortSelect.value));

// Chevron pointing right (= along the line direction), drawn on a canvas so no font is needed and it sits
// exactly on the line. `both` draws "‹ ›" for lifts that run both ways.
function arrowImage(color = '#1d2329', { both = false } = {}) {
  const width = both ? 64 : 48;
  const height = 48;
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  const ctx = c.getContext('2d');
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const path = () => {
    ctx.beginPath();
    if (both) {
      ctx.moveTo(24, 12);
      ctx.lineTo(10, 24);
      ctx.lineTo(24, 36);
      ctx.moveTo(40, 12);
      ctx.lineTo(54, 24);
      ctx.lineTo(40, 36);
    } else {
      ctx.moveTo(17, 12);
      ctx.lineTo(31, 24);
      ctx.lineTo(17, 36);
    }
  };
  path();
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 12;
  ctx.stroke();
  path();
  ctx.strokeStyle = color;
  ctx.lineWidth = 6;
  ctx.stroke();
  return ctx.getImageData(0, 0, width, height);
}

// The ski styles draw one-way and lift direction arrows as the text "›", which the font puts slightly below the
// middle of the line. In the planner they are replaced by arrow images in the colour of the run or lift.
// Images are made on demand ("arrow:<colour>" / "arrow-both:<colour>") when the map asks for them.
map.on('styleimagemissing', (e) => {
  const m = String(e.id).match(/^arrow(-both)?:(#[0-9a-fA-F]{3,8})$/);
  if (m && !map.hasImage(e.id)) map.addImage(e.id, arrowImage(m[2], { both: !!m[1] }), { pixelRatio: 2 });
});

function useArrowImages() {
  const icon = (id, image, size) => {
    if (!map.getLayer(id)) return;
    map.setLayoutProperty(id, 'text-field', '');
    map.setLayoutProperty(id, 'icon-image', image);
    map.setLayoutProperty(id, 'icon-size', size);
    map.setLayoutProperty(id, 'icon-rotation-alignment', 'map');
    map.setLayoutProperty(id, 'icon-keep-upright', false);
    map.setLayoutProperty(id, 'icon-allow-overlap', true);
    map.setLayoutProperty(id, 'icon-ignore-placement', true);
  };
  icon('ski-runs-oneway', ['concat', 'arrow:', ['get', 'color']], ['interpolate', ['linear'], ['zoom'], 15, 0.75, 18, 1]);
  icon(
    'ski-lifts-direction',
    ['case', ['==', ['get', 'direction'], 'both'], `arrow-both:${LIFT_COLOR}`, `arrow:${LIFT_COLOR}`],
    ['interpolate', ['linear'], ['zoom'], 13, 0.65, 17, 0.95],
  );
}

const EMPTY = { type: 'FeatureCollection', features: [] };

// Runs for the first style and again after every base map switch (a new style drops all planner layers).
map.on('style.load', () => {
  runLabelBaseFilter = null;
  skiAreasShown = null;
  if (!map.hasImage('route-arrow')) map.addImage('route-arrow', arrowImage(), { pixelRatio: 2 });
  useArrowImages();
  for (const id of ['route', 'route-highlight', 'route-distances', 'search-highlight', 'hover-highlight', 'info-highlight']) {
    map.addSource(id, { type: 'geojson', data: EMPTY });
  }

  // Highlights are solid (no opacity) and drawn *below* the ski runs and lifts of the basemap, like a glow.
  // Translucent lines would look darker wherever pieces overlap (tile edges, shared piste sections).
  const underSki = map.getLayer('ski-run-areas') ? 'ski-run-areas' : undefined;
  map.addLayer(
    {
      id: 'search-highlight',
      type: 'line',
      source: 'search-highlight',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#ffc58a', 'line-width': ['interpolate', ['linear'], ['zoom'], 11, 8, 16, 18] },
    },
    underSki,
  );
  map.addLayer(
    {
      id: 'info-highlight-line',
      type: 'line',
      source: 'info-highlight',
      filter: ['!=', ['geometry-type'], 'Point'],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': ['case', ['==', ['get', 'part'], 'piste'], '#fff0a8', '#ffd84d'],
        'line-width': ['interpolate', ['linear'], ['zoom'], 11, 8, 16, 18],
      },
    },
    underSki,
  );
  map.addLayer(
    {
      id: 'hover-highlight-line',
      type: 'line',
      source: 'hover-highlight',
      filter: ['!=', ['geometry-type'], 'Point'],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#9ad7ff', 'line-width': ['interpolate', ['linear'], ['zoom'], 11, 6, 16, 14] },
    },
    underSki,
  );
  map.addLayer(
    {
      id: 'hover-highlight-point',
      type: 'circle',
      source: 'hover-highlight',
      filter: ['==', ['geometry-type'], 'Point'],
      paint: { 'circle-radius': 12, 'circle-color': '#9ad7ff' },
    },
    underSki,
  );
  map.addLayer(
    {
      id: 'info-highlight-point',
      type: 'circle',
      source: 'info-highlight',
      filter: ['==', ['geometry-type'], 'Point'],
      paint: { 'circle-radius': 14, 'circle-color': '#ffd84d' },
    },
    underSki,
  );
  map.addLayer({
    id: 'route-casing',
    type: 'line',
    source: 'route',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': '#ffffff', 'line-width': ['interpolate', ['linear'], ['zoom'], 11, 6, 16, 14], 'line-opacity': 0.95 },
  });
  map.addLayer({
    id: 'route-highlight',
    type: 'line',
    source: 'route-highlight',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': '#ffe066', 'line-width': ['interpolate', ['linear'], ['zoom'], 11, 10, 16, 20] },
  });
  map.addLayer({
    id: 'route-line',
    type: 'line',
    source: 'route',
    filter: ['!=', ['get', 'type'], 'walk'],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': ['get', 'color'], 'line-width': ['interpolate', ['linear'], ['zoom'], 11, 3, 16, 8] },
  });
  map.addLayer({
    id: 'route-walk',
    type: 'line',
    source: 'route',
    filter: ['==', ['get', 'type'], 'walk'],
    layout: { 'line-cap': 'round' },
    paint: { 'line-color': WALK_COLOR, 'line-width': ['interpolate', ['linear'], ['zoom'], 11, 2, 16, 5], 'line-dasharray': [0.5, 1.5] },
  });
  map.addLayer({
    id: 'route-arrows',
    type: 'symbol',
    source: 'route',
    layout: {
      'symbol-placement': 'line',
      'symbol-spacing': ['interpolate', ['linear'], ['zoom'], 11, 60, 16, 110],
      'icon-image': 'route-arrow',
      'icon-size': ['interpolate', ['linear'], ['zoom'], 11, 0.8, 16, 1.3],
      'icon-rotation-alignment': 'map',
      'icon-keep-upright': false,
      'icon-allow-overlap': true,
      'icon-ignore-placement': true,
    },
  });
  map.addLayer({
    id: 'route-distance-dots',
    type: 'circle',
    source: 'route-distances',
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 3, 16, 5],
      'circle-color': '#ffffff',
      'circle-stroke-color': '#1d2329',
      'circle-stroke-width': 2,
    },
  });
  map.addLayer({
    id: 'route-distance-labels',
    type: 'symbol',
    source: 'route-distances',
    layout: {
      'text-field': ['get', 'label'],
      'text-font': labelFont(),
      'text-size': ['interpolate', ['linear'], ['zoom'], 11, 11, 16, 14],
      'text-offset': [0, -1.1],
      'text-anchor': 'bottom',
      'text-allow-overlap': false,
      'text-padding': 4,
    },
    paint: { 'text-color': '#1d2329', 'text-halo-color': '#ffffff', 'text-halo-width': 2 },
  });
  addSkiAreaLayers();
  addSlopeLayer();
  applyDisplay();
  applyLayerFilter();
  applyTerrain();
  if (state.result) setRouteData(state.result);
});

function applyDisplay() {
  if (!map.getLayer('route-arrows')) return;
  map.setLayoutProperty('route-arrows', 'visibility', state.display.showArrows ? 'visible' : 'none');
  for (const id of ['route-distance-dots', 'route-distance-labels']) {
    map.setLayoutProperty(id, 'visibility', state.display.showDistances ? 'visible' : 'none');
  }
  for (const id of SKI_AREA_LAYERS) {
    if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', state.display.showSkiAreas ? 'visible' : 'none');
  }
  // the overlay has its own (coloured) ski area names
  if (map.getLayer('ski-areas-label')) map.setLayoutProperty('ski-areas-label', 'visibility', state.display.showSkiAreas ? 'none' : 'visible');
  $('ski-area-legend').hidden = !state.display.showSkiAreas;
  if (state.display.showSkiAreas) loadSkiAreas();
}

// ---------------------------------------------------------------------------
// "Show on map" filter for the ski layers of the tile server style

const LAYER_GROUPS = {
  downhill: [
    'ski-run-areas', 'ski-runs-casing', 'ski-runs-connection', 'ski-runs-downhill', 'ski-runs-expert-center',
    'ski-runs-freeride', 'ski-runs-oneway',
  ],
  lifts: ['ski-lifts-casing', 'ski-lifts', 'ski-lifts-drag', 'ski-lift-stations', 'ski-lifts-direction', 'ski-lifts-label'],
  nordic: ['ski-runs-nordic'],
  other: ['ski-runs-other'],
};
const RUN_LABEL_KINDS = {
  downhill: ['downhill', 'connection'],
  nordic: ['nordic'],
  other: ['skitour', 'sled', 'hike', 'other'],
};
let runLabelBaseFilter = null;

// "Colour runs by steepness": a planner-side layer on the run_slopes tiles replaces the difficulty-coloured lines
const DIFFICULTY_LINE_LAYERS = ['ski-runs-downhill', 'ski-runs-expert-center', 'ski-runs-freeride'];
function addSlopeLayer() {
  if (!map.getSource('ski') || map.getLayer('ski-runs-slope')) return;
  const before = ['ski-runs-oneway', 'ski-lifts-casing'].find((id) => map.getLayer(id));
  map.addLayer(
    {
      id: 'ski-runs-slope',
      type: 'line',
      source: 'ski',
      'source-layer': 'run_slopes',
      minzoom: 10,
      layout: { 'line-cap': 'round', 'line-join': 'round', visibility: 'none' },
      paint: {
        'line-color': ['match', ['get', 'cls'], ...SLOPE_CLASSES.flatMap((c) => [c.id, c.color]), '#7d7d7d'],
        'line-width': ['interpolate', ['exponential', 1.5], ['zoom'], 11, 0.8, 14, 2, 17, 5],
      },
    },
    before,
  );
  const legend = $('slope-legend');
  legend.replaceChildren();
  for (const c of SLOPE_CLASSES) {
    const sw = el('span', { className: 'swatch' });
    sw.style.background = c.color;
    legend.append(el('span', { className: 'prof-legend-item' }, sw, document.createTextNode(c.label)));
  }
}

function applyLayerFilter() {
  const layers = state.display.layers;
  const bySlope = state.display.colorBy === 'slope';
  for (const [group, ids] of Object.entries(LAYER_GROUPS)) {
    for (const id of ids) {
      const visible = layers[group] && !(bySlope && DIFFICULTY_LINE_LAYERS.includes(id));
      if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none');
    }
  }
  if (map.getLayer('ski-runs-slope')) map.setLayoutProperty('ski-runs-slope', 'visibility', layers.downhill && bySlope ? 'visible' : 'none');
  $('slope-legend').hidden = !bySlope;
  // run names share one label layer, so filter it by the visible run kinds
  if (map.getLayer('ski-runs-label')) {
    runLabelBaseFilter ??= map.getFilter('ski-runs-label') ?? true;
    const kinds = Object.entries(RUN_LABEL_KINDS).flatMap(([group, k]) => (layers[group] ? k : []));
    map.setFilter('ski-runs-label', ['all', runLabelBaseFilter, ['in', ['get', 'kind'], ['literal', kinds]]]);
  }
  if (map.getLayer('ski-area-halo')) {
    map.setFilter('ski-area-halo', layers.lifts && layers.downhill ? null : ['==', ['get', 'type'], layers.lifts ? 'lift' : layers.downhill ? 'run' : 'none']);
  }
  setHover(null);
}

// ---------------------------------------------------------------------------
// Ski areas overlay: every Skigebiet gets a colour (outline, fill, halo around its runs and lifts);
// umbrella regions that contain other ski areas get a dashed grey outline.

const SKI_AREA_LAYERS = ['ski-area-fill', 'ski-area-halo', 'ski-area-outline', 'ski-area-region-outline', 'ski-area-label'];
const skiAreaCache = new Map();
let skiAreasShown = null;

function addSkiAreaLayers() {
  for (const id of ['ski-area-outlines', 'ski-area-labels', 'ski-area-halos']) map.addSource(id, { type: 'geojson', data: EMPTY });
  // below the highlights and the ski runs of the basemap style, so runs keep their difficulty colours on top
  const before = ['search-highlight', 'ski-run-areas'].find((id) => map.getLayer(id));
  const hidden = { visibility: 'none' };
  map.addLayer(
    {
      id: 'ski-area-fill',
      type: 'fill',
      source: 'ski-area-outlines',
      filter: ['!', ['get', 'region']],
      layout: hidden,
      paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.12 },
    },
    before,
  );
  map.addLayer(
    {
      id: 'ski-area-halo',
      type: 'line',
      source: 'ski-area-halos',
      layout: { ...hidden, 'line-cap': 'round', 'line-join': 'round' },
      // solid light colours: no darker spots where runs and lifts overlap
      paint: {
        'line-color': ['get', 'halo'],
        'line-width': ['interpolate', ['exponential', 1.5], ['zoom'], 11, 5, 14, 9, 17, 18],
      },
    },
    before,
  );
  map.addLayer(
    {
      id: 'ski-area-outline',
      type: 'line',
      source: 'ski-area-outlines',
      filter: ['!', ['get', 'region']],
      layout: { ...hidden, 'line-join': 'round' },
      paint: { 'line-color': ['get', 'color'], 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 1.5, 15, 3], 'line-opacity': 0.9 },
    },
    before,
  );
  map.addLayer(
    {
      id: 'ski-area-region-outline',
      type: 'line',
      source: 'ski-area-outlines',
      filter: ['get', 'region'],
      layout: { ...hidden, 'line-join': 'round' },
      paint: { 'line-color': ['get', 'color'], 'line-width': 2, 'line-dasharray': [3, 2], 'line-opacity': 0.8 },
    },
    before,
  );
  map.addLayer(
    {
      id: 'ski-area-label',
      type: 'symbol',
      source: 'ski-area-labels',
      maxzoom: 15.5,
      layout: {
        ...hidden,
        'text-field': ['case', ['get', 'region'], ['concat', 'Region: ', ['get', 'name']], ['get', 'name']],
        'text-font': labelFont(),
        'text-size': ['case', ['get', 'region'], 12, 14],
        'text-max-width': 10,
        'symbol-sort-key': ['case', ['get', 'region'], 1, 0],
      },
      paint: { 'text-color': ['get', 'color'], 'text-halo-color': '#ffffff', 'text-halo-width': 2.2 },
    },
    map.getLayer('route-casing') ? 'route-casing' : undefined,
  );
}

async function loadSkiAreas() {
  if (!map.getSource('ski-area-outlines')) return;
  const resort = state.resort;
  if (skiAreasShown === resort) return;
  try {
    let data = skiAreaCache.get(resort);
    if (!data) {
      const res = await fetch(`/api/ski-areas?resort=${encodeURIComponent(resort)}`);
      data = await res.json();
      if (!res.ok) throw new Error(data.error);
      skiAreaCache.set(resort, data);
    }
    if (resort !== state.resort) return;
    map.getSource('ski-area-outlines').setData(data.outlines);
    map.getSource('ski-area-labels').setData(data.labels);
    map.getSource('ski-area-halos').setData(data.halos);
    renderSkiAreaLegend(data.areas);
    skiAreasShown = resort;
  } catch {
    $('ski-area-legend').replaceChildren(el('p', { className: 'hint', textContent: 'Could not load the ski areas.' }));
  }
}

function emphasizeSkiArea(id) {
  if (!map.getLayer('ski-area-fill')) return;
  map.setPaintProperty('ski-area-fill', 'fill-opacity', id ? ['case', ['==', ['get', 'id'], id], 0.3, 0.05] : 0.12);
  map.setPaintProperty('ski-area-halo', 'line-color', id ? ['case', ['==', ['get', 'area'], id], ['get', 'color'], '#e3e6e9'] : ['get', 'halo']);
}

function renderSkiAreaLegend(areas) {
  const row = (a, nested) => {
    const sw = el('span', { className: `swatch${a.isRegion ? ' region' : ''}` });
    if (a.isRegion) sw.style.borderColor = a.color;
    else sw.style.background = a.color;
    const counts = [a.runs && `${a.runs} run${a.runs === 1 ? '' : 's'}`, a.lifts && `${a.lifts} lift${a.lifts === 1 ? '' : 's'}`].filter(Boolean).join(' · ');
    const item = el(
      'li',
      { className: nested ? 'nested' : '', title: 'Click to zoom to this area' },
      sw,
      el('span', { className: 'area-name', textContent: a.name }),
      el('span', { className: 'area-meta', textContent: a.isRegion ? `Region · ${counts}` : counts }),
    );
    item.addEventListener('mouseenter', () => emphasizeSkiArea(a.isRegion ? null : a.id));
    item.addEventListener('mouseleave', () => emphasizeSkiArea(null));
    item.addEventListener('click', () => a.bbox && map.fitBounds(a.bbox, { padding: 40, maxZoom: 15 }));
    return item;
  };
  const list = el('ul', { className: 'area-legend' });
  const shown = new Set();
  for (const region of areas.filter((a) => a.isRegion)) {
    list.append(row(region, false));
    shown.add(region.id);
    for (const child of areas.filter((a) => a.parent === region.id)) {
      list.append(row(child, true));
      shown.add(child.id);
    }
  }
  const others = areas.filter((a) => !shown.has(a.id));
  if (others.length && shown.size) list.append(el('li', { className: 'area-heading', textContent: 'Other areas nearby' }));
  for (const a of others) list.append(row(a, false));
  $('ski-area-legend').replaceChildren(list);
}

// Two modes:
// - plan mode: every click adds a route point, even on top of a run or lift
// - explore mode: clicking a run, lift, station or place opens its info card; empty map does nothing
map.on('click', (e) => {
  if (state.planMode) {
    closeInfoCard();
    addPoint([e.lngLat.lng, e.lngLat.lat]);
    return;
  }
  const feature = pickFeature(e.point);
  if (feature) {
    openInfoCard(feature, e.lngLat);
    return;
  }
  if (infoPopup) {
    closeInfoCard();
    return;
  }
  showToast('To add points, press ✏️ Plan route (P).');
});

map.on('mousemove', (e) => {
  if (state.planMode) {
    setHover(null);
    return;
  }
  const feature = pickFeature(e.point);
  map.getCanvas().style.cursor = feature ? 'pointer' : '';
  setHover(feature);
});
map.on('mouseout', () => setHover(null));

let toastTimer = null;
function showToast(text) {
  const toast = $('map-toast');
  toast.textContent = text;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.hidden = true;
  }, 2600);
}

// Map button that toggles plan mode
const PENCIL_SVG =
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/></svg>';

class PlanModeControl {
  onAdd() {
    this.container = el('div', { className: 'maplibregl-ctrl maplibregl-ctrl-group plan-ctrl' });
    this.button = el('button', { type: 'button', className: 'plan-btn' });
    this.button.innerHTML = `${PENCIL_SVG}<span>Plan route</span>`;
    this.button.addEventListener('click', () => setPlanMode(!state.planMode));
    this.container.append(this.button);
    return this.container;
  }
  onRemove() {
    this.container.remove();
  }
  update() {
    this.button.classList.toggle('active', state.planMode);
    this.button.setAttribute('aria-pressed', String(state.planMode));
    this.button.title = state.planMode ? 'Stop planning (P or Esc)' : 'Plan a route: click the map to add points (P)';
  }
}
const planControl = new PlanModeControl();
map.addControl(planControl, 'top-left');

function setPlanMode(on) {
  state.planMode = on;
  save();
  planControl.update();
  map.getCanvas().style.cursor = on ? 'crosshair' : '';
  map.getContainer().classList.toggle('planning', on);
  if (on) {
    closeInfoCard();
    setHover(null);
  }
  updateModeHint();
}

function updateModeHint() {
  const hint = $('mode-hint');
  hint.replaceChildren();
  const b = (t) => el('b', { textContent: t });
  if (state.planMode) {
    hint.append(
      document.createTextNode('Click the map: first the '),
      b('start'),
      document.createTextNode(', then the '),
      b('destination'),
      document.createTextNode('. Drag a point to move it, click it to remove it.'),
    );
  } else {
    hint.append(
      document.createTextNode('Click a run or lift to see details. To plan a route, press '),
      b('✏️ Plan route'),
      document.createTextNode(' (P).'),
    );
  }
}

// ---------------------------------------------------------------------------
// Points: lettered A, B, C… in route order. Click a marker to remove it; the rest are re-lettered.

const letter = (i) => (i < 26 ? String.fromCharCode(65 + i) : `${String.fromCharCode(64 + Math.floor(i / 26))}${String.fromCharCode(65 + (i % 26))}`);

function markerColor(i, n) {
  if (i === 0) return '#2e9d3a';
  if (i === n - 1 && n > 1) return '#d8251d';
  return '#1f6fd6';
}

function pointName(i, n) {
  if (i === 0) return 'Start';
  if (i === n - 1) return 'Destination';
  return 'Stop';
}

function renderPoints() {
  state.markers.forEach((m) => m.remove());
  const n = state.points.length;
  state.markers = state.points.map((p, i) => {
    const node = el('div', { className: 'marker', textContent: letter(i), title: `${pointName(i, n)}: drag to move, click to remove` });
    node.style.background = markerColor(i, n);
    const marker = new maplibregl.Marker({ element: node, draggable: true }).setLngLat(p).addTo(map);
    let dragged = false;
    marker.on('dragstart', () => {
      dragged = true;
    });
    marker.on('dragend', () => {
      const ll = marker.getLngLat();
      state.points[i] = [ll.lng, ll.lat];
      recordHistory();
      scheduleRoute();
      renderPointList();
    });
    node.addEventListener('click', (ev) => {
      ev.stopPropagation();
      if (dragged) {
        dragged = false;
        return;
      }
      removePoint(i);
    });
    return marker;
  });
  renderPointList();
}

function renderPointList() {
  const n = state.points.length;
  $('reverse').disabled = n < 2;
  $('clear').disabled = n === 0;
  $('points').replaceChildren(
    ...state.points.map((p, i) => {
      const badge = el('span', { className: 'marker mini', textContent: letter(i) });
      badge.style.background = markerColor(i, n);
      const btn = el('button', { type: 'button', title: 'Remove', textContent: '✕' });
      btn.addEventListener('click', () => removePoint(i));
      return el(
        'li',
        {},
        el('span', { className: 'point-label' }, badge, document.createTextNode(` ${pointName(i, n)} (${p[1].toFixed(4)}, ${p[0].toFixed(4)})`)),
        btn,
      );
    }),
  );
}

function addPoint(p) {
  if (state.points.length >= MAX_POINTS) {
    showError(`A route can have at most ${MAX_POINTS} points.`);
    return;
  }
  state.points.push(p);
  pointsChanged();
}

function removePoint(i) {
  state.points.splice(i, 1);
  pointsChanged();
}

function clearPoints() {
  state.points = [];
  // an empty map starts a new route (no longer linked to a saved one)
  state.savedId = null;
  state.savedSnapshot = null;
  pointsChanged();
  if (typeof renderLibrary === 'function') renderLibrary();
}

function pointsChanged() {
  renderPoints();
  recordHistory();
  scheduleRoute();
}

$('reverse').addEventListener('click', () => {
  state.points.reverse();
  pointsChanged();
});
$('clear').addEventListener('click', clearPoints);

// ---------------------------------------------------------------------------
// Undo / redo of route points and route settings (⌘Z / Ctrl+Z, ⌘Y / Ctrl+Y / ⇧⌘Z)

const MAX_HISTORY = 100;
const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
const modKey = isMac ? '⌘' : 'Ctrl+';
const undoStack = { past: [], future: [], current: null, restoring: false };

const snapshotState = () => JSON.stringify({ points: state.points, options: state.options });
undoStack.current = snapshotState();
// continue the undo/redo history from the previous visit
if (Array.isArray(stored.history?.past) && Array.isArray(stored.history?.future)) {
  const isSnap = (s) => typeof s === 'string' && s.startsWith('{');
  undoStack.past = stored.history.past.filter(isSnap);
  undoStack.future = stored.history.future.filter(isSnap);
}

function recordHistory() {
  if (undoStack.restoring) return;
  const snap = snapshotState();
  save();
  if (snap === undoStack.current) return;
  undoStack.past.push(undoStack.current);
  if (undoStack.past.length > MAX_HISTORY) undoStack.past.shift();
  undoStack.current = snap;
  undoStack.future = [];
  updateUndoButtons();
}

function restoreSnapshot(snap) {
  undoStack.restoring = true;
  try {
    const { points, options } = JSON.parse(snap);
    state.points = points;
    state.options = options;
    syncOptionsUI();
    save();
    renderPoints();
    scheduleRoute();
  } finally {
    undoStack.restoring = false;
  }
  updateUndoButtons();
}

function undo() {
  if (!undoStack.past.length) return;
  undoStack.future.push(undoStack.current);
  undoStack.current = undoStack.past.pop();
  restoreSnapshot(undoStack.current);
}

function redo() {
  if (!undoStack.future.length) return;
  undoStack.past.push(undoStack.current);
  undoStack.current = undoStack.future.pop();
  restoreSnapshot(undoStack.current);
}

function updateUndoButtons() {
  $('undo').disabled = undoStack.past.length === 0;
  $('redo').disabled = undoStack.future.length === 0;
}

$('undo').title = `Undo (${modKey}Z)`;
$('redo').title = `Redo (${modKey}${isMac ? '⇧Z' : 'Y'})`;
$('undo').addEventListener('click', undo);
$('redo').addEventListener('click', redo);
$('search-shortcut').textContent = isMac ? '⌘K' : 'Ctrl K';

const isTyping = (target) => !!target.closest?.('input, textarea, select, [contenteditable="true"]');

document.addEventListener('keydown', (e) => {
  const mod = isMac ? e.metaKey : e.ctrlKey || e.metaKey;
  // P toggles plan mode, Esc leaves it (not while typing)
  if (!mod && !e.altKey && !isTyping(e.target)) {
    if (e.key === 'p' || e.key === 'P') {
      e.preventDefault();
      setPlanMode(!state.planMode);
      return;
    }
    // Esc closes the open info card / search pin first, then leaves plan mode
    if (e.key === 'Escape') {
      if (layersControl.isOpen()) {
        layersControl.toggle(false);
        return;
      }
      if (infoPopup) {
        closeInfoCard();
        return;
      }
      if (searchPopup) {
        removeSearchPin();
        return;
      }
      if (state.planMode) {
        setPlanMode(false);
        return;
      }
    }
  }
  if (!mod || e.altKey) return;
  const key = e.key.toLowerCase();

  if (key === 'k') {
    e.preventDefault();
    searchInput.focus();
    searchInput.select();
    return;
  }

  // inside text fields keep the normal text undo/redo
  if (e.target.closest?.('input[type="text"], input[type="search"], input[type="number"], textarea, [contenteditable="true"]')) return;
  if (key === 'z' && !e.shiftKey) {
    e.preventDefault();
    undo();
  } else if ((key === 'z' && e.shiftKey) || key === 'y') {
    e.preventDefault();
    redo();
  }
});

// ---------------------------------------------------------------------------
// Search: local names, coordinates, Google Maps links, optional online search

let searchIndex = [];
const normalize = (s) =>
  String(s)
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/\p{M}/gu, '');

async function loadSearchIndex() {
  try {
    const res = await fetch(`/api/search-index?resort=${encodeURIComponent(state.resort)}`);
    searchIndex = (await res.json()).map((e) => ({ ...e, norm: normalize(e.name) }));
  } catch {
    searchIndex = [];
  }
}
loadSearchIndex();

const humanize = (s) => String(s ?? '').replaceAll('_', ' ').replace(/^\w/, (c) => c.toUpperCase());

function entrySub(e) {
  if (e.type === 'run') {
    if (e.kind === 'downhill') return `${DIFFICULTY_INFO[e.difficulty ?? 'unknown']?.label ?? 'Run'} run · pin at the top`;
    if (e.kind === 'nordic') return 'Cross-country trail';
    if (e.kind === 'connection') return 'Connection path';
    return humanize(e.kind);
  }
  if (e.type === 'lift') return `${e.kind} · pin at the bottom station`;
  const kind = PLACE_KINDS[e.kind] ?? humanize(e.kind);
  return e.elevation ? `${kind} · ${e.elevation} m` : kind;
}

function entryIcon(e) {
  if (e.type === 'run') return { text: '⛷', color: e.kind === 'downhill' ? e.color : WALK_COLOR };
  if (e.type === 'lift') return { text: '↑', color: LIFT_COLOR };
  const icons = {
    peak: '▲', saddle: '⌒', locality: '⌂', ski_area: '❄', alpine_hut: '⌂', restaurant: '🍴', cafe: '☕',
    hotel: '🛏', guest_house: '🛏', apartment: '🛏', bus_stop: '🚌', parking: 'P',
  };
  return { text: icons[e.kind] ?? '•', color: '#5b6f84' };
}

function searchLocal(query) {
  const tokens = normalize(query).split(/\s+/).filter(Boolean);
  if (!tokens.length) return [];
  const joined = tokens.join(' ');
  const scored = [];
  for (const e of searchIndex) {
    let score = 0;
    for (const t of tokens) {
      const i = e.norm.indexOf(t);
      if (i < 0) {
        score = -1;
        break;
      }
      // a match right after a piste/lift number ("30 kanzelwandbahn") counts as a match at the start
      const afterRef = i > 0 && /^[\d\s,]+$/.test(e.norm.slice(0, i));
      score += i === 0 || afterRef ? 100 : /[\s\-/(,.'\d]/.test(e.norm[i - 1]) ? 60 : 15;
    }
    if (score < 0) continue;
    if (e.norm === joined) score += 80;
    score += SEARCH_BOOST[e.type === 'place' ? e.kind : e.type] ?? 0;
    score -= e.name.length * 0.3;
    scored.push([score, e]);
  }
  scored.sort((a, b) => b[0] - a[0]);
  const seen = new Set();
  const out = [];
  for (const [, e] of scored) {
    const key = `${e.type}|${e.kind}|${e.norm}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
    if (out.length >= 10) break;
  }
  return out;
}

const searchInput = $('search');
const resultsList = $('search-results');
let searchItems = [];
let activeIndex = -1;
let searchSeq = 0;
let searchTimer = null;

function renderSearchItems(items) {
  searchItems = items;
  activeIndex = items.findIndex((it) => !it.disabled);
  resultsList.replaceChildren(
    ...items.map((it, i) => {
      const icon = el('span', { className: 'r-icon', textContent: it.icon?.text ?? '•' });
      if (it.icon?.color) icon.style.background = it.icon.color;
      const li = el(
        'li',
        { role: 'option', className: [it.disabled ? 'disabled' : '', it.error ? 'error' : '', i === activeIndex ? 'active' : ''].join(' ') },
        icon,
        el('span', { className: 'r-title', textContent: it.title }),
        el('span', { className: 'r-sub', textContent: it.sub ?? '' }),
      );
      if (!it.disabled) {
        li.addEventListener('mousedown', (ev) => ev.preventDefault());
        li.addEventListener('click', () => activateItem(it));
      }
      return li;
    }),
  );
  resultsList.hidden = items.length === 0;
}

function setActive(i) {
  const lis = resultsList.querySelectorAll('li');
  lis.forEach((li, j) => li.classList.toggle('active', j === i));
  lis[i]?.scrollIntoView({ block: 'nearest' });
  activeIndex = i;
}

function coordinateItem(lat, lon, extra = {}) {
  return {
    title: extra.title ?? `${lat.toFixed(5)}, ${lon.toFixed(5)}`,
    sub: extra.sub ?? 'Coordinates · drop a pin',
    icon: { text: '📍', color: '#ff8a00' },
    pin: { lat, lon, title: extra.title ?? 'Coordinates', sub: extra.pinSub ?? null, approximate: extra.approximate },
  };
}

function onlineItem(text) {
  return {
    title: `Search “${text}” online`,
    sub: 'OpenStreetMap Nominatim · needs internet',
    icon: { text: '🌐', color: '#5b6f84' },
    online: text,
  };
}

async function runSearch(immediate = false) {
  const text = searchInput.value.trim();
  const seq = ++searchSeq;
  if (!text) {
    renderSearchItems([]);
    return;
  }

  const coords = parseCoordinates(text);
  if (coords) {
    renderSearchItems([coordinateItem(coords.lat, coords.lon)]);
    return;
  }

  if (isGoogleMapsLink(text)) {
    const local = isShortLink(text) ? null : parseGoogleMapsUrl(text);
    if (local?.lat != null && local.precise) {
      renderSearchItems([googleItem(local)]);
      return;
    }
    renderSearchItems([{ title: 'Resolving Google Maps link…', sub: 'Following the link to find its location', disabled: true, icon: { text: '…' } }]);
    try {
      const res = await fetch(`/api/resolve?resort=${encodeURIComponent(state.resort)}&url=${encodeURIComponent(text)}`);
      const body = await res.json();
      if (seq !== searchSeq) return;
      if (!res.ok) throw new Error(body.error ?? res.statusText);
      const item = googleItem(body);
      renderSearchItems([item]);
      if (immediate) activateItem(item);
    } catch (err) {
      if (seq !== searchSeq) return;
      if (local?.lat != null) renderSearchItems([googleItem(local)]);
      else renderSearchItems([{ title: 'Could not resolve this link', sub: err.message, disabled: true, error: true, icon: { text: '!', color: '#c0392b' } }]);
    }
    return;
  }

  const items = searchLocal(text).map((e) => ({
    title: e.name,
    sub: entrySub(e),
    icon: entryIcon(e),
    pin: { lat: e.coordinates[1], lon: e.coordinates[0], title: e.name, sub: entrySub(e).split(' · pin')[0], lines: e.lines },
  }));
  if (text.length >= 3) items.push(onlineItem(text));
  if (!items.length) items.push({ title: 'No matches', sub: 'Try another name, coordinates or a Google Maps link', disabled: true });
  renderSearchItems(items);
}

function googleItem(r) {
  const title = r.label || r.query || 'Google Maps location';
  let sub = `Google Maps · ${r.lat.toFixed(5)}, ${r.lon.toFixed(5)}`;
  let note = null;
  if (r.source === 'nominatim') {
    sub = 'Address from the link, located with OpenStreetMap';
    note = 'Approximate: the link had no coordinates, so the address was looked up in OpenStreetMap.';
  } else if (r.approximate || r.precise === false) {
    note = 'Approximate: taken from the map view of the link.';
  }
  return coordinateItem(r.lat, r.lon, { title, sub, pinSub: r.query && r.query !== title ? r.query : 'Google Maps link', approximate: note });
}

async function activateItem(it) {
  if (it.disabled) return;
  if (it.online) {
    const seq = ++searchSeq;
    renderSearchItems([{ title: 'Searching online…', disabled: true, icon: { text: '…' } }]);
    try {
      const res = await fetch(`/api/geocode?resort=${encodeURIComponent(state.resort)}&q=${encodeURIComponent(it.online)}`);
      const hits = await res.json();
      if (seq !== searchSeq) return;
      if (!res.ok) throw new Error(hits.error ?? res.statusText);
      renderSearchItems(
        hits.length
          ? hits.map((h) => ({
              title: h.name,
              sub: h.sub,
              icon: { text: '🌐', color: '#5b6f84' },
              pin: { lat: h.lat, lon: h.lon, title: h.name, sub: h.sub },
            }))
          : [{ title: 'Nothing found online', disabled: true }],
      );
    } catch (err) {
      if (seq !== searchSeq) return;
      renderSearchItems([{ title: 'Online search failed', sub: err.message, disabled: true, error: true }]);
    }
    return;
  }
  if (it.pin) {
    renderSearchItems([]);
    searchInput.blur();
    dropSearchPin(it.pin);
  }
}

searchInput.addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => runSearch(false), 150);
});
searchInput.addEventListener('paste', () => {
  clearTimeout(searchTimer);
  setTimeout(() => runSearch(true), 0);
});
searchInput.addEventListener('focus', () => {
  if (searchInput.value.trim() && searchItems.length) resultsList.hidden = false;
});
searchInput.addEventListener('blur', () => {
  setTimeout(() => {
    resultsList.hidden = true;
  }, 150);
});
searchInput.addEventListener('keydown', (e) => {
  const enabled = searchItems.map((it, i) => (it.disabled ? -1 : i)).filter((i) => i >= 0);
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    if (!enabled.length) return;
    const pos = enabled.indexOf(activeIndex);
    const next = e.key === 'ArrowDown' ? enabled[(pos + 1) % enabled.length] : enabled[(pos - 1 + enabled.length) % enabled.length];
    setActive(next);
  } else if (e.key === 'Enter') {
    e.preventDefault();
    clearTimeout(searchTimer);
    if (searchItems[activeIndex]) activateItem(searchItems[activeIndex]);
    else runSearch(true);
  } else if (e.key === 'Escape') {
    resultsList.hidden = true;
    searchInput.blur();
  }
});

// Search pin with "use as start / destination / stop" actions

let searchPin = null;
let searchPopup = null;

function removeSearchPin() {
  searchPopup?.remove();
  searchPin?.remove();
  searchPopup = null;
  searchPin = null;
  map.getSource('search-highlight')?.setData(EMPTY);
}

// Buttons to use a location as start / destination / stop, depending on how many points exist.
function pinActions(p, after = () => {}) {
  const n = state.points.length;
  const use = (fn) => () => {
    fn();
    after();
    pointsChanged();
  };
  const actions = [];
  if (n === 0) {
    actions.push(['Start here', use(() => state.points.push(p)), true]);
  } else if (n === 1) {
    actions.push(['Go here (destination)', use(() => state.points.push(p)), true]);
    actions.push(['Replace start', use(() => (state.points[0] = p))]);
  } else {
    actions.push(['Set as destination', use(() => (state.points[n - 1] = p)), true]);
    actions.push(['Add as stop', use(() => state.points.splice(n - 1, 0, p))]);
    actions.push(['Add after destination', use(() => state.points.push(p))]);
    actions.push(['Replace start', use(() => (state.points[0] = p))]);
  }
  return actions;
}

function dropSearchPin(pin) {
  removeSearchPin();
  const p = [pin.lon, pin.lat];

  const actionsBox = el('div', { className: 'p-actions' });
  const content = el(
    'div',
    {},
    el('h3', { textContent: pin.title ?? 'Pin' }),
    ...(pin.sub ? [el('div', { className: 'p-sub', textContent: pin.sub })] : []),
    el('div', { className: 'p-coords', textContent: `${pin.lat.toFixed(5)}, ${pin.lon.toFixed(5)}` }),
    ...(pin.approximate ? [el('div', { className: 'p-note', textContent: pin.approximate })] : []),
    actionsBox,
  );
  const renderActions = () => {
    const done = () => {
      removeSearchPin();
      searchInput.value = '';
    };
    actionsBox.replaceChildren(
      ...pinActions(p, done).map(([label, fn, primary]) => {
        const b = el('button', { type: 'button', textContent: label, className: primary ? 'primary' : '' });
        b.addEventListener('click', fn);
        return b;
      }),
    );
  };
  renderActions();

  searchPopup = new maplibregl.Popup({ className: 'pin-popup', closeOnClick: false, offset: [0, -34], maxWidth: '300px' })
    .setDOMContent(content);
  searchPopup.on('close', () => {
    if (searchPopup) removeSearchPin();
  });
  const node = el('div', { className: 'search-pin', title: pin.title ?? '' });
  node.addEventListener('click', (ev) => {
    ev.stopPropagation();
    renderActions();
    if (!searchPopup.isOpen()) searchPopup.addTo(map);
  });
  searchPin = new maplibregl.Marker({ element: node, anchor: 'bottom', offset: [0, -4] }).setLngLat(p).setPopup(searchPopup).addTo(map);
  searchPin.togglePopup();

  if (pin.lines?.length) {
    map.getSource('search-highlight')?.setData({
      type: 'FeatureCollection',
      features: pin.lines.map((l) => ({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: l } })),
    });
    const b = new maplibregl.LngLatBounds();
    pin.lines.flat().forEach((c) => b.extend(c));
    b.extend(p);
    map.fitBounds(b, { padding: 90, maxZoom: 16 });
  } else {
    map.flyTo({ center: p, zoom: Math.max(map.getZoom(), 15) });
  }
}

// ---------------------------------------------------------------------------
// Info cards for map elements

const LIFT_TYPE_NAMES = {
  gondola: 'Gondola', cable_car: 'Cable car', mixed_lift: 'Gondola/chair combo', chair_lift: 'Chairlift',
  funicular: 'Funicular', railway: 'Railway', rack_railway: 'Rack railway', 't-bar': 'T-bar', 'j-bar': 'J-bar',
  platter: 'Platter lift', drag_lift: 'Drag lift', rope_tow: 'Rope tow', magic_carpet: 'Magic carpet', zip_line: 'Zip line',
};
const GROOMING = {
  classic: 'Classic track', skating: 'Skating', 'classic+skating': 'Classic + skating', mogul: 'Moguls',
  backcountry: 'Not groomed (backcountry)', scooter: 'Snowmobile track',
};
const RUN_KINDS = { nordic: 'Cross-country trail', connection: 'Connection path', skitour: 'Ski touring route', sled: 'Sled run', hike: 'Winter hiking trail' };

// Interactive layers, in click priority order. Ski layers come from the tile server style, the rest from the basemap.
const INTERACTIVE = [
  ['ski-lift-stations', 0], ['ski-lifts', 1], ['ski-lifts-drag', 1], ['ski-lifts-label', 1],
  ['ski-runs-downhill', 2], ['ski-runs-slope', 2], ['ski-runs-freeride', 2], ['ski-runs-expert-center', 2], ['ski-runs-connection', 2],
  ['ski-runs-nordic', 2], ['ski-runs-other', 2], ['ski-runs-label', 2], ['ski-run-areas', 3],
  ['pois', 4], ['places_locality', 5], ['places_subplace', 5],
];
const PRIORITY = Object.fromEntries(INTERACTIVE);

function pickFeature(point) {
  const layers = INTERACTIVE.map(([id]) => id).filter((id) => map.getLayer(id));
  if (!layers.length) return null;
  const pad = 5;
  const found = map.queryRenderedFeatures([[point.x - pad, point.y - pad], [point.x + pad, point.y + pad]], { layers });
  const usable = found.filter((f) => f.source === 'ski' ? f.properties.id : f.properties.name);
  usable.sort((a, b) => PRIORITY[a.layer.id] - PRIORITY[b.layer.id]);
  return usable[0] ?? null;
}

// Vector tiles cut lines at tile edges, so a rendered feature is only the piece inside one tile.
// Collect every loaded piece with the same OpenSkiData id to highlight the whole run or lift.
// For runs, also include the other sections of the same piste (grouped by the build: same name and piste
// number, one section continuing where the other ends).
function wholeGeometry(f) {
  if (f.source !== 'ski' || !f.properties.id || f.geometry.type === 'Point') return f.geometry;
  let pieces;
  if (f.sourceLayer === 'run_slopes') {
    pieces = map.querySourceFeatures('ski', { sourceLayer: 'runs', filter: ['==', ['get', 'id'], f.properties.id] });
    const named = pieces.find((p) => p.properties.name);
    if (named) return wholeGeometry({ ...named, source: 'ski', sourceLayer: 'runs', geometry: named.geometry });
  } else if (f.sourceLayer === 'runs' && f.properties.piste) {
    pieces = map.querySourceFeatures('ski', {
      sourceLayer: 'runs',
      filter: ['in', `|${f.properties.piste}|`, ['coalesce', ['get', 'pistes'], '']],
    });
  } else {
    pieces = map.querySourceFeatures('ski', { sourceLayer: f.sourceLayer, filter: ['==', ['get', 'id'], f.properties.id] });
  }
  const lines = [];
  const polygons = [];
  for (const p of pieces) {
    const g = p.geometry;
    if (g.type === 'LineString') lines.push(g.coordinates);
    else if (g.type === 'MultiLineString') lines.push(...g.coordinates);
    else if (g.type === 'Polygon') polygons.push(g.coordinates);
    else if (g.type === 'MultiPolygon') polygons.push(...g.coordinates);
  }
  if (polygons.length) return { type: 'MultiPolygon', coordinates: polygons };
  if (lines.length) return { type: 'MultiLineString', coordinates: lines };
  return f.geometry;
}

const featureKey = (f) => (f ? `${f.source}:${f.properties.id ?? f.properties.name}:${f.layer.id}` : null);
let hoverKey = null;
function setHover(f) {
  const key = featureKey(f);
  if (key === hoverKey) return;
  hoverKey = key;
  map.getSource('hover-highlight')?.setData(f ? { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: wholeGeometry(f) }] } : EMPTY);
}

let infoPopup = null;
// geometry: the clicked element; piste (optional): the whole named piste, drawn lighter underneath
function setInfoHighlight(geometry, piste = null) {
  const features = [];
  if (piste) features.push({ type: 'Feature', properties: { part: 'piste' }, geometry: piste });
  if (geometry) features.push({ type: 'Feature', properties: { part: 'section' }, geometry });
  map.getSource('info-highlight')?.setData(features.length ? { type: 'FeatureCollection', features } : EMPTY);
}

// Pan the map just enough to show the whole card (its content arrives after the popup opened).
function keepPopupVisible(popup) {
  requestAnimationFrame(() => {
    const box = popup.getElement()?.getBoundingClientRect();
    if (!box) return;
    const view = map.getContainer().getBoundingClientRect();
    const margin = 12;
    const attribution = map.getContainer().querySelector('.maplibregl-ctrl-bottom-right')?.getBoundingClientRect();
    const bottomMargin = Math.max(margin, attribution ? view.bottom - attribution.top + 8 : 0);
    let dx = 0;
    let dy = 0;
    if (box.bottom > view.bottom - bottomMargin) dy = box.bottom - view.bottom + bottomMargin;
    if (box.top - dy < view.top + margin) dy = box.top - view.top - margin;
    if (box.right > view.right - margin) dx = box.right - view.right + margin;
    if (box.left - dx < view.left + margin) dx = box.left - view.left - margin;
    if (dx || dy) map.panBy([dx, dy], { duration: 300 });
  });
}

function closeInfoCard() {
  const p = infoPopup;
  infoPopup = null;
  p?.remove();
  setInfoHighlight(null);
}

async function openInfoCard(feature, lngLat) {
  closeInfoCard();
  const clicked = [lngLat.lng, lngLat.lat];
  const popup = new maplibregl.Popup({ className: 'info-card', maxWidth: '340px', closeOnClick: false, offset: 12, focusAfterOpen: false })
    .setLngLat(lngLat)
    .setDOMContent(el('div', { className: 'card-loading', textContent: 'Loading…' }))
    .addTo(map);
  infoPopup = popup;
  popup.on('close', () => {
    if (infoPopup === popup) {
      infoPopup = null;
      setInfoHighlight(null);
    }
  });

  if (feature.source !== 'ski') {
    setInfoHighlight(feature.geometry);
    popup.setDOMContent(placeCard(feature.properties, clicked));
    keepPopupVisible(popup);
    return;
  }
  setInfoHighlight(feature.geometry);
  try {
    const res = await fetch(`/api/feature?resort=${encodeURIComponent(state.resort)}&id=${encodeURIComponent(feature.properties.id)}`);
    const details = await res.json();
    if (infoPopup !== popup) return;
    if (!res.ok) throw new Error(details.error ?? res.statusText);
    setInfoHighlight({ type: details.geometry.type, coordinates: details.geometry.coordinates }, details.piste?.geometry ?? null);
    popup.setDOMContent(skiCard(details, clicked));
  } catch {
    if (infoPopup !== popup) return;
    popup.setDOMContent(skiCardFromTile(feature.properties, clicked));
  }
  keepPopupVisible(popup);
}

const fmtKm = (m) => (m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${Math.round(m)} m`);
const fmtSlope = (s) => `${Math.round((Math.atan(s) * 180) / Math.PI)}° (${Math.round(s * 100)}%)`;
const safeUrl = (u) => {
  try {
    const url = new URL(u);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
};

function sourceLink(s) {
  if (s.type === 'openstreetmap') {
    const [kind, id] = s.id.split('/');
    if (['way', 'node', 'relation'].includes(kind) && /^\d+$/.test(id)) return ['OpenStreetMap', `https://www.openstreetmap.org/${kind}/${id}`];
  }
  if (s.type === 'skimap.org' && /^\d+$/.test(s.id)) return ['Skimap.org', `https://skimap.org/SkiAreas/view/${s.id}`];
  return null;
}

function cardActions(p) {
  const box = el('div', { className: 'card-actions' }, el('div', { className: 'card-actions-label', textContent: 'Use this spot in your route' }));
  const row = el('div', { className: 'card-actions-row' });
  for (const [label, fn, primary] of pinActions(p, closeInfoCard)) {
    const b = el('button', { type: 'button', textContent: label, className: primary ? 'primary' : '' });
    b.addEventListener('click', fn);
    row.append(b);
  }
  box.append(row);
  return box;
}

function cardHeader({ crumbs, badge, badgeColor, title, subtitle, subtitleColor }) {
  const head = el('div', { className: 'card-head' });
  if (crumbs?.length) head.append(el('div', { className: 'card-crumbs', textContent: crumbs.join(' › ') }));
  const h = el('h3', { className: 'card-title' });
  if (badge) {
    const b = el('span', { className: 'card-badge', textContent: badge });
    b.style.background = badgeColor;
    h.append(b);
  }
  h.append(document.createTextNode(title));
  head.append(h);
  if (subtitle) {
    const s = el('div', { className: 'card-subtitle', textContent: subtitle });
    if (subtitleColor) s.style.color = subtitleColor;
    head.append(s);
  }
  return head;
}

function statsGrid(rows) {
  const dl = el('dl', { className: 'card-stats' });
  for (const [k, v] of rows) if (v != null && v !== '') dl.append(el('dt', { textContent: k }), el('dd', { textContent: v }));
  return dl;
}

// Steepness classes used to colour the slices of a run profile (approximate European piste guidelines).
// keep in sync with packages/core/src/slope.ts
const SLOPE_CLASSES = [
  { id: 'green', max: 0.1, color: '#2e9d3a', label: '< 10%', name: 'green' },
  { id: 'blue', max: 0.25, color: '#1f6fd6', label: '10–25%', name: 'blue' },
  { id: 'red', max: 0.4, color: '#d8251d', label: '25–40%', name: 'red' },
  { id: 'black', max: Infinity, color: '#111111', label: '> 40%', name: 'black' },
];
const OFFICIAL_CLASS = { novice: 'green', easy: 'blue', intermediate: 'red', advanced: 'black', expert: 'black' };
const slopeClass = (s) => SLOPE_CLASSES.find((c) => s < c.max);

function niceStep(range, maxTicks = 5) {
  for (const step of [5, 10, 20, 25, 50, 100, 200, 250, 500, 1000]) if (range / step <= maxTicks) return step;
  return 2000;
}

// Elevation profile: rounded elevation gridlines, a distance axis, a hover crosshair, and for runs
// each slice filled with the colour matching its steepness (like OpenSkiMap).
function profileSvg(profile, color, { slopeColors = false } = {}) {
  const ns = 'http://www.w3.org/2000/svg';
  const W = 300;
  const H = 120;
  const pad = { left: 46, right: 8, top: 8, bottom: 22 };
  const plotW = W - pad.left - pad.right;
  const plotH = H - pad.top - pad.bottom;

  const eles = profile.map((p) => p[1]);
  const total = profile.at(-1)[0] || 1;
  const rawMin = Math.min(...eles);
  const rawMax = Math.max(...eles);
  const step = niceStep(Math.max(rawMax - rawMin, 10));
  const min = Math.floor(rawMin / step) * step;
  const max = Math.max(Math.ceil(rawMax / step) * step, min + step);
  const x = (d) => pad.left + (d / total) * plotW;
  const y = (e) => pad.top + plotH - ((e - min) / (max - min)) * plotH;

  const node = (tag, attrs, text) => {
    const n = document.createElementNS(ns, tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    if (text != null) n.textContent = text;
    return n;
  };

  const svg = node('svg', { viewBox: `0 0 ${W} ${H}`, class: 'card-profile', role: 'img', 'aria-label': `Elevation profile from ${Math.round(eles[0])} m to ${Math.round(eles.at(-1))} m` });
  const line = profile.map((p, i) => `${i ? 'L' : 'M'}${x(p[0]).toFixed(1)},${y(p[1]).toFixed(1)}`).join(' ');
  const baseY = pad.top + plotH;

  // elevation gridlines + labels
  for (let e = min; e <= max + 0.01; e += step) {
    const gy = y(e);
    svg.append(node('line', { x1: pad.left, x2: W - pad.right, y1: gy, y2: gy, class: 'prof-grid' }));
    svg.append(node('text', { x: pad.left - 6, y: gy, class: 'prof-label prof-label-y' }, `${e} m`));
  }

  // slices of roughly equal length, each with its own steepness
  const slices = [];
  if (slopeColors) {
    const spacing = total / (profile.length - 1);
    const k = Math.max(1, Math.round(Math.max(30, total / 40) / spacing));
    for (let i = 0; i < profile.length - 1; i += k) {
      const j = Math.min(i + k, profile.length - 1);
      const run = profile[j][0] - profile[i][0];
      const slope = run > 0 ? Math.abs(profile[j][1] - profile[i][1]) / run : 0;
      slices.push({ i, j, d0: profile[i][0], d1: profile[j][0], slope, cls: slopeClass(slope) });
    }
    for (const s of slices) {
      const pts = profile.slice(s.i, s.j + 1);
      const top = pts.map((p, n) => `${n ? 'L' : 'M'}${x(p[0]).toFixed(1)},${y(p[1]).toFixed(1)}`).join(' ');
      svg.append(node('path', { d: `${top} L${x(s.d1).toFixed(1)},${baseY} L${x(s.d0).toFixed(1)},${baseY} Z`, fill: s.cls.color, 'fill-opacity': '0.72' }));
    }
    svg.append(node('path', { d: line, fill: 'none', stroke: '#5f6b75', 'stroke-width': '1.4', 'stroke-linejoin': 'round' }));
  } else {
    svg.append(node('path', { d: `${line} L${x(total)},${baseY} L${x(0)},${baseY} Z`, fill: color, 'fill-opacity': '0.14' }));
    svg.append(node('path', { d: line, fill: 'none', stroke: color, 'stroke-width': '2.2', 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
  }

  // distance axis
  svg.append(node('line', { x1: pad.left, x2: W - pad.right, y1: baseY, y2: baseY, class: 'prof-axis' }));
  for (const [d, anchor] of [[0, 'start'], [total / 2, 'middle'], [total, 'end']]) {
    svg.append(node('text', { x: x(d), y: H - 6, class: 'prof-label', 'text-anchor': anchor }, d === 0 ? '0' : fmtKm(d)));
  }

  // hover readout
  const cross = node('line', { y1: pad.top, y2: baseY, class: 'prof-cross', visibility: 'hidden' });
  const dot = node('circle', { r: 3.5, fill: '#fff', stroke: color, 'stroke-width': 2, visibility: 'hidden' });
  const tip = node('text', { y: pad.top + 2, class: 'prof-tip', visibility: 'hidden' });
  svg.append(cross, dot, tip);
  const hit = node('rect', { x: pad.left, y: pad.top, width: plotW, height: plotH, fill: 'transparent' });
  svg.append(hit);
  hit.addEventListener('mousemove', (ev) => {
    const box = svg.getBoundingClientRect();
    const px = ((ev.clientX - box.left) / box.width) * W;
    const d = Math.min(total, Math.max(0, ((px - pad.left) / plotW) * total));
    let i = 1;
    while (i < profile.length - 1 && profile[i][0] < d) i++;
    const [d0, e0] = profile[i - 1];
    const [d1, e1] = profile[i];
    const e = e0 + (e1 - e0) * ((d - d0) / (d1 - d0 || 1));
    const cx = x(d);
    cross.setAttribute('x1', cx);
    cross.setAttribute('x2', cx);
    dot.setAttribute('cx', cx);
    dot.setAttribute('cy', y(e));
    const slice = slices.find((s) => d >= s.d0 && d <= s.d1);
    tip.textContent = `${Math.round(e)} m · ${fmtKm(d)}${slice ? ` · ${Math.round(slice.slope * 100)}%` : ''}`;
    const right = cx > pad.left + plotW / 2;
    tip.setAttribute('x', right ? cx - 6 : cx + 6);
    tip.setAttribute('text-anchor', right ? 'end' : 'start');
    for (const n of [cross, dot, tip]) n.setAttribute('visibility', 'visible');
  });
  hit.addEventListener('mouseleave', () => {
    for (const n of [cross, dot, tip]) n.setAttribute('visibility', 'hidden');
  });

  const wrap = el('div', { className: 'card-profile-wrap' }, svg);
  if (slices.length) {
    const used = SLOPE_CLASSES.filter((c) => slices.some((s) => s.cls === c));
    const legend = el('div', { className: 'prof-legend' }, el('span', { className: 'prof-legend-title', textContent: 'Steepness:' }));
    for (const c of used) {
      const sw = el('span', { className: 'swatch' });
      sw.style.background = c.color;
      legend.append(el('span', { className: 'prof-legend-item' }, sw, document.createTextNode(c.label)));
    }
    wrap.append(legend);
  }
  return wrap;
}

function tagList(tags) {
  const box = el('div', { className: 'card-tags' });
  for (const t of tags) if (t) box.append(el('span', { className: 'chip', textContent: t }));
  return box;
}

function linkList(pr) {
  const links = [];
  for (const s of pr.sources ?? []) {
    const l = sourceLink(s);
    if (l && !links.some(([, href]) => href === l[1])) links.push(l);
  }
  for (const w of pr.websites ?? []) {
    const href = safeUrl(w);
    if (href) links.push(['Website', href]);
  }
  if (pr.wikidataID && /^Q\d+$/.test(pr.wikidataID)) links.push(['Wikidata', `https://www.wikidata.org/wiki/${pr.wikidataID}`]);
  if (!links.length) return null;
  const box = el('div', { className: 'card-links' }, document.createTextNode('Source & links: '));
  links.forEach(([label, href], i) => {
    if (i) box.append(document.createTextNode(' · '));
    box.append(el('a', { href, target: '_blank', rel: 'noopener noreferrer', textContent: label }));
  });
  return box;
}

function verticalText(st) {
  if (st.vertical == null) return null;
  return `${Math.round(st.vertical)} m (${Math.round(st.minEle)} – ${Math.round(st.maxEle)} m)`;
}

const LIFT_DIRECTION = {
  up: 'Up only ›',
  both: 'Both ways ‹ ›',
  unknown: 'Up › (riding down not specified in the data)',
};

function liftRows(lp, st) {
  return [
    ['Direction', LIFT_DIRECTION[lp.direction] ?? null],
    ['Distance', st.length != null ? fmtKm(st.length) : null],
    ['Vertical', verticalText(st)],
    ['Ride time', st.duration ? `${Math.round(st.duration / 60)} min` : null],
    ['Speed', st.speed ? `${st.speed.toFixed(1)} m/s` : null],
    ['Vertical speed', st.verticalSpeed ? `${Math.round(st.verticalSpeed)} m/min` : null],
    ['Slope (average)', st.avgSlope != null ? fmtSlope(st.avgSlope) : null],
    ['Capacity', lp.capacity ? `${lp.capacity} people/hour` : null],
    ['Status', lp.status && lp.status !== 'operating' ? humanize(lp.status) : null],
  ];
}

function liftTitle(lp) {
  const type = LIFT_TYPE_NAMES[lp.liftType] ?? humanize(lp.liftType ?? 'lift');
  const name = lp.name || `Unnamed ${type.toLowerCase()}`;
  return `${name} (${lp.occupancy ? `${lp.occupancy}p ` : ''}${type})`;
}

function crumbsFor(pr) {
  const areas = (pr.skiAreas ?? []).map((a) => a.name).filter(Boolean).join(' / ');
  return [pr.place?.country, pr.place?.region, areas].filter(Boolean);
}

function skiCard(d, clicked) {
  const pr = d.properties;
  const st = d.stats ?? {};
  const card = el('div', { className: 'card' });

  if (d.type === 'lift' || d.type === 'spot') {
    const lp = d.type === 'lift' ? pr : { ...d.lift, name: d.lift?.label };
    if (d.type === 'spot') {
      const pos = { bottom: 'Bottom station', top: 'Top station', middle: 'Middle station' }[pr.position] ?? 'Lift station';
      const access = [pr.entry === true ? 'boarding' : pr.entry === false ? 'no boarding' : null, pr.exit === true ? 'exit' : pr.exit === false ? 'no exit' : null]
        .filter(Boolean)
        .join(', ');
      card.append(
        cardHeader({
          crumbs: crumbsFor(pr),
          badge: '●',
          badgeColor: LIFT_COLOR,
          title: pr.name || pos,
          subtitle: `${pos}${d.lift ? ` of ${d.lift.label}` : ''}${access ? ` · ${access}` : ''}`,
        }),
      );
      if (d.lift) card.append(statsGrid(liftRows(d.lift, st)));
    } else {
      card.append(cardHeader({ crumbs: crumbsFor(pr), badge: pr.ref, badgeColor: LIFT_COLOR, title: liftTitle(lp) }));
      card.append(statsGrid(liftRows(pr, st)));
      card.append(tagList([pr.bubble && 'Bubble', pr.heating && 'Heated seats', pr.detachable && 'Detachable', pr.access && `Access: ${pr.access}`]));
    }
    if (st.profile) card.append(profileSvg(st.profile, LIFT_COLOR));
  } else {
    const isDownhill = pr.kind === 'downhill';
    const diff = DIFFICULTY_INFO[pr.difficulty ?? 'unknown'];
    const color = isDownhill ? pr.color ?? diff?.color : WALK_COLOR;
    card.append(
      cardHeader({
        crumbs: crumbsFor(pr),
        badge: pr.ref,
        badgeColor: color,
        title: pr.name || (isDownhill ? 'Unnamed run' : RUN_KINDS[pr.kind] ?? 'Unnamed trail'),
        subtitle: isDownhill ? `${diff?.label ?? 'Run'} run` : RUN_KINDS[pr.kind] ?? humanize(pr.kind),
        subtitleColor: isDownhill && pr.difficulty !== 'advanced' && pr.difficulty !== 'expert' ? color : null,
      }),
    );
    card.append(
      statsGrid([
        ['Distance', st.length != null ? fmtKm(st.length) : null],
        ['Vertical', verticalText(st)],
        ['Slope (average)', st.avgSlope != null ? fmtSlope(st.avgSlope) : null],
        ['Steepest section', st.maxSlope != null ? fmtSlope(st.maxSlope) : null],
        ['Grooming', pr.grooming ? GROOMING[pr.grooming] ?? humanize(pr.grooming) : null],
        ['Status', pr.status && pr.status !== 'operating' ? humanize(pr.status) : null],
      ]),
    );
    card.append(
      tagList([
        pr.oneway === true && 'One-way',
        pr.lit && 'Lit at night',
        pr.snowmaking && 'Snowmaking',
        pr.gladed && 'Through trees',
        pr.patrolled && 'Patrolled',
      ]),
    );
    // compare the official colour with what the gradient suggests (steepest ~30 m section)
    const official = OFFICIAL_CLASS[pr.difficulty];
    if (isDownhill && official && st.maxSlope != null) {
      const measured = slopeClass(st.maxSlope);
      if (measured.id !== official) {
        const order = SLOPE_CLASSES.map((c) => c.id);
        const easier = order.indexOf(measured.id) < order.indexOf(official);
        const pct = Math.round(st.maxSlope * 100);
        const note = el('div', { className: `card-gradient ${easier ? 'easier' : 'steeper'}` });
        note.textContent = easier
          ? `Marked ${official}, but the steepest section is only ${pct}%: by gradient this is a ${measured.name} run.`
          : `Steeper than marked: the steepest section is ${pct}%, which is ${measured.name} by gradient.`;
        card.append(note);
      }
    }
    if (d.piste) {
      const diffs = d.piste.difficulties.map((x) => (DIFFICULTY_INFO[x]?.label ?? x).split(' ')[0].toLowerCase()).join(' / ');
      card.append(
        el('div', {
          className: 'card-piste',
          textContent: `This is one section of ${d.piste.name}: ${d.piste.sections} sections · ${fmtKm(d.piste.length)} in total · ${diffs}. The numbers on this card are for this section only.`,
        }),
      );
    }
    if (st.profile) card.append(profileSvg(st.profile, color, { slopeColors: true }));
    if (pr.description) card.append(el('p', { className: 'card-desc', textContent: pr.description }));
  }

  const links = linkList(pr);
  if (links) card.append(links);
  card.append(cardActions(clicked));
  return card;
}

// Fallback when the planner has no details for a feature (e.g. data from another build).
function skiCardFromTile(pr, clicked) {
  const card = el('div', { className: 'card' });
  const isLift = Boolean(pr.liftType);
  card.append(
    cardHeader({
      badge: pr.ref,
      badgeColor: isLift ? LIFT_COLOR : pr.color ?? WALK_COLOR,
      title: isLift ? liftTitle(pr) : pr.name || 'Unnamed run',
      subtitle: isLift ? null : DIFFICULTY_INFO[pr.difficulty ?? 'unknown']?.label,
    }),
  );
  card.append(cardActions(clicked));
  return card;
}

function placeCard(pr, clicked) {
  const card = el('div', { className: 'card' });
  const kind = PLACE_KINDS[pr.kind] ?? humanize(pr.kind ?? 'Place');
  card.append(cardHeader({ title: pr.name, subtitle: pr.elevation ? `${kind} · ${Math.round(pr.elevation)} m` : kind }));
  card.append(cardActions(clicked));
  return card;
}

// ---------------------------------------------------------------------------
// Routing

let timer = null;
let requestId = 0;
function scheduleRoute() {
  clearTimeout(timer);
  timer = setTimeout(computeRoute, 150);
}

function showError(msg) {
  $('error').hidden = !msg;
  $('error').textContent = msg ?? '';
}

function haversine(a, b) {
  const R = 6371008.8;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b[1] - a[1]);
  const dLon = toRad(b[0] - a[0]);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

const fmtMarker = (m) => (m < 1000 ? `${m} m` : `${(m / 1000).toFixed(m % 1000 === 0 ? 0 : 1)} km`);

// Points every N metres along the whole route, N chosen so there are at most ~12 markers.
function distanceMarkers(coords) {
  let total = 0;
  for (let i = 1; i < coords.length; i++) total += haversine(coords[i - 1], coords[i]);
  const step = [100, 250, 500, 1000, 2000, 5000].find((s) => total / s <= 12) ?? 10000;
  const features = [];
  let travelled = 0;
  let next = step;
  for (let i = 1; i < coords.length && next < total; i++) {
    const a = coords[i - 1];
    const b = coords[i];
    const d = haversine(a, b);
    while (d > 0 && travelled + d >= next && next < total) {
      const t = (next - travelled) / d;
      features.push({
        type: 'Feature',
        properties: { label: fmtMarker(next) },
        geometry: { type: 'Point', coordinates: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t] },
      });
      next += step;
    }
    travelled += d;
  }
  return features;
}

function setRouteData(result) {
  const features = (result?.steps ?? []).map((s, i) => ({
    type: 'Feature',
    properties: {
      index: i,
      type: s.type,
      color: s.type === 'lift' ? LIFT_COLOR : s.type === 'walk' ? WALK_COLOR : s.runKind === 'downhill' ? s.color : WALK_COLOR,
    },
    geometry: { type: 'LineString', coordinates: s.coordinates.map((c) => [c[0], c[1]]) },
  }));
  map.getSource('route')?.setData({ type: 'FeatureCollection', features });
  map.getSource('route-highlight')?.setData(EMPTY);
  map.getSource('route-distances')?.setData({
    type: 'FeatureCollection',
    features: result ? distanceMarkers(result.coordinates.map((c) => [c[0], c[1]])) : [],
  });
}

async function computeRoute() {
  const id = ++requestId;
  if (state.points.length < 2) {
    state.result = null;
    $('result').hidden = true;
    showError(null);
    setRouteData(null);
    return;
  }
  try {
    const res = await fetch('/api/route', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resort: state.resort, points: state.points, options: state.options, name: $('route-name').value }),
    });
    const body = await res.json();
    if (id !== requestId) return;
    if (!res.ok) throw new Error(body.error ?? res.statusText);
    state.result = body;
    showError(null);
    renderResult(body);
    setRouteData(body);
  } catch (err) {
    if (id !== requestId) return;
    state.result = null;
    $('result').hidden = true;
    setRouteData(null);
    showError(err.message);
  }
}

const fmtDist = (m) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`);
const fmtTime = (s) => {
  const min = Math.round(s / 60);
  return min >= 60 ? `${Math.floor(min / 60)} h ${min % 60} min` : `${Math.max(1, min)} min`;
};

function stepTitle(s) {
  if (s.type === 'lift') return `${s.down ? 'Ride down' : 'Take'} ${s.label}`;
  if (s.type === 'walk') return 'Walk';
  if (s.runKind === 'connection') return `Follow ${s.label === 'Unnamed run' ? 'the ski path' : s.label}`;
  if (s.runKind === 'connector') return 'Short connection';
  return `Ski ${s.label}`;
}

function stepMeta(s) {
  const parts = [];
  if (s.type === 'run' && s.runKind === 'downhill') parts.push(DIFFICULTY_INFO[s.difficulty]?.label ?? s.difficulty);
  if (s.type === 'lift') parts.push(String(s.liftType ?? 'lift').replaceAll('_', ' '));
  parts.push(fmtDist(s.distance));
  const dz = Math.round(s.eleEnd - s.eleStart);
  if (Math.abs(dz) >= 5) parts.push(`${dz > 0 ? '↑' : '↓'} ${Math.abs(dz)} m`);
  parts.push(`${Math.round(s.eleStart)} → ${Math.round(s.eleEnd)} m`);
  parts.push(`~${fmtTime(s.duration)}`);
  return parts.join(' · ');
}

function renderResult(r) {
  $('result').hidden = false;
  updateSaveUI();
  const chips = [
    `~${fmtTime(r.summary.duration)}`,
    `${fmtDist(r.summary.distance)} total`,
    `${fmtDist(r.summary.runDistance)} skiing`,
    `${r.summary.liftCount} lift${r.summary.liftCount === 1 ? '' : 's'}`,
    `↓ ${Math.round(r.summary.descent)} m`,
  ].map((t) => [t]);
  const gradient = routeGradient(r);
  if (gradient) {
    chips.push([`avg ${Math.round(gradient.avg * 100)}%`, 'Average gradient of the downhill runs (descent ÷ horizontal distance)']);
    if (gradient.max != null) chips.push([`max ${Math.round(gradient.max * 100)}%`, 'Steepest 30 m section of the downhill runs']);
  }
  $('summary').replaceChildren(...chips.map(([t, title]) => el('span', { className: 'chip', textContent: t, ...(title ? { title } : {}) })));
  $('warnings').replaceChildren(...r.warnings.map((w) => el('li', { textContent: `⚠ ${w}` })));
  renderRouteProfile(r);

  // One collapsible group per leg (A → B, B → C, …); collapsed groups are remembered (also across reloads).
  const n = state.points.length;
  $('legs').replaceChildren(
    ...r.legs.map((leg) => {
      const steps = r.steps.filter((s) => s.leg === leg.index);
      const key = `${leg.from}-${leg.to}`;
      const collapsed = state.collapsedLegs;
      const badge = (i) => {
        const b = el('span', { className: 'marker mini', textContent: letter(i) });
        b.style.background = markerColor(i, n);
        return b;
      };
      const s = leg.summary;
      const stats = [
        `~${fmtTime(s.duration)}`,
        fmtDist(s.distance),
        `${s.liftCount} lift${s.liftCount === 1 ? '' : 's'}`,
        ...(s.descent >= 5 ? [`↓ ${Math.round(s.descent)} m`] : []),
      ].join(' · ');
      const zoomBtn = el('button', { type: 'button', className: 'leg-zoom', title: 'Show this part on the map', textContent: '⤢' });
      zoomBtn.addEventListener('click', (ev) => {
        ev.preventDefault();
        zoomTo(steps.flatMap((x) => x.coordinates));
      });
      const head = el(
        'summary',
        {},
        el('span', { className: 'leg-title' }, badge(leg.index), document.createTextNode('→'), badge(leg.index + 1)),
        el('span', { className: 'leg-stats', textContent: stats }),
        zoomBtn,
      );
      head.addEventListener('mouseenter', () => highlight(steps));
      head.addEventListener('mouseleave', () => highlight(null));

      const list = el(
        'ol',
        { className: 'steps' },
        ...(steps.length
          ? steps.map((st, i) => {
              const icon = el('span', { className: 'icon' });
              icon.style.background = st.type === 'lift' ? LIFT_COLOR : st.type === 'walk' || st.runKind !== 'downhill' ? WALK_COLOR : st.color;
              icon.textContent = st.type === 'lift' ? (st.down ? '↓' : '↑') : st.type === 'walk' ? '·' : String(i + 1);
              const li = el('li', {}, icon, el('span', { className: 'title', textContent: stepTitle(st) }), el('span', { className: 'meta', textContent: stepMeta(st) }));
              li.addEventListener('mouseenter', () => highlight([st]));
              li.addEventListener('mouseleave', () => highlight(null));
              li.addEventListener('click', () => zoomTo(st.coordinates));
              return li;
            })
          : [el('li', { className: 'empty', textContent: 'Both points are at the same spot.' })]),
      );
      const group = el('details', { className: 'leg', open: !collapsed.has(key) }, head, list);
      group.dataset.key = key;
      group.addEventListener('toggle', () => {
        if (group.open) collapsed.delete(key);
        else collapsed.add(key);
        save();
      });
      return group;
    }),
  );
}

function highlight(steps) {
  map.getSource('route-highlight')?.setData(
    steps
      ? {
          type: 'FeatureCollection',
          features: steps.map((st) => ({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: st.coordinates.map((c) => [c[0], c[1]]) } })),
        }
      : EMPTY,
  );
}

function zoomTo(coords) {
  const b = new maplibregl.LngLatBounds();
  coords.forEach((c) => b.extend([c[0], c[1]]));
  map.fitBounds(b, { padding: 80, maxZoom: 16 });
}

// ---------------------------------------------------------------------------
// Route gradient profile: elevation along the whole route, coloured by the official difficulty of each run
// or by the measured gradient of ~30–50 m slices. Lifts and walking parts keep their own colour.

// map marker that follows the mouse on the chart (a hoisted function, so it can be used before this line runs)
function profileCursor() {
  profileCursor.marker ??= new maplibregl.Marker({ element: el('div', { className: 'profile-cursor' }) });
  return profileCursor.marker;
}

function routeProfilePoints(r) {
  const points = []; // { d, e, lon, lat, step }
  let d = 0;
  // consecutive steps share their boundary point; it is kept in both so every step has its own piece
  r.steps.forEach((st, stepIndex) => {
    st.coordinates.forEach((c, i) => {
      const prev = points.at(-1);
      if (prev) d += haversineM([prev.lon, prev.lat], c);
      const e = c[2] ?? (i === 0 ? st.eleStart : st.eleEnd);
      points.push({ d, e, lon: c[0], lat: c[1], step: stepIndex });
    });
  });
  return points;
}

function haversineM(a, b) {
  const R = 6371008.8;
  const toRad = (x) => (x * Math.PI) / 180;
  const dLat = toRad(b[1] - a[1]);
  const dLon = toRad(b[0] - a[0]);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

// Average and steepest gradient of the downhill runs on the route (lifts, paths and walking are left out).
// The steepest section uses the same 30 m window as the info card (packages/core/src/feature-info.ts).
function routeGradient(r) {
  const points = routeProfilePoints(r);
  let horizontal = 0;
  let descent = 0;
  let max = null;
  r.steps.forEach((st, stepIndex) => {
    if (st.type !== 'run' || st.runKind !== 'downhill') return;
    const pts = points.filter((p) => p.step === stepIndex);
    if (pts.length < 2) return;
    horizontal += pts.at(-1).d - pts[0].d;
    for (let i = 1; i < pts.length; i++) descent += Math.max(0, pts[i - 1].e - pts[i].e);
    let j = 0;
    for (let i = 0; i < pts.length; i++) {
      while (j < pts.length && pts[j].d - pts[i].d < 30) j++;
      if (j >= pts.length) break;
      max = Math.max(max ?? 0, Math.abs(pts[j].e - pts[i].e) / (pts[j].d - pts[i].d));
    }
  });
  return horizontal > 0 ? { avg: descent / horizontal, max } : null;
}

// colour + legend entry of one route step in "official" mode
function officialStyle(st) {
  if (st.type === 'lift') return { color: LIFT_COLOR, key: 'lift', label: 'Lift' };
  if (st.type === 'walk' || st.runKind !== 'downhill') return { color: WALK_COLOR, key: 'walk', label: 'Path / walk' };
  const info = DIFFICULTY_INFO[st.difficulty] ?? DIFFICULTY_INFO.unknown;
  return { color: st.color ?? info.color, key: st.difficulty ?? 'unknown', label: info.label };
}

// Coloured pieces of the profile: one per step (official) or slices of roughly equal length (steepness).
function routeProfileSegments(r, points, mode) {
  const segments = [];
  const total = points.at(-1).d || 1;
  const sliceLength = Math.max(30, total / 80);
  const push = (from, to) => {
    if (to <= from) return;
    const st = r.steps[points[from].step];
    const horizontal = points[to].d - points[from].d;
    const slope = horizontal > 0 ? Math.abs(points[to].e - points[from].e) / horizontal : 0;
    let style = officialStyle(st);
    if (mode === 'steepness' && st.type === 'run' && st.runKind === 'downhill') {
      const cls = slopeClass(slope);
      style = { color: cls.color, key: `slope-${cls.id}`, label: cls.label };
    }
    segments.push({ from, to, slope, step: points[from].step, ...style });
  };
  let start = 0;
  for (let i = 1; i <= points.length; i++) {
    const a = points[start];
    const b = points[i];
    if (!b || b.step !== a.step) {
      push(start, i - 1);
      start = i;
      continue;
    }
    const st = r.steps[a.step];
    if (mode === 'steepness' && st.type === 'run' && st.runKind === 'downhill' && b.d - a.d >= sliceLength) {
      push(start, i);
      start = i;
    }
  }
  return segments;
}

function renderRouteProfile(r) {
  const box = $('route-profile');
  profileCursor().remove();
  const points = r ? routeProfilePoints(r) : [];
  box.hidden = points.length < 2 || points.at(-1).d < 1;
  for (const b of $('profile-color').querySelectorAll('button')) {
    b.classList.toggle('active', b.dataset.mode === state.display.profileColor);
    b.setAttribute('aria-pressed', String(b.dataset.mode === state.display.profileColor));
  }
  if (box.hidden) return;

  const mode = state.display.profileColor;
  const segments = routeProfileSegments(r, points, mode);
  const ns = 'http://www.w3.org/2000/svg';
  const W = 320;
  const H = 140;
  const pad = { left: 46, right: 8, top: 8, bottom: 22 };
  const plotW = W - pad.left - pad.right;
  const plotH = H - pad.top - pad.bottom;
  const total = points.at(-1).d;
  const eles = points.map((p) => p.e);
  const rawMin = Math.min(...eles);
  const rawMax = Math.max(...eles);
  const step = niceStep(Math.max(rawMax - rawMin, 10));
  const min = Math.floor(rawMin / step) * step;
  const max = Math.max(Math.ceil(rawMax / step) * step, min + step);
  const x = (d) => pad.left + (d / total) * plotW;
  const y = (e) => pad.top + plotH - ((e - min) / (max - min)) * plotH;
  const baseY = pad.top + plotH;
  const node = (tag, attrs, text) => {
    const n = document.createElementNS(ns, tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    if (text != null) n.textContent = text;
    return n;
  };

  const svg = node('svg', {
    viewBox: `0 0 ${W} ${H}`,
    class: 'card-profile',
    role: 'img',
    'aria-label': `Route profile, ${fmtKm(total)}, from ${Math.round(eles[0])} m to ${Math.round(eles.at(-1))} m`,
  });
  for (let e = min; e <= max + 0.01; e += step) {
    svg.append(node('line', { x1: pad.left, x2: W - pad.right, y1: y(e), y2: y(e), class: 'prof-grid' }));
    svg.append(node('text', { x: pad.left - 6, y: y(e), class: 'prof-label prof-label-y' }, `${e} m`));
  }
  const path = (from, to) => points.slice(from, to + 1).map((p, n) => `${n ? 'L' : 'M'}${x(p.d).toFixed(1)},${y(p.e).toFixed(1)}`).join(' ');
  for (const s of segments) {
    const d0 = x(points[s.from].d).toFixed(1);
    const d1 = x(points[s.to].d).toFixed(1);
    svg.append(node('path', { d: `${path(s.from, s.to)} L${d1},${baseY} L${d0},${baseY} Z`, fill: s.color, 'fill-opacity': '0.72' }));
  }
  svg.append(node('path', { d: path(0, points.length - 1), fill: 'none', stroke: '#3c4650', 'stroke-width': '1.4', 'stroke-linejoin': 'round' }));

  // route points (A, B, C, …) where the legs meet
  const n = state.points.length;
  const pointMark = (d, i) => {
    svg.append(node('line', { x1: x(d), x2: x(d), y1: pad.top, y2: baseY, class: 'prof-leg' }));
    svg.append(node('circle', { cx: x(d), cy: pad.top + 6, r: 6, fill: markerColor(i, n) }));
    svg.append(node('text', { x: x(d), y: pad.top + 6, class: 'prof-leg-label' }, letter(i)));
  };
  pointMark(0, 0);
  for (const leg of r.legs.slice(1)) {
    const p = points.find((q) => r.steps[q.step].leg === leg.index);
    if (p) pointMark(p.d, leg.index);
  }
  pointMark(total, r.legs.length);

  svg.append(node('line', { x1: pad.left, x2: W - pad.right, y1: baseY, y2: baseY, class: 'prof-axis' }));
  for (const [d, anchor] of [[0, 'start'], [total / 2, 'middle'], [total, 'end']]) {
    svg.append(node('text', { x: x(d), y: H - 6, class: 'prof-label', 'text-anchor': anchor }, d === 0 ? '0' : fmtKm(d)));
  }

  const cross = node('line', { y1: pad.top, y2: baseY, class: 'prof-cross', visibility: 'hidden' });
  const dot = node('circle', { r: 3.5, fill: '#fff', stroke: '#1d2329', 'stroke-width': 2, visibility: 'hidden' });
  svg.append(cross, dot);
  const hit = node('rect', { x: pad.left, y: pad.top, width: plotW, height: plotH, fill: 'transparent' });
  svg.append(hit);
  const readout = $('route-profile-readout');
  const idleText = 'Hover the chart to see a point on the map.';
  readout.textContent = idleText;
  hit.addEventListener('mousemove', (ev) => {
    const rect = svg.getBoundingClientRect();
    const d = Math.min(total, Math.max(0, ((((ev.clientX - rect.left) / rect.width) * W - pad.left) / plotW) * total));
    let i = 1;
    while (i < points.length - 1 && points[i].d < d) i++;
    const a = points[i - 1];
    const b = points[i];
    const t = (d - a.d) / (b.d - a.d || 1);
    const e = a.e + (b.e - a.e) * t;
    const seg = segments.find((s) => d >= points[s.from].d && d <= points[s.to].d) ?? segments.at(-1);
    const st = r.steps[seg.step];
    for (const n of [cross, dot]) n.setAttribute('visibility', 'visible');
    cross.setAttribute('x1', x(d));
    cross.setAttribute('x2', x(d));
    dot.setAttribute('cx', x(d));
    dot.setAttribute('cy', y(e));
    const gradient = st.type === 'lift' ? '' : ` · ${Math.round(seg.slope * 100)}%`;
    readout.textContent = `${fmtKm(d)} · ${Math.round(e)} m${gradient} · ${stepTitle(st)}`;
    profileCursor().setLngLat([a.lon + (b.lon - a.lon) * t, a.lat + (b.lat - a.lat) * t]).addTo(map);
  });
  hit.addEventListener('mouseleave', () => {
    for (const n of [cross, dot]) n.setAttribute('visibility', 'hidden');
    readout.textContent = idleText;
    profileCursor().remove();
  });

  const legend = el('div', { className: 'prof-legend' });
  const order =
    mode === 'steepness'
      ? [...SLOPE_CLASSES.map((c) => `slope-${c.id}`), 'walk', 'lift']
      : [...Object.keys(DIFFICULTY_INFO), 'walk', 'lift'];
  const used = new Map(segments.map((s) => [s.key, s]));
  for (const key of order) {
    const s = used.get(key);
    if (!s) continue;
    const sw = el('span', { className: 'swatch' });
    sw.style.background = s.color;
    legend.append(el('span', { className: 'prof-legend-item' }, sw, document.createTextNode(s.label)));
  }
  $('route-profile-chart').replaceChildren(el('div', { className: 'card-profile-wrap' }, svg, legend));
}

for (const b of $('profile-color').querySelectorAll('button')) {
  b.addEventListener('click', () => {
    if (state.display.profileColor === b.dataset.mode) return;
    state.display.profileColor = b.dataset.mode;
    save();
    renderRouteProfile(state.result);
  });
}

$('route-name').value = state.routeName;
$('route-name').addEventListener('input', () => {
  state.routeName = $('route-name').value;
  save();
});
$('route-folder').value = state.routeFolder;
$('route-folder').addEventListener('input', () => {
  state.routeFolder = $('route-folder').value;
  save();
});

// ---------------------------------------------------------------------------
// Saved routes: kept in this browser (IndexedDB, default) or in the project folder on the planner server.
// The project folder is only offered when the server allows it (PLANNER_SERVER_ROUTES).

const STORES = { browser: browserStore, server: serverStore };
if (!config.serverRoutes || !STORES[state.routeStorage]) state.routeStorage = 'browser';
const activeStore = () => STORES[state.routeStorage];
let library = { folders: [] };

async function loadLibrary() {
  try {
    library = { folders: await activeStore().list() };
  } catch (err) {
    library = { folders: [], error: err.message };
  }
  renderLibrary();
}

function setSaveStatus(text, isError = false) {
  const s = $('save-status');
  s.textContent = text ?? '';
  s.style.color = isError ? '#8a1c1c' : '';
}

function updateSaveUI() {
  const linked = Boolean(state.savedId);
  $('save-route').textContent = linked ? 'Save changes' : 'Save';
  $('save-copy').hidden = !linked;
  $('route-folder').placeholder = `Folder (${DEFAULT_FOLDER})`;
  $('folder-list').replaceChildren(...library.folders.map((f) => el('option', { value: f.name })));
  if (linked && state.savedSnapshot && state.savedSnapshot !== snapshotState()) setSaveStatus('Changed since you saved it.');
  else if (linked) setSaveStatus('Saved.');
  else setSaveStatus('');
}

function updateStorageUI() {
  $('storage-choice').hidden = !config.serverRoutes;
  for (const b of $('storage-choice').querySelectorAll('button')) b.classList.toggle('active', b.dataset.storage === state.routeStorage);
  $('backup-row').hidden = state.routeStorage !== 'browser';
  $('copy-row').hidden = state.routeStorage !== 'server' || !library.folders.length;
}

function saveBlob({ blob, filename }) {
  const a = el('a', { href: URL.createObjectURL(blob) });
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

async function saveRoute(asNew = false) {
  if (state.points.length < 2) return;
  setSaveStatus('Saving…');
  try {
    const name = $('route-name').value.trim() || `${currentResort()?.name ?? 'Ski'} route`;
    const folder = $('route-folder').value.trim() || DEFAULT_FOLDER;
    let saved;
    if (state.routeStorage === 'server') {
      saved = await serverStore.save({ id: asNew ? null : state.savedId, name, folder, resort: state.resort, points: state.points, options: state.options });
    } else {
      // the planner server only calculates the route; the route is stored in this browser
      const res = await fetch('/api/route', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resort: state.resort, points: state.points, options: state.options, name }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error ?? res.statusText);
      saved = await browserStore.save({
        id: asNew ? null : state.savedId,
        name,
        folder,
        resort: state.resort,
        resortName: currentResort()?.name ?? state.resort,
        points: state.points,
        options: state.options,
        summary: { ...result.summary, legs: result.legs.length },
        gpx: result.gpx,
      });
    }
    state.savedId = saved.id;
    state.savedSnapshot = snapshotState();
    state.routeName = saved.name;
    state.routeFolder = saved.folder;
    $('route-name').value = saved.name;
    $('route-folder').value = saved.folder;
    save();
    await loadLibrary();
    setSaveStatus(`Saved in "${saved.folder}".`);
  } catch (err) {
    setSaveStatus(`Could not save: ${err.message}`, true);
  }
}

async function openSavedRoute(id) {
  try {
    const r = await activeStore().get(id);
    if (!config.resorts.some((x) => x.id === r.resort)) throw new Error(`the resort "${r.resortName}" is not on this site.`);
    if (r.resort !== state.resort) switchResort(r.resort, { keepPoints: true });
    // reopen with the settings it was planned with, so you get exactly the same route
    state.options = {
      ...config.defaults,
      ...(r.options ?? {}),
      speeds: { ...config.defaults.speeds, ...(r.options?.speeds ?? {}) },
    };
    syncOptionsUI();
    state.points = r.points;
    state.savedId = r.id;
    state.routeName = r.name;
    state.routeFolder = r.folder;
    $('route-name').value = r.name;
    $('route-folder').value = r.folder;
    state.collapsedLegs.clear();
    pointsChanged();
    state.savedSnapshot = snapshotState();
    save();
    const b = new maplibregl.LngLatBounds();
    r.points.forEach((p) => b.extend(p));
    map.fitBounds(b, { padding: 80, maxZoom: 15 });
    renderLibrary();
  } catch (err) {
    showError(`Could not open the route: ${err.message}`);
  }
}

async function deleteSavedRoute(route) {
  if (!confirm(`Delete "${route.name}"?`)) return;
  await activeStore().delete(route.id);
  if (state.savedId === route.id) {
    state.savedId = null;
    state.savedSnapshot = null;
    save();
  }
  loadLibrary();
}

function renderLibrary() {
  const box = $('library');
  updateSaveUI();
  updateStorageUI();
  if (library.error) {
    box.replaceChildren(el('p', { className: 'hint', textContent: `Could not load saved routes: ${library.error}` }));
    return;
  }
  if (!library.folders.length) {
    box.replaceChildren(el('p', { className: 'hint', textContent: 'No saved routes yet. Plan a route and press Save.' }));
    return;
  }
  box.replaceChildren(
    ...library.folders.map((folder) => {
      const zipBtn = el('button', { type: 'button', textContent: 'Download all (ZIP)', title: 'All GPX files of this folder in one ZIP file' });
      zipBtn.addEventListener('click', async () => {
        try {
          saveBlob(await activeStore().zipBlob(folder.name));
        } catch (err) {
          showError(err.message);
        }
      });
      const head = el(
        'div',
        { className: 'folder-head' },
        el('span', { className: 'folder-name', textContent: `📁 ${folder.name}` }),
        el('span', { className: 'count', textContent: String(folder.routes.length) }),
        zipBtn,
      );
      const list = el(
        'ul',
        { className: 'library-list' },
        ...folder.routes.map((route) => {
          const s = route.summary ?? {};
          const meta = [
            route.resort !== state.resort ? route.resortName : null,
            s.distance != null ? fmtDist(s.distance) : null,
            s.duration != null ? `~${fmtTime(s.duration)}` : null,
            s.liftCount != null ? `${s.liftCount} lift${s.liftCount === 1 ? '' : 's'}` : null,
          ]
            .filter(Boolean)
            .join(' · ');
          const gpxBtn = el('button', { type: 'button', textContent: '⬇', title: 'Download GPX', ariaLabel: 'Download GPX' });
          gpxBtn.addEventListener('click', async (ev) => {
            ev.stopPropagation();
            try {
              saveBlob(await activeStore().gpxBlob(route.id));
            } catch (err) {
              showError(err.message);
            }
          });
          const delBtn = el('button', { type: 'button', textContent: '🗑', title: 'Delete', ariaLabel: 'Delete' });
          delBtn.addEventListener('click', (ev) => {
            ev.stopPropagation();
            deleteSavedRoute(route);
          });
          const li = el(
            'li',
            { className: route.id === state.savedId ? 'current' : '', title: 'Open this route' },
            el('span', { className: 'r-name', textContent: route.name }),
            gpxBtn,
            delBtn,
            el('span', { className: 'r-meta', textContent: meta }),
          );
          li.addEventListener('click', () => openSavedRoute(route.id));
          return li;
        }),
      );
      return el('div', { className: 'library-folder' }, head, list);
    }),
  );
}

for (const b of $('storage-choice').querySelectorAll('button')) {
  b.addEventListener('click', () => {
    if (state.routeStorage === b.dataset.storage) return;
    state.routeStorage = b.dataset.storage;
    // a saved route belongs to one storage place: the current route is no longer linked
    state.savedId = null;
    state.savedSnapshot = null;
    save();
    loadLibrary();
  });
}

$('export-backup').addEventListener('click', async () => {
  const backup = await browserStore.exportBackup();
  if (!backup.count) {
    showToast('There are no saved routes to export.');
    return;
  }
  saveBlob(backup);
});
$('import-backup').addEventListener('click', () => $('import-file').click());
$('import-file').addEventListener('change', async () => {
  const file = $('import-file').files[0];
  $('import-file').value = '';
  if (!file) return;
  try {
    const count = await browserStore.importBackup(await file.text());
    await loadLibrary();
    showToast(`${count} route${count === 1 ? '' : 's'} imported.`);
  } catch {
    showError('This file is not a valid backup.');
  }
});

$('copy-to-browser').addEventListener('click', async () => {
  let count = 0;
  try {
    for (const folder of library.folders) {
      for (const meta of folder.routes) {
        // same id: copying twice replaces the earlier copy instead of making duplicates
        await browserStore.save(await serverStore.getWithGpx(meta.id));
        count++;
      }
    }
    showToast(`${count} route${count === 1 ? '' : 's'} copied to this browser.`);
  } catch (err) {
    showError(`Copy failed: ${err.message}`);
  }
});

$('save-route').addEventListener('click', () => saveRoute(false));
$('save-copy').addEventListener('click', () => saveRoute(true));
$('route-name').addEventListener('change', scheduleRoute);
$('download').addEventListener('click', () => {
  if (!state.result) return;
  const name = $('route-name').value.trim() || state.result.name;
  const slug = name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '') || 'ski-route';
  const blob = new Blob([state.result.gpx], { type: 'application/gpx+xml' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${slug}.gpx`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

setPlanMode(state.planMode);
updateUndoButtons();
renderPointList();
loadLibrary();

// restore the route from the previous visit
if (state.points.length) {
  renderPoints();
  scheduleRoute();
}

// Handy from the browser console, e.g. skiPlanner.setPoints([[lon, lat], [lon, lat]])
window.skiPlanner = {
  map,
  state,
  setPoints(points) {
    state.points = points;
    pointsChanged();
  },
  dropPin: dropSearchPin,
  setPlanMode,
};
