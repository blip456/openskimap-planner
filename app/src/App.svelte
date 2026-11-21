<script lang="ts">
  import { onMount, type Component } from 'svelte';
  import { AppState } from './lib/app.svelte.ts';
  import MapView from './ui/MapView.svelte';
  import NoData from './ui/NoData.svelte';
  import TabBar from './ui/TabBar.svelte';
  import GlassButton from './ui/GlassButton.svelte';
  import PlanButton from './ui/PlanButton.svelte';
  import ModePill from './ui/ModePill.svelte';
  import UndoRedo from './ui/UndoRedo.svelte';
  import BottomSheet from './ui/BottomSheet.svelte';
  import SheetHeader from './ui/SheetHeader.svelte';
  import RouteHeader from './ui/route/RouteHeader.svelte';
  import RouteBody from './ui/route/RouteBody.svelte';
  import SavedHeader from './ui/saved/SavedHeader.svelte';
  import SavedBody from './ui/saved/SavedBody.svelte';
  import CreditLine from './ui/CreditLine.svelte';
  import Toast from './ui/Toast.svelte';
  import { isTyping, shortcutFor } from './lib/keyboard.ts';

  const app = new AppState();
  // test hook for the Playwright tests (?e2e), like window.__map in MapView
  if (new URLSearchParams(location.search).has('e2e')) (window as Window & { __app?: AppState }).__app = app;
  const route = app.route;
  const ui = app.ui;
  const desktop = app.desktop;

  let DevOverlay = $state<Component<{ app: AppState }> | null>(null);
  let innerHeight = $state(800);

  onMount(() => {
    void app.start();
    // dev builds only: Vite replaces import.meta.env.DEV with false in production, and the import is dropped
    if (import.meta.env.DEV) void import('./ui/DevOverlay.svelte').then((m) => (DevOverlay = m.default));
  });

  $effect(() => {
    document.documentElement.toggleAttribute('data-solid', app.settings.solid);
  });

  // open the Route sheet when the first route appears
  let hadResult = false;
  $effect(() => {
    const has = route.result !== null || route.error !== null;
    if (has && !hadResult && ui.sheet === null && route.points.length >= 2) ui.openSheet('route');
    hadResult = has;
  });

  // map padding = the part of the map covered by the sheet at the medium detent (spec §2.9). At the large detent
  // the sheet covers the map anyway; the padding stays at the medium value so the camera does not jump.
  const bottomPadding = $derived.by(() => {
    if (!ui.sheet) return 0;
    const mediumTop = ui.detent === 'medium' && ui.sheetTop !== null ? ui.sheetTop : Math.round(innerHeight * 0.475);
    return Math.max(0, innerHeight - mediumTop);
  });

  function onkeydown(e: KeyboardEvent) {
    if (app.status !== 'ready') return;
    const action = shortcutFor(e, isTyping(e.target));
    if (!action) return;
    e.preventDefault();
    if (action === 'undo') route.undo();
    else if (action === 'redo') route.redo();
    else if (action === 'plan') route.togglePlanMode();
    else if (action === 'escape') {
      if (ui.sheet) closeSheet();
      else route.togglePlanMode(false);
    }
  }

  function closeSheet() {
    ui.closeSheet();
    ui.profileCursor = null;
    ui.setHighlight(null);
  }

  function markerTap(i: number) {
    ui.openSheet('route');
    ui.routePage = 'main';
    ui.flash(i);
  }

  const soon = (what: string) => ui.showToast(`${what} comes in the next update.`);
</script>

<svelte:window bind:innerHeight {onkeydown} />

{#if app.status === 'starting'}
  <div class="splash" aria-busy="true"></div>
{:else if app.status === 'error'}
  <main class="fatal" role="alert" data-testid="fatal-error">
    <h1>Can't start the planner</h1>
    <p>{app.error}</p>
  </main>
{:else if app.status === 'no-data'}
  <NoData {app} />
{:else if app.data && app.resort}
  {#key app.dataVersion}
    <MapView
      ds={app.data}
      resort={app.resort}
      {route}
      {ui}
      display={app.display}
      {bottomPadding}
      initialView={app.mapView}
      onview={(v) => app.setMapView(v)}
      onmarkertap={markerTap}
      onmaptap={() => {
        if (ui.sheet && ui.detent === 'large') {
          ui.detent = 'medium';
          return true;
        }
        return false;
      }}
    />
  {/key}

  <div class="top-left">
    <GlassButton icon="menu" label="Menu" onclick={() => soon('The settings menu')} />
  </div>
  <!-- top-right row: undo/redo, then the 3D capsule (phase 4b) -->
  <div class="top-right">
    <UndoRedo canUndo={route.canUndo} canRedo={route.canRedo} onundo={() => route.undo()} onredo={() => route.redo()} {desktop} />
  </div>

  {#if route.planMode}
    <div class="mode-row">
      <ModePill points={route.points.length} {desktop} onstop={() => route.togglePlanMode(false)} />
    </div>
  {/if}

  <div class="controls" class:on-sheet={ui.sheet !== null} class:under-large={ui.sheet !== null && ui.detent === 'large'}>
    <PlanButton on={route.planMode} {desktop} ontoggle={() => route.togglePlanMode()} />
    <GlassButton icon="navigation" label="Show my location" onclick={() => soon('My location')} />
  </div>

  {#if !ui.sheet}<CreditLine />{/if}

  {#if ui.sheet}
    <BottomSheet
      detent={ui.detent}
      labelledby="sheet-title"
      ondetent={(d) => (ui.detent = d)}
      onsettle={(top) => (ui.sheetTop = top)}
      onclose={closeSheet}
      scrollKey={`${ui.sheet}:${ui.routePage}`}
    >
      {#snippet header()}
        {#if ui.sheet === 'route'}
          <RouteHeader {app} onclose={closeSheet} />
        {:else if ui.sheet === 'saved'}
          <SavedHeader {app} onclose={closeSheet} />
        {:else}
          <SheetHeader title="Map" onclose={closeSheet} />
        {/if}
      {/snippet}
      {#if ui.sheet === 'route'}
        {#key ui.routePage}<RouteBody {app} />{/key}
      {:else if ui.sheet === 'saved'}
        <SavedBody {app} />
      {:else}
        <p class="later">The map options come in the next update.</p>
      {/if}
    </BottomSheet>
  {/if}

  <TabBar open={ui.sheet} onselect={(id) => (ui.sheet === id ? closeSheet() : ui.openSheet(id))} onsearch={() => soon('Search')} />
{/if}

{#if ui.toast}<Toast toast={ui.toast} ondone={() => ui.hideToast()} />{/if}
{#if DevOverlay}<DevOverlay {app} />{/if}

<style>
  .splash {
    position: fixed;
    inset: 0;
    background: var(--bg-grouped);
  }
  .fatal {
    position: fixed;
    inset: 0;
    padding: calc(var(--safe-top) + 40px) 24px;
    background: var(--bg-grouped);
    text-align: center;
  }
  .fatal h1 {
    font-size: var(--t-title3);
  }
  .fatal p {
    color: var(--label-2);
  }
  .top-left {
    position: fixed;
    z-index: var(--z-controls);
    top: var(--controls-top);
    left: calc(var(--edge) + var(--safe-left));
  }
  .top-right {
    position: fixed;
    z-index: var(--z-controls);
    top: var(--controls-top);
    right: calc(var(--edge) + var(--safe-right));
    display: flex;
    gap: 8px;
  }
  /* mode pill: centred in the width left of the compass column (spec §2.5) */
  .mode-row {
    position: fixed;
    z-index: var(--z-mode-pill);
    top: calc(var(--controls-top) + 56px);
    left: calc(var(--edge) + var(--safe-left));
    right: calc(var(--edge) + var(--ctl) + 8px + var(--safe-right));
    display: flex;
    justify-content: center;
    pointer-events: none;
  }
  .mode-row > :global(*) {
    pointer-events: auto;
  }
  .controls {
    position: fixed;
    z-index: var(--z-controls);
    left: calc(var(--edge) + var(--safe-left));
    right: calc(var(--edge) + var(--safe-right));
    bottom: var(--controls-bottom);
    display: flex;
    justify-content: space-between;
    align-items: center;
    pointer-events: none;
  }
  .controls > :global(*) {
    pointer-events: auto;
  }
  /* at the medium detent the Plan and Locate buttons ride 16 px above the sheet and fade out towards the large
   * detent (spec §2.9); on wide screens the sheet (max 560 px, centred) leaves them free */
  @media (max-width: 899px) {
    .controls.on-sheet {
      bottom: auto;
      top: calc(var(--sheet-y, var(--sheet-medium-top)) - 16px - var(--ctl));
      opacity: calc(1 - 2 * var(--sheet-progress, 0));
    }
    .controls.under-large {
      visibility: hidden;
    }
  }
  .later {
    color: var(--label-2);
    font-size: var(--t-subhead);
  }
</style>
