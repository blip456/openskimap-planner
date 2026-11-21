<script lang="ts">
  // Desktop layout (≥ 900 px, spec §3.11): floating panel on the left. Glass header with the search field (⌘K),
  // the menu button and Route · Saved · Map as a segmented control; solid body with the same header/body parts as
  // the iPhone sheets. The panel is never "closed"; the panel button in the map toolbar hides it.
  import GlassButton from './GlassButton.svelte';
  import Segmented from './Segmented.svelte';
  import PanelSearch from './search/PanelSearch.svelte';
  import RouteHeader from './route/RouteHeader.svelte';
  import RouteBody from './route/RouteBody.svelte';
  import SavedHeader from './saved/SavedHeader.svelte';
  import SavedBody from './saved/SavedBody.svelte';
  import SheetHeader from './SheetHeader.svelte';
  import MapBody from './map/MapBody.svelte';
  import type { AppState } from '../lib/app.svelte.ts';
  import type { SheetId } from '../lib/stores/ui.svelte.ts';

  let { app }: { app: AppState } = $props();
  const ui = $derived(app.ui);
  const tab = $derived<SheetId>(ui.sheet ?? 'route');
  let body = $state<HTMLDivElement>();

  // another tab or sub-page starts at the top
  $effect(() => {
    void tab;
    void ui.routePage;
    if (body) body.scrollTop = 0;
  });
</script>

<aside class="panel" aria-label="Planner" data-testid="panel">
  <header class="head glass">
    <div class="top">
      <PanelSearch search={app.search} focus={ui.focusSearch} />
      <GlassButton icon="menu" label="Menu" size={32} expanded={ui.menuOpen} onclick={() => (ui.menuOpen ? ui.closeMenu() : ui.openMenu())} testid="menu-button" />
    </div>
    <Segmented
      label="Panel"
      value={tab}
      onchange={(id) => ui.openSheet(id)}
      testid="panel-tabs"
      options={[
        { value: 'route', label: 'Route', testid: 'tab-route' },
        { value: 'saved', label: 'Saved', testid: 'tab-saved' },
        { value: 'map', label: 'Map', testid: 'tab-map' },
      ]}
    />
  </header>
  <div class="body" bind:this={body} data-testid="sheet-body">
    <div class="sheet-head-wrap">
      {#if tab === 'route'}
        <RouteHeader {app} />
      {:else if tab === 'saved'}
        <SavedHeader {app} />
      {:else}
        <SheetHeader title="Map" />
      {/if}
    </div>
    <div class="content">
      {#if tab === 'route'}
        {#key ui.routePage}<RouteBody {app} />{/key}
      {:else if tab === 'saved'}
        <SavedBody {app} />
      {:else}
        <MapBody {app} />
      {/if}
    </div>
  </div>
</aside>

<style>
  .panel {
    position: fixed;
    z-index: var(--z-sheet);
    top: 12px;
    left: calc(12px + var(--safe-left));
    bottom: 12px;
    width: var(--panel-w);
    display: flex;
    flex-direction: column;
    border-radius: var(--r-panel);
    overflow: hidden;
    background: var(--bg-grouped);
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.18), 0 1px 3px rgba(0, 0, 0, 0.08);
    color: var(--label);
    /* inner radius = panel radius − padding (spec §1.3) */
    --r-cell: 12px;
  }
  .head {
    position: relative;
    z-index: 2;
    flex: none;
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 12px;
    border-radius: var(--r-panel) var(--r-panel) 0 0;
    box-shadow: 0 0.5px 0 var(--separator);
    color: var(--label);
  }
  .top {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
  }
  .sheet-head-wrap {
    padding-top: 6px;
  }
  .content {
    padding: 4px 12px 24px;
  }
</style>
