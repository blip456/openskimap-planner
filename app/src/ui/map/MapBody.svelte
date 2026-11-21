<script lang="ts">
  // Map sheet (spec §3.4; old planner "Map" section): Show, Run colours, Extra (ski areas + legend, route arrows,
  // route distances), Terrain, Base map (online maps only in online mode). Changes apply live.
  import Icon from '../Icon.svelte';
  import Switch from '../Switch.svelte';
  import { SLOPE_CLASSES } from '@core/slope.ts';
  import { BASEMAPS, basemapChoices, hasSkiLayers } from '../../lib/map/basemaps.ts';
  import type { AppState } from '../../lib/app.svelte.ts';
  import type { SkiAreaSummary } from '@core/ski-areas.ts';

  let { app }: { app: AppState } = $props();
  const d = $derived(app.display);
  const online = $derived(app.settings.online);
  const skiLayers = $derived(hasSkiLayers(app.basemap));
  const tap = $derived(app.desktop ? 'Click' : 'Tap');

  const SHOW = [
    { key: 'downhill', label: 'Ski runs' },
    { key: 'lifts', label: 'Lifts' },
    { key: 'nordic', label: 'Cross-country' },
    { key: 'other', label: 'Touring & sled', title: 'Ski touring, sled runs and winter hiking' },
  ] as const;

  // legend: regions with their ski areas, then the other areas (old planner renderSkiAreaLegend)
  const legend = $derived.by(() => {
    const areas = app.skiAreas?.areas ?? [];
    const out: { area: SkiAreaSummary; nested: boolean }[] = [];
    const shown = new Set<string>();
    for (const region of areas.filter((a) => a.isRegion)) {
      out.push({ area: region, nested: false });
      shown.add(region.id);
      for (const child of areas.filter((a) => a.parent === region.id)) {
        out.push({ area: child, nested: true });
        shown.add(child.id);
      }
    }
    const others = areas.filter((a) => !shown.has(a.id));
    return { rows: out, others, heading: others.length > 0 && shown.size > 0 };
  });
  const counts = (a: SkiAreaSummary) =>
    [a.runs && `${a.runs} run${a.runs === 1 ? '' : 's'}`, a.lifts && `${a.lifts} lift${a.lifts === 1 ? '' : 's'}`].filter(Boolean).join(' · ');

  let emphasisTimer: ReturnType<typeof setTimeout> | null = null;
  function emphasize(a: SkiAreaSummary | null) {
    if (emphasisTimer) clearTimeout(emphasisTimer);
    app.explore.skiArea = a && !a.isRegion ? a.id : null;
  }
  function zoomTo(a: SkiAreaSummary) {
    emphasize(a);
    // touch has no hover: keep the emphasis a moment so the area is easy to find
    if (!app.desktop) emphasisTimer = setTimeout(() => (app.explore.skiArea = null), 2500);
    if (a.bbox) app.ui.fitTo([[a.bbox[0], a.bbox[1]], [a.bbox[2], a.bbox[3]]], { maxZoom: 15 });
  }

  function setSkiAreas(on: boolean) {
    d.showSkiAreas = on;
    if (on) void app.loadSkiAreas();
  }
</script>

{#snippet areaRow(a: SkiAreaSummary, nested: boolean)}
  <button
    type="button"
    class="row area"
    class:nested
    title={`${tap} to zoom to this area`}
    onmouseenter={() => app.desktop && emphasize(a)}
    onmouseleave={() => app.desktop && emphasize(null)}
    onfocus={() => emphasize(a)}
    onblur={() => emphasize(null)}
    onclick={() => zoomTo(a)}
    data-testid="ski-area-row"
  >
    <i class="swatch area-swatch" class:region={a.isRegion} style:background={a.isRegion ? 'transparent' : a.color} style:border-color={a.color}></i>
    <span class="txt">
      <span class="t">{a.name}</span>
      <span class="s">{a.isRegion ? `Region · ${counts(a)}` : counts(a)}</span>
    </span>
  </button>
{/snippet}

<div class="map-body" data-testid="map-sheet">
  {#if skiLayers}
    <h3 class="grp-h">Show</h3>
    <div class="grp">
      {#each SHOW as s (s.key)}
        <label class="row tappable" title={'title' in s ? s.title : undefined}>
          <span class="txt"><span class="t">{s.label}</span></span>
          <Switch checked={d.layers[s.key]} onchange={(v) => (d.layers[s.key] = v)} testid={`layer-${s.key}`} />
        </label>
      {/each}
    </div>
    <p class="grp-f">Hidden types also disappear from the labels and can't be {app.desktop ? 'clicked' : 'tapped'}.</p>

    <div class="grp-gap"></div>
    <h3 class="grp-h">Run colours</h3>
    <div class="grp" role="radiogroup" aria-label="Run colours">
      {#each [{ v: 'difficulty', t: 'Official difficulty' }, { v: 'slope', t: 'Steepness' }] as const as c (c.v)}
        <button type="button" class="row" role="radio" aria-checked={d.colorBy === c.v} onclick={() => (d.colorBy = c.v)} data-testid={`color-${c.v}`}>
          <span class="txt"><span class="t">{c.t}</span></span>
          {#if d.colorBy === c.v}<span class="chk"><Icon name="check" size={20} strokeWidth={2.6} /></span>{/if}
        </button>
      {/each}
    </div>
    {#if d.colorBy === 'slope'}
      <p class="grp-f legend" data-testid="slope-legend">
        {#each SLOPE_CLASSES as c (c.id)}<span><i class="swatch" style:background={c.color}></i>{c.label}</span>{/each}
      </p>
    {:else}
      <p class="grp-f">Steepness colours every ~50 m part of a run by its real gradient.</p>
    {/if}
    <div class="grp-gap"></div>
  {/if}

  <h3 class="grp-h">Extra</h3>
  <div class="grp">
    <label class="row tappable">
      <span class="txt"><span class="t">Ski areas in colour</span></span>
      <Switch checked={d.showSkiAreas} onchange={setSkiAreas} testid="show-ski-areas" />
    </label>
    {#if d.showSkiAreas}
      <div class="legend-list" data-testid="ski-area-legend">
        {#if app.skiAreasError}
          <div class="row"><span class="txt"><span class="s">{app.skiAreasError}</span></span></div>
        {:else if !app.skiAreas}
          <div class="row"><span class="txt"><span class="s">Loading the ski areas…</span></span></div>
        {:else}
          {#each legend.rows as r (r.area.id)}{@render areaRow(r.area, r.nested)}{/each}
          {#if legend.heading}<div class="row heading"><span class="s">Other areas nearby</span></div>{/if}
          {#each legend.others as a (a.id)}{@render areaRow(a, false)}{/each}
        {/if}
      </div>
    {/if}
    <label class="row tappable">
      <span class="txt"><span class="t">Route arrows</span></span>
      <Switch checked={d.showArrows} onchange={(v) => (d.showArrows = v)} testid="show-arrows" />
    </label>
    <label class="row tappable">
      <span class="txt"><span class="t">Route distances</span></span>
      <Switch checked={d.showDistances} onchange={(v) => (d.showDistances = v)} testid="show-distances" />
    </label>
  </div>
  {#if d.showSkiAreas}
    <p class="grp-f">{app.desktop ? 'Hover an area to highlight it, click it to zoom there.' : 'Tap an area to see it and zoom to it.'}</p>
  {/if}

  <div class="grp-gap"></div>
  <h3 class="grp-h">Terrain</h3>
  <div class="grp">
    <label class="row tappable">
      <span class="txt"><span class="t">Terrain</span><span class="s">Hillshading and contour lines</span></span>
      <Switch checked={d.terrain} onchange={(v) => app.setTerrain(v)} testid="terrain" />
    </label>
    <label class="row tappable">
      <span class="txt"><span class="t">3D terrain</span></span>
      <Switch checked={d.terrain3d} onchange={(v) => app.set3d(v)} testid="terrain-3d" />
    </label>
  </div>
  <p class="grp-f">
    {app.basemap === 'local' ? 'Terrain from your map data (Mapterhorn).' : 'Terrain from Mapterhorn online.'}
    3D tilts the map to show the mountains. {app.desktop ? 'Tilt with right-click drag or Ctrl + drag.' : 'Tilt with two fingers.'}
  </p>

  <div class="grp-gap"></div>
  <h3 class="grp-h">Base map</h3>
  {#if online}
    <div class="grp" role="radiogroup" aria-label="Base map" data-testid="basemap-choices">
      {#each basemapChoices(true) as b (b.id)}
        <button type="button" class="row" role="radio" aria-checked={d.basemap === b.id} onclick={() => app.setBasemap(b.id)} data-testid={`basemap-${b.id}`}>
          <span class="txt"><span class="t">{b.label}</span><span class="s">{b.sources}</span></span>
          {#if d.basemap === b.id}<span class="chk"><Icon name="check" size={20} strokeWidth={2.6} /></span>{/if}
        </button>
      {/each}
    </div>
    {#if app.onlineFailed || (!app.network && d.basemap !== 'local')}
      <p class="grp-f warn" data-testid="basemap-offline">No internet: the offline ski map is shown.</p>
    {:else if d.basemap === 'online'}
      <p class="grp-f">The run and lift lines are pictures here, so they can't be {app.desktop ? 'clicked' : 'tapped'}, hidden or coloured by steepness. Routing works as usual.</p>
    {:else if d.basemap === 'openfreemap'}
      <p class="grp-f">Online vector map with the runs and lifts from your map data.</p>
    {/if}
  {:else}
    <div class="grp">
      <div class="row"><span class="txt"><span class="t">{BASEMAPS[0].label}</span><span class="s">{BASEMAPS[0].sources}</span></span><span class="chk"><Icon name="check" size={20} strokeWidth={2.6} /></span></div>
    </div>
    <p class="grp-f" data-testid="basemap-offline-hint">
      Turn on online mode in <button type="button" class="link" onclick={() => app.ui.openMenu()}>Settings</button> to use online maps.
    </p>
  {/if}
</div>

<style>
  /* title with a subtitle line under it (terrain switch, base map sources) */
  .txt > .t,
  .txt > .s {
    display: block;
  }
  .legend {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 14px;
  }
  .legend span {
    display: inline-flex;
    align-items: center;
    gap: 5px;
  }
  .legend-list {
    position: relative;
  }
  .legend-list .row {
    --sep-inset: 44px;
  }
  .area {
    min-height: 48px;
    padding-left: 20px;
  }
  .area.nested {
    padding-left: 36px;
  }
  .area .txt {
    display: flex;
    flex-direction: column;
  }
  .area-swatch {
    width: 14px;
    height: 14px;
    border: 2px solid transparent;
    box-sizing: border-box;
  }
  .area-swatch.region {
    border-style: dashed;
  }
  .heading {
    min-height: 32px;
    padding-left: 20px;
  }
  .warn {
    color: var(--orange);
  }
  .link {
    border: 0;
    background: none;
    padding: 0;
    color: var(--accent);
    font: inherit;
    cursor: pointer;
  }
</style>
