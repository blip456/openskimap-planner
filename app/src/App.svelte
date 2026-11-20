<script lang="ts">
  import { onMount, type Component } from 'svelte';
  import { AppState } from './lib/app.svelte.ts';
  import MapView from './ui/MapView.svelte';
  import NoData from './ui/NoData.svelte';
  import TabBar from './ui/TabBar.svelte';
  import GlassButton from './ui/GlassButton.svelte';
  import PlanButton from './ui/PlanButton.svelte';
  import ModePill from './ui/ModePill.svelte';
  import BottomSheet from './ui/BottomSheet.svelte';
  import RouteSheet from './ui/RouteSheet.svelte';
  import CreditLine from './ui/CreditLine.svelte';
  import Toast from './ui/Toast.svelte';

  const app = new AppState();
  const route = app.route;
  const ui = app.ui;
  const desktop = typeof matchMedia === 'function' && matchMedia('(hover: hover) and (pointer: fine)').matches;

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

  const sheetTitles = { route: 'Route', saved: 'Saved routes', map: 'Map' } as const;
  // map padding = the part of the map covered by the medium sheet (its top is at 47.5 % of the height)
  const bottomPadding = $derived(ui.sheet ? Math.round(innerHeight * 0.525) : 0);

  function onkeydown(e: KeyboardEvent) {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if (app.status !== 'ready' || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'p' || e.key === 'P') route.togglePlanMode();
    else if (e.key === 'Escape') {
      if (ui.sheet) ui.closeSheet();
      else route.togglePlanMode(false);
    }
  }

  const soon = (what: string, phase: number) => ui.showToast(`${what} comes in phase ${phase}.`);
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
    <MapView ds={app.data} resort={app.resort} {route} {bottomPadding} onmarkertap={() => ui.openSheet('route')} />
  {/key}

  <div class="top-left">
    <GlassButton icon="menu" label="Menu" onclick={() => soon('The settings menu', 4)} />
  </div>

  {#if route.planMode}
    <div class="mode-row">
      <ModePill points={route.points.length} {desktop} onstop={() => route.togglePlanMode(false)} />
    </div>
  {/if}

  <div class="controls" class:on-sheet={ui.sheet !== null}>
    <PlanButton on={route.planMode} {desktop} ontoggle={() => route.togglePlanMode()} />
    <GlassButton icon="navigation" label="Show my location" onclick={() => soon('My location', 6)} />
  </div>

  {#if !ui.sheet}<CreditLine />{/if}

  {#if ui.sheet}
    <BottomSheet
      title={sheetTitles[ui.sheet]}
      subtitle={ui.sheet === 'route' ? app.resort.name : undefined}
      onclose={() => ui.closeSheet()}
    >
      {#if ui.sheet === 'route'}
        <RouteSheet {route} {desktop} />
      {:else}
        <p class="later">This panel comes in phase 4.</p>
      {/if}
    </BottomSheet>
  {/if}

  <TabBar open={ui.sheet} onselect={(id) => ui.toggleSheet(id)} onsearch={() => soon('Search', 4)} />
{/if}

{#if ui.toast}<Toast text={ui.toast} />{/if}
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
  /* at the medium detent the Plan and Locate buttons ride 16 px above the sheet (spec §2.9); on wide screens the
   * sheet (max 560 px, centred) leaves them free */
  @media (max-width: 899px) {
    .controls.on-sheet {
      bottom: calc(100% - var(--sheet-medium-top) + 16px);
    }
  }
  .later {
    color: var(--label-2);
    font-size: var(--t-subhead);
  }
</style>
