<script lang="ts">
  // Desktop › Build region: build a data ZIP for another region. Draw a box (built exactly as drawn) or search ski
  // areas (their area plus a margin). The desktop server runs the build and streams its output; the ZIP lands in
  // build/pwa/. Opened from the settings menu; full screen over the planner.
  import { onMount, tick } from 'svelte';
  import { Map as MlMap, Marker, setWorkerUrl } from 'maplibre-gl';
  import 'maplibre-gl/dist/maplibre-gl.css';
  import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
  import Icon from '../Icon.svelte';
  import Segmented from '../Segmented.svelte';
  import ConfirmDialog from '../ConfirmDialog.svelte';
  import type { AppState } from '../../lib/app.svelte.ts';
  import { openSnowMapStyle } from '../../lib/map/basemaps.ts';
  import { formatBytes } from '../../lib/format.ts';
  import { CORNERS, bboxFromCorners, boxInView, center, cornerOf, formatBbox, moveCorner, moveTo, parseBbox, sizeKm, type Bbox, type Corner } from '../../lib/regions/bbox.ts';
  import {
    ID_PATTERN,
    regionId,
    regionsApi,
    watchBuild,
    type BuildStatus,
    type Estimate,
    type Region,
    type RegionDefaults,
    type SkiAreaHit,
    type ZipInfo,
    type Zoom,
  } from '../../lib/regions/api.ts';
  import { addRegionLayers, showRegion } from '../../lib/regions/layers.ts';

  let { app, onclose }: { app: AppState; onclose: () => void } = $props();

  type Mode = 'box' | 'search';
  type Picked = Pick<SkiAreaHit, 'id' | 'name'> & Partial<SkiAreaHit>;

  setWorkerUrl(workerUrl);

  let defaults = $state.raw<RegionDefaults | null>(null);
  let loadError = $state<string | null>(null);
  let mode = $state<Mode>('box');
  let bbox = $state.raw<Bbox | null>(null);
  let bboxText = $state('');
  let bboxTextError = $state(false);
  let drawing = $state(false);

  let query = $state('');
  let results = $state.raw<SkiAreaHit[]>([]);
  let searching = $state(false);
  let searchError = $state<string | null>(null);
  let picked = $state.raw<Picked[]>([]);
  let marginKm = $state(2);

  let name = $state('');
  let customId = $state<string | null>(null);
  const id = $derived(customId ?? regionId(name));
  let zoom = $state<Zoom>({ terrain: 14, basemap: 15, ski: 16 });

  let estimate = $state.raw<Estimate | null>(null);
  let estimateError = $state<string | null>(null);

  let build = $state.raw<BuildStatus | null>(null);
  let lines = $state.raw<string[]>([]);
  let progress = $state<string | null>(null);
  let actionError = $state<string | null>(null);

  let saved = $state.raw<Region[]>([]);
  let zips = $state.raw<ZipInfo[]>([]);
  let askSave = $state(false);
  let deleting = $state<Region | null>(null);

  const running = $derived(build?.state === 'running');
  const geometry = $derived.by<Pick<Region, 'bbox' | 'skiAreas' | 'marginKm'> | null>(() => {
    if (mode === 'box') return bbox ? { bbox } : null;
    return picked.length ? { skiAreas: picked.map((a) => (a.name ? { id: a.id, name: a.name } : { id: a.id })), marginKm } : null;
  });
  const region = $derived<Region | null>(geometry ? { id, name: name.trim(), ...geometry, zoom: { ...zoom } } : null);
  const canBuild = $derived(!!region && !!name.trim() && ID_PATTERN.test(id) && !running && !estimateError);
  const boxSize = $derived(bbox ? sizeKm(bbox) : null);

  // --- map ---

  let container: HTMLDivElement;
  let map = $state.raw<MlMap | null>(null);
  let mapReady = $state(false);
  const markers: Partial<Record<Corner | 'center', Marker>> = {};

  function handle(kind: Corner | 'center'): HTMLElement {
    const el = document.createElement('div');
    el.className = kind === 'center' ? 'rb-handle rb-move' : 'rb-handle';
    el.title = kind === 'center' ? 'Drag to move the box' : 'Drag to resize the box';
    el.dataset.testid = `region-handle-${kind}`;
    return el;
  }

  function ensureMarkers(m: MlMap) {
    for (const kind of [...CORNERS, 'center'] as const) {
      if (markers[kind]) continue;
      const marker = new Marker({ element: handle(kind), draggable: true });
      let start: Bbox | null = null;
      marker.on('dragstart', () => (start = bbox));
      marker.on('drag', () => {
        if (!start) return;
        const p = marker.getLngLat();
        bbox = kind === 'center' ? moveTo(start, [p.lng, p.lat]) : moveCorner(start, kind, [p.lng, p.lat]);
      });
      marker.on('dragend', () => (start = null));
      markers[kind] = marker.setLngLat([0, 0]).addTo(m);
    }
  }

  function removeMarkers() {
    for (const k of Object.keys(markers) as (Corner | 'center')[]) {
      markers[k]?.remove();
      delete markers[k];
    }
  }

  onMount(() => {
    const r = app.resort?.bbox as Bbox | undefined;
    const m = new MlMap({
      container,
      style: openSnowMapStyle() as never,
      center: r ? center(r) : [10.5, 46.8],
      zoom: r ? 10 : 6,
      maxZoom: 18,
      attributionControl: { compact: true },
    });
    m.on('load', () => {
      const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#005ec4';
      addRegionLayers(m, accent);
      mapReady = true;
    });

    // drawing: press and drag on the map
    let from: [number, number] | null = null;
    m.on('mousedown', (e) => {
      if (!drawing) return;
      e.preventDefault();
      from = [e.lngLat.lng, e.lngLat.lat];
    });
    m.on('mousemove', (e) => {
      if (!drawing || !from) return;
      bbox = bboxFromCorners(from, [e.lngLat.lng, e.lngLat.lat]);
    });
    m.on('mouseup', (e) => {
      if (!drawing || !from) return;
      const b = bboxFromCorners(from, [e.lngLat.lng, e.lngLat.lat]);
      from = null;
      drawing = false;
      if (b[2] - b[0] > 1e-4 && b[3] - b[1] > 1e-4) bbox = b;
    });
    if (new URLSearchParams(location.search).has('e2e')) (window as Window & { __regionMap?: MlMap }).__regionMap = m;
    map = m;

    void loadAll();
    const stop = watchBuild({
      onhello: (b, l) => {
        build = b;
        lines = l;
        progress = b?.progress ?? null;
      },
      online: (text) => {
        lines = [...lines.slice(-1999), text];
        progress = null;
      },
      onprogress: (text) => (progress = text),
      onstatus: (b) => {
        const finished = build?.state === 'running' && b.state !== 'running';
        build = b;
        if (b.state !== 'running') progress = null;
        if (finished || b.state === 'done') void refreshLists();
      },
    });
    return () => {
      stop();
      removeMarkers();
      m.remove();
    };
  });

  // drawing mode: the map does not pan while a box is drawn
  $effect(() => {
    if (!map) return;
    if (drawing) map.dragPan.disable();
    else map.dragPan.enable();
    map.getCanvas().style.cursor = drawing ? 'crosshair' : '';
  });

  // keep the layers and handles in sync with the region
  $effect(() => {
    const m = map;
    if (!m || !mapReady) return;
    const box = mode === 'box' ? bbox : null;
    showRegion(m, {
      box,
      areas: mode === 'search' ? picked.map((a) => a.bbox).filter((b): b is Bbox => !!b) : [],
      cover: mode === 'search' && picked.length ? (estimate?.bbox ?? null) : null,
    });
    if (box && !drawing) {
      ensureMarkers(m);
      for (const c of CORNERS) markers[c]?.setLngLat(cornerOf(box, c));
      markers.center?.setLngLat(center(box));
    } else removeMarkers();
  });

  $effect(() => {
    if (bbox) {
      bboxText = formatBbox(bbox);
      bboxTextError = false;
    }
  });

  // --- data from the server ---

  async function loadAll() {
    try {
      defaults = await regionsApi.defaults();
      zoom = { ...defaults.zoom };
    } catch (err) {
      loadError = (err as Error).message;
    }
    await refreshLists();
  }

  async function refreshLists() {
    try {
      [saved, zips] = await Promise.all([regionsApi.list(), regionsApi.zips()]);
    } catch (err) {
      actionError = (err as Error).message;
    }
  }

  // size estimate, a moment after the region stops changing
  $effect(() => {
    const g = geometry;
    const z = { ...zoom };
    if (!g) {
      estimate = null;
      estimateError = null;
      return;
    }
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      regionsApi
        .estimate({ ...g, zoom: z }, ctrl.signal)
        .then((e) => {
          estimate = e;
          estimateError = null;
        })
        .catch((err: Error) => {
          if (err.name === 'AbortError') return;
          estimate = null;
          estimateError = err.message;
        });
    }, 300);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  });

  // ski area search while typing
  $effect(() => {
    const q = query.trim();
    if (q.length < 2) {
      results = [];
      searchError = null;
      return;
    }
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      searching = true;
      regionsApi
        .search(q, ctrl.signal)
        .then((r) => {
          results = r;
          searchError = null;
        })
        .catch((err: Error) => {
          if (err.name !== 'AbortError') searchError = err.message;
        })
        .finally(() => (searching = false));
    }, 200);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  });

  // --- actions ---

  function startDrawing() {
    mode = 'box';
    drawing = true;
  }

  function boxHere() {
    if (!map) return;
    const b = map.getBounds();
    bbox = boxInView([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()]);
  }

  function applyBboxText() {
    const b = parseBbox(bboxText);
    bboxTextError = !b;
    if (b) {
      bbox = b;
      fit(b);
    }
  }

  function fit(b: Bbox) {
    if (!map) return;
    // a ski area can be a single point: show its surroundings
    if (b[2] - b[0] < 0.005 && b[3] - b[1] < 0.005) map.easeTo({ center: center(b), zoom: 12, duration: 600 });
    else map.fitBounds([b[0], b[1], b[2], b[3]], { padding: 60, duration: 600, maxZoom: 13 });
  }

  function togglePick(a: SkiAreaHit) {
    if (picked.some((p) => p.id === a.id)) picked = picked.filter((p) => p.id !== a.id);
    else {
      picked = [...picked, a];
      if (!name.trim() && a.name) name = a.name;
      if (a.bbox) fit(a.bbox);
    }
  }

  /** Search → box: the area of the picked ski areas becomes an editable box. */
  function toBox() {
    if (!estimate) return;
    bbox = estimate.bbox;
    mode = 'box';
    fit(estimate.bbox);
  }

  function editSaved(r: Region) {
    name = r.name;
    customId = r.id === regionId(r.name) ? null : r.id;
    if (r.zoom && defaults) zoom = { ...defaults.zoom, ...r.zoom };
    if (r.bbox) {
      mode = 'box';
      bbox = r.bbox;
      fit(r.bbox);
    } else {
      mode = 'search';
      marginKm = r.marginKm ?? 2;
      picked = (r.skiAreas ?? []).map((a) => (typeof a === 'string' ? { id: a, name: a } : { id: a.id, name: a.name ?? a.id }));
    }
  }

  async function startBuild(save: boolean, r: Region | null = region) {
    askSave = false;
    if (!r) return;
    actionError = null;
    try {
      lines = [];
      progress = null;
      build = await regionsApi.build(r, save);
      if (save) saved = await regionsApi.list();
      await tick();
    } catch (err) {
      actionError = (err as Error).message;
    }
  }

  async function cancelBuild() {
    try {
      build = await regionsApi.cancel();
    } catch (err) {
      actionError = (err as Error).message;
    }
  }

  async function removeSaved(r: Region) {
    deleting = null;
    try {
      await regionsApi.remove(r.id);
      saved = await regionsApi.list();
    } catch (err) {
      actionError = (err as Error).message;
    }
  }

  // the log follows new lines
  let log = $state<HTMLPreElement | null>(null);
  $effect(() => {
    void lines;
    void progress;
    if (log) log.scrollTop = log.scrollHeight;
  });

  function onkeydown(e: KeyboardEvent) {
    if (e.key !== 'Escape' || askSave || deleting) return;
    e.preventDefault();
    if (drawing) drawing = false;
    else onclose();
  }

  const zoomOptions = (range: [number, number] | undefined, fallback: [number, number]) => {
    const [a, b] = range ?? fallback;
    return Array.from({ length: b - a + 1 }, (_, i) => a + i);
  };
  const place = (a: Partial<SkiAreaHit>) => [a.locality, a.region, a.country].filter(Boolean).join(', ');
  const time = (iso: string) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const stateText: Record<string, string> = { running: 'Building…', done: 'Done', failed: 'Failed', cancelled: 'Cancelled' };
</script>

<svelte:window {onkeydown} />

<div class="builder" role="dialog" aria-modal="true" aria-labelledby="rb-title" data-testid="region-builder">
  <aside class="panel">
    <div class="head">
      <h1 id="rb-title">Build region</h1>
      <button type="button" class="round-btn" aria-label="Close" title="Close (Esc)" onclick={onclose} data-testid="region-close">
        <Icon name="x" size={18} strokeWidth={2.4} />
      </button>
    </div>
    <p class="grp-f intro">Make a data file (ZIP) for another region, then import it on your phone. The phone keeps one data file at a time.</p>
    {#if loadError}<p class="error" role="alert">{loadError}</p>{/if}

    <div class="seg-wrap">
      <Segmented
        label="How to pick the region"
        options={[
          { value: 'box', label: 'Draw a box', testid: 'region-mode-box' },
          { value: 'search', label: 'Search ski area', testid: 'region-mode-search' },
        ]}
        value={mode}
        onchange={(v) => {
          mode = v;
          drawing = false;
        }}
      />
    </div>

    {#if mode === 'box'}
      <div class="btn-row">
        <button type="button" class="cap-btn" class:primary={drawing} onclick={() => (drawing ? (drawing = false) : startDrawing())} data-testid="region-draw">
          <Icon name="pencil" size={16} />{drawing ? 'Drag on the map…' : bbox ? 'Draw again' : 'Draw a box'}
        </button>
        <button type="button" class="cap-btn" onclick={boxHere} data-testid="region-box-here"><Icon name="maximize2" size={16} />Box in this view</button>
        {#if bbox}<button type="button" class="cap-btn" onclick={() => bbox && fit(bbox)}><Icon name="crosshair" size={16} />Show</button>{/if}
      </div>
      <p class="grp-f">Press and drag on the map to draw. Drag the corners to resize and the middle dot to move. Exactly this box is downloaded; runs and lifts that cross its edge are kept whole.</p>
      <label class="field">
        <span>Box (west, south, east, north)</span>
        <input
          type="text"
          bind:value={bboxText}
          class:invalid={bboxTextError}
          placeholder="10.1, 47.2, 10.3, 47.4"
          onchange={applyBboxText}
          onkeydown={(e) => e.key === 'Enter' && applyBboxText()}
          data-testid="region-bbox"
        />
      </label>
      {#if boxSize}<p class="grp-f">{boxSize.width.toFixed(1)} × {boxSize.height.toFixed(1)} km</p>{/if}
    {:else}
      {#if defaults && !defaults.skiAreasAvailable}
        <p class="error">The ski area list is not downloaded yet. Run <code>npm run build</code> once, or draw a box.</p>
      {/if}
      <label class="field">
        <span>Ski area name</span>
        <input type="search" bind:value={query} placeholder="For example Ifen or Lech" autocomplete="off" data-testid="region-search" />
      </label>
      {#if searchError}<p class="error">{searchError}</p>{/if}
      {#if results.length}
        <div class="grp results" data-testid="region-results">
          {#each results as a (a.id)}
            {@const on = picked.some((p) => p.id === a.id)}
            <button type="button" class="row" role="checkbox" aria-checked={on} onclick={() => togglePick(a)} data-testid="region-result">
              <span class="txt">
                <span class="t">{a.name ?? 'Unnamed'}</span>
                <span class="s">{[place(a), a.downhillKm ? `${a.downhillKm} km of runs` : a.activities.join(', ')].filter(Boolean).join(' · ')}</span>
              </span>
              {#if on}<span class="chk"><Icon name="check" size={20} strokeWidth={2.6} /></span>{/if}
            </button>
          {/each}
        </div>
      {:else if query.trim().length >= 2 && !searching && !searchError}
        <p class="grp-f">No ski area found.</p>
      {/if}
      {#if picked.length}
        <h3 class="grp-h">Picked</h3>
        <div class="chips" data-testid="region-picked">
          {#each picked as a (a.id)}
            <span class="chip">{a.name}<button type="button" aria-label={`Remove ${a.name}`} onclick={() => (picked = picked.filter((p) => p.id !== a.id))}><Icon name="x" size={14} /></button></span>
          {/each}
        </div>
        <label class="field inline">
          <span>Margin around the runs</span>
          <input type="number" min="0" max={defaults?.maxMarginKm ?? 20} step="0.5" bind:value={marginKm} data-testid="region-margin" /> km
        </label>
        <div class="btn-row">
          <button type="button" class="cap-btn" disabled={!estimate} onclick={toBox} data-testid="region-to-box"><Icon name="maximize2" size={16} />Turn into box</button>
        </div>
        <p class="grp-f">The dashed line shows about what is downloaded. The build uses the runs and lifts of these ski areas plus the margin.</p>
      {/if}
    {/if}

    <div class="grp-gap"></div>
    <h3 class="grp-h">Region</h3>
    <label class="field">
      <span>Name</span>
      <input type="text" bind:value={name} placeholder="For example Lech Zürs" maxlength="100" data-testid="region-name" />
    </label>
    <label class="field">
      <span>Id (file name)</span>
      <input
        type="text"
        value={id}
        class:invalid={!!id && !ID_PATTERN.test(id)}
        oninput={(e) => (customId = e.currentTarget.value || null)}
        placeholder="lech-zurs"
        data-testid="region-id"
      />
    </label>

    <div class="zoom-row">
      {#each [['terrain', 'Terrain'], ['basemap', 'Map'], ['ski', 'Runs']] as const as [k, label] (k)}
        <label class="field">
          <span>{label} zoom</span>
          <select bind:value={zoom[k]} data-testid={`region-zoom-${k}`}>
            {#each zoomOptions(defaults?.ranges[k], k === 'ski' ? [8, 18] : [1, k === 'basemap' ? 15 : 18]) as z (z)}<option value={z}>{z}</option>{/each}
          </select>
        </label>
      {/each}
    </div>

    {#if estimateError}
      <p class="error" data-testid="region-estimate-error">{estimateError}</p>
    {:else if estimate}
      <p class="grp-f" data-testid="region-estimate">
        About {estimate.widthKm} × {estimate.heightKm} km. Terrain: about {estimate.terrainTiles.toLocaleString('en')} tiles, roughly {formatBytes(estimate.terrainBytes)} (zoom 0–{estimate.zoom.terrain}); the ZIP is usually a bit bigger.
      </p>
      {#if estimate.big}<p class="warn">Terrain zoom {estimate.zoom.terrain} is big. The download can take a long time.</p>{/if}
    {/if}

    <div class="btn-row build-row">
      <button type="button" class="cap-btn primary" disabled={!canBuild} onclick={() => (askSave = true)} data-testid="region-build">
        <Icon name="box" size={16} />Build ZIP
      </button>
    </div>
    {#if actionError}<p class="error" role="alert">{actionError}</p>{/if}

    {#if build}
      <div class="grp-gap"></div>
      <h3 class="grp-h">Build: {build.region.name}</h3>
      <div class="status" data-state={build.state} data-testid="region-build-status">
        <span class="state">
          {#if running}<span class="spin"><Icon name="loader" size={16} /></span>{/if}{stateText[build.state]}
        </span>
        {#if running}<button type="button" class="cap-btn destructive" onclick={cancelBuild} data-testid="region-cancel">Cancel</button>{/if}
      </div>
      {#if build.state === 'failed' && build.error}<p class="error">{build.error}</p>{/if}
      {#if build.state === 'done' && build.zip}
        <p class="done">
          Saved as <code>build/pwa/{build.zip}</code>.
          <a class="cap-btn" href={regionsApi.zipUrl(build.zip)} download data-testid="region-download"><Icon name="fileDown" size={16} />Download</a>
        </p>
        <p class="grp-f">On the phone: Settings › Data › Import new file. With <code>npm run dev:pwa</code>, “Load data from build/” loads the newest ZIP.</p>
      {/if}
      <pre class="log" bind:this={log} data-testid="region-log">{lines.slice(-400).join('\n')}{progress ? `\n${progress}` : ''}</pre>
    {/if}

    {#if saved.length}
      <div class="grp-gap"></div>
      <h3 class="grp-h">Saved regions (regions.json)</h3>
      <div class="grp" data-testid="region-saved">
        {#each saved as r (r.id)}
          <div class="row">
            <span class="txt">
              <span class="t">{r.name}</span>
              <span class="s">{r.bbox ? 'Box' : `${r.skiAreas?.length ?? 0} ski area(s)`}{r.zoom?.terrain ? ` · terrain z${r.zoom.terrain}` : ''}</span>
            </span>
            <button type="button" class="cap-btn" onclick={() => editSaved(r)} title="Show and change">Edit</button>
            <button type="button" class="cap-btn" disabled={running} onclick={() => void startBuild(false, r)} data-testid={`region-rebuild-${r.id}`}>Rebuild</button>
            <button type="button" class="round-btn" aria-label={`Delete ${r.name}`} title="Delete" onclick={() => (deleting = r)}><Icon name="trash" size={16} /></button>
          </div>
        {/each}
      </div>
    {/if}

    {#if zips.length}
      <div class="grp-gap"></div>
      <h3 class="grp-h">ZIP files in build/pwa</h3>
      <div class="grp" data-testid="region-zips">
        {#each zips as z (z.name)}
          <a class="row link-row" href={regionsApi.zipUrl(z.name)} download>
            <span class="txt"><span class="t">{z.name}</span><span class="s">{formatBytes(z.size)} · {time(z.modifiedAt)}</span></span>
            <span class="dl"><Icon name="fileDown" size={18} /></span>
          </a>
        {/each}
      </div>
    {/if}
  </aside>
  <div class="map" class:drawing bind:this={container} data-testid="region-map"></div>
</div>

{#if askSave && region}
  <dialog
    class="alert"
    aria-labelledby="rb-save-title"
    data-testid="region-save-dialog"
    {@attach (d: HTMLDialogElement) => (typeof d.showModal === 'function' ? d.showModal() : d.setAttribute('open', ''))}
    oncancel={(e) => {
      e.preventDefault();
      askSave = false;
    }}
  >
    <h2 id="rb-save-title">Save this region?</h2>
    <p>Saved regions go into regions.json, so you can build them again later with new data. Not saved: this is a one-time build.</p>
    {#if estimate?.big}<p class="warn">Terrain zoom {estimate.zoom.terrain} is big (about {formatBytes(estimate.terrainBytes)}).</p>{/if}
    <div class="buttons">
      <button type="button" onclick={() => void startBuild(true)} data-testid="region-save-yes">Save and build</button>
      <button type="button" onclick={() => void startBuild(false)} data-testid="region-save-no">Build once</button>
      <button type="button" class="cancel" onclick={() => (askSave = false)}>Cancel</button>
    </div>
  </dialog>
{/if}

{#if deleting}
  {@const r = deleting}
  <ConfirmDialog title={`Delete “${r.name}”?`} message="It is removed from regions.json. ZIP files stay." action="Delete" destructive onconfirm={() => void removeSaved(r)} oncancel={() => (deleting = null)} />
{/if}

<style>
  .builder {
    position: fixed;
    inset: 0;
    z-index: var(--z-modal);
    display: grid;
    grid-template-columns: 420px 1fr;
    background: var(--bg-grouped);
    color: var(--label);
  }
  .panel {
    overflow-y: auto;
    padding: 12px 16px 32px;
    box-sizing: border-box;
    border-right: 0.5px solid var(--separator);
  }
  .map {
    position: relative;
    min-height: 0;
  }
  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 4px 0 4px 4px;
  }
  h1 {
    margin: 0;
    font-size: var(--t-title2, 22px);
    font-weight: var(--fw-bold);
  }
  .intro {
    margin-bottom: 16px;
  }
  .seg-wrap {
    margin: 0 0 12px;
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin: 0 0 10px;
    font-size: var(--t-footnote);
    color: var(--label-2);
  }
  .field.inline {
    flex-direction: row;
    align-items: center;
    gap: 8px;
  }
  .field.inline input {
    width: 72px;
  }
  .field input,
  .field select {
    font: inherit;
    font-size: var(--t-body);
    color: var(--label);
    background: var(--bg-cell);
    border: 0.5px solid var(--separator);
    border-radius: var(--r-md);
    padding: 8px 10px;
    box-sizing: border-box;
  }
  .field input.invalid {
    border-color: var(--red);
    box-shadow: 0 0 0 1px var(--red);
  }
  .zoom-row {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 8px;
  }
  .grp-f {
    margin-bottom: 10px;
  }
  .error {
    margin: 0 4px 10px;
    color: var(--red);
    font-size: var(--t-footnote);
  }
  .warn {
    margin: 0 4px 10px;
    color: var(--orange);
    font-size: var(--t-footnote);
  }
  .build-row {
    margin-top: 6px;
  }
  .results {
    max-height: 320px;
    overflow-y: auto;
  }
  .grp .txt {
    display: flex;
    flex-direction: column;
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin: 0 0 10px;
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 4px 4px 4px 10px;
    border-radius: var(--r-pill);
    background: var(--fill-3);
    font-size: var(--t-subhead);
  }
  .chip button {
    display: grid;
    place-items: center;
    width: 22px;
    height: 22px;
    border: 0;
    border-radius: 50%;
    background: none;
    color: var(--label-2);
    cursor: pointer;
    padding: 0;
  }
  .status {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin: 0 4px 8px;
  }
  .state {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-weight: var(--fw-semibold);
  }
  .status[data-state='done'] .state {
    color: var(--green);
  }
  .status[data-state='failed'] .state {
    color: var(--red);
  }
  .spin {
    display: grid;
    animation: spin 1s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
  .done {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    margin: 0 4px 8px;
    font-size: var(--t-footnote);
  }
  .log {
    margin: 0;
    max-height: 260px;
    overflow: auto;
    padding: 10px 12px;
    border-radius: var(--r-md);
    background: #1c1c1e;
    color: #e5e5ea;
    font: 11px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace;
    white-space: pre-wrap;
    word-break: break-word;
  }
  .row .cap-btn {
    height: 30px;
    padding: 0 10px;
  }
  .link-row {
    text-decoration: none;
    color: inherit;
  }
  .dl {
    color: var(--accent);
    display: grid;
  }
  code {
    font-size: 0.92em;
  }
  .map :global(.rb-handle) {
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: #fff;
    border: 2.5px solid var(--accent);
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.35);
    cursor: nwse-resize;
  }
  .map :global(.rb-handle.rb-move) {
    width: 18px;
    height: 18px;
    background: var(--accent);
    border-color: #fff;
    cursor: move;
  }
  .map.drawing :global(.rb-handle) {
    display: none;
  }
  .alert {
    z-index: var(--z-alert);
    width: 300px;
    padding: 0;
    border: 0;
    border-radius: var(--r-card);
    background: color-mix(in srgb, var(--bg-elevated) 96%, transparent);
    color: var(--label);
    text-align: center;
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.18);
  }
  .alert::backdrop {
    background: var(--scrim);
  }
  .alert h2 {
    margin: 20px 16px 4px;
    font-size: var(--t-headline);
    font-weight: var(--fw-semibold);
  }
  .alert p {
    margin: 0 16px 14px;
    font-size: var(--t-footnote);
  }
  .alert .buttons {
    display: flex;
    flex-direction: column;
    border-top: 0.5px solid var(--separator);
  }
  .alert .buttons button {
    min-height: 44px;
    border: 0;
    background: none;
    color: var(--accent);
    font: var(--fw-semibold) var(--t-body) var(--font);
    cursor: pointer;
  }
  .alert .buttons button + button {
    border-top: 0.5px solid var(--separator);
  }
  .alert .buttons .cancel {
    font-weight: var(--fw-regular);
  }
  @media (max-width: 899px) {
    .builder {
      grid-template-columns: 1fr;
      grid-template-rows: 45vh 1fr;
    }
    .map {
      grid-row: 1;
    }
    .panel {
      grid-row: 2;
      border-right: 0;
    }
  }
</style>
