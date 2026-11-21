<script lang="ts">
  import { onMount, type Component } from 'svelte';
  import { AppState } from './lib/app.svelte.ts';
  import MapView from './ui/MapView.svelte';
  import type { MapApi, Padding } from './lib/map/types.ts';
  import NoData from './ui/NoData.svelte';
  import TabBar from './ui/TabBar.svelte';
  import GlassButton from './ui/GlassButton.svelte';
  import PlanButton from './ui/PlanButton.svelte';
  import ModePill from './ui/ModePill.svelte';
  import UndoRedo from './ui/UndoRedo.svelte';
  import TerrainButton from './ui/TerrainButton.svelte';
  import Compass from './ui/Compass.svelte';
  import LocateButton from './ui/LocateButton.svelte';
  import BottomSheet from './ui/BottomSheet.svelte';
  import SheetHeader from './ui/SheetHeader.svelte';
  import RouteHeader from './ui/route/RouteHeader.svelte';
  import RouteBody from './ui/route/RouteBody.svelte';
  import SavedHeader from './ui/saved/SavedHeader.svelte';
  import SavedBody from './ui/saved/SavedBody.svelte';
  import MapBody from './ui/map/MapBody.svelte';
  import InfoHeader from './ui/info/InfoHeader.svelte';
  import InfoBody from './ui/info/InfoBody.svelte';
  import InfoFloat from './ui/info/InfoFloat.svelte';
  import SearchOverlay from './ui/search/SearchOverlay.svelte';
  import DesktopPanel from './ui/DesktopPanel.svelte';
  import CreditLine from './ui/CreditLine.svelte';
  import Toast from './ui/Toast.svelte';
  import UpdatePrompt from './ui/UpdatePrompt.svelte';
  import { layoutFor, toastPlacement } from './lib/stores/ui.svelte.ts';
  import { isTyping, shortcutFor } from './lib/keyboard.ts';

  const app = new AppState();
  // test hook for the Playwright tests (?e2e), like window.__map in MapView
  if (new URLSearchParams(location.search).has('e2e')) (window as Window & { __app?: AppState }).__app = app;
  const route = app.route;
  const ui = app.ui;
  const explore = app.explore;
  const desktop = app.desktop;
  /** mouse hover highlights on the map only where there is a real hover (spec §2: hover inside (hover: hover)) */
  const hoverDevice = typeof matchMedia === 'function' && matchMedia('(hover: hover)').matches;

  let DevOverlay = $state<Component<{ app: AppState }> | null>(null);
  // the settings menu is opened rarely: its pages load on first use (phase 7, smaller start bundle; the service
  // worker precaches the chunk, so it also opens offline)
  let Menu = $state<Component<{ app: AppState; popover?: boolean }> | null>(null);
  $effect(() => {
    if (ui.menuOpen && !Menu) void import('./ui/menu/Menu.svelte').then((m) => (Menu = m.default));
  });
  let innerHeight = $state(800);
  let innerWidth = $state(1280);
  let mapApi: MapApi | null = null;

  onMount(() => {
    void app.start();
    // dev builds only: Vite replaces import.meta.env.DEV with false in production, and the import is dropped
    if (import.meta.env.DEV) void import('./ui/DevOverlay.svelte').then((m) => (DevOverlay = m.default));
    // PWA production build only: the service worker (offline start + update prompt). VITE_TARGET is replaced at build
    // time (not TARGET from platform/: only a literal here lets the desktop build drop the chunk); dev:pwa never registers a worker (it would get in the way of hot reload).
    if (import.meta.env.VITE_TARGET === 'pwa' && !import.meta.env.DEV && 'serviceWorker' in navigator) {
      void import('./lib/pwa/register.ts').then(({ registerServiceWorker }) => {
        const apply = registerServiceWorker({ onUpdateReady: () => (app.updateReady = true) });
        if (apply) app.applyUpdate = apply;
      });
    }
  });

  // desktop layout from 900 px (spec §3.11); between 600 and 899 the iPhone layout is used. A phone on its side
  // (height < 500) gets the panel on the left too, with touch-sized map buttons (spec §3.10).
  $effect(() => {
    const l = layoutFor(innerWidth, innerHeight);
    ui.landscape = l.landscape;
    ui.wide = l.wide;
  });
  /** desktop with a mouse: the smaller 36 px map toolbar of spec §3.11 (touch keeps 48 px buttons, 44 px targets) */
  const finePointer = typeof matchMedia === 'function' && matchMedia('(pointer: fine)').matches;
  const compact = $derived(ui.wide && !ui.landscape && finePointer);
  /** right edge of the left panel (map padding, spec §3.10/§3.11) */
  const panelRight = $derived(ui.landscape ? 8 + 360 : 12 + 380);
  // the panel always shows one tab
  $effect(() => {
    if (ui.wide && ui.sheet === null) ui.openSheet('route');
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

  /** iPhone: the info card temporarily replaces the tab sheet (no tab selected, spec §2.13) */
  const sheetContent = $derived(explore.card ? 'info' : ui.sheet);
  /** toasts move above the tab bar while a menu or a large sheet covers the top (4b review) */
  const placement = $derived(
    toastPlacement({ wide: ui.wide, menuOpen: ui.menuOpen, sheetOpen: app.status === 'ready' && sheetContent !== null, detent: ui.detent }),
  );
  let updateLater = $state(false);
  const showUpdate = $derived(app.updateReady && !updateLater);

  // map padding = the part of the map covered by the sheet at the medium detent (spec §2.9). At the large detent
  // the sheet covers the map anyway; the padding stays at the medium value so the camera does not jump.
  // Desktop: the panel on the left.
  const padding = $derived.by<Padding>(() => {
    if (ui.wide) return { top: 0, right: 0, bottom: 0, left: ui.panelHidden ? 0 : panelRight };
    if (!sheetContent) return { top: 0, right: 0, bottom: 0, left: 0 };
    // the medium top is always round(0.475 × H) (BottomSheet). Not ui.sheetTop: right after a large → medium change it
    // still holds the large top until the sheet settles, and the extra padding change would stop camera animations.
    const mediumTop = Math.round(innerHeight * 0.475);
    return { top: 0, right: 0, bottom: Math.max(0, innerHeight - mediumTop), left: 0 };
  });

  function onkeydown(e: KeyboardEvent) {
    if (app.status !== 'ready') return;
    const action = shortcutFor(e, isTyping(e.target));
    if (!action) return;
    e.preventDefault();
    if (action === 'undo') route.undo();
    else if (action === 'redo') route.redo();
    else if (action === 'plan') route.togglePlanMode();
    else if (action === 'search') openSearch();
    else if (action === 'escape') escape();
  }

  /** Esc closes the top-most layer (spec §4.7): menu → search → info card → sheet (iPhone) → plan mode. */
  function escape() {
    if (ui.menuOpen) ui.closeMenu();
    else if (ui.searchOpen) ui.searchOpen = false;
    else if (explore.card) closeInfo();
    else if (ui.sheet && !ui.wide) closeSheet();
    else route.togglePlanMode(false);
  }

  function openSearch() {
    if (ui.wide) {
      if (ui.panelHidden) ui.panelHidden = false;
      ui.focusSearch++;
    } else ui.searchOpen = true;
  }

  function closeSheet() {
    if (explore.card) {
      closeInfo();
      return;
    }
    ui.closeSheet();
    ui.profileCursor = null;
    ui.setHighlight(null);
  }

  function closeInfo() {
    explore.close();
    ui.profileCursor = null;
  }

  function selectTab(id: 'route' | 'saved' | 'map') {
    if (explore.card) {
      closeInfo();
      ui.openSheet(id);
      return;
    }
    if (ui.sheet === id) closeSheet();
    else ui.openSheet(id);
  }

  /** panel layout: the panel always shows a tab; an open info card (landscape) gives way to it */
  function selectPanelTab(id: 'route' | 'saved' | 'map') {
    if (explore.card) closeInfo();
    ui.openSheet(id);
  }

  function markerTap(i: number) {
    explore.close();
    ui.openSheet('route');
    ui.routePage = 'main';
    ui.flash(i);
  }

  // explore mode: a tap on empty map closes an open card; on the desktop the first one explains plan mode
  let explained = false;
  function emptyTap() {
    if (explore.card) {
      closeInfo();
      return;
    }
    if (desktop && !explained) {
      explained = true;
      ui.showToast('To add points, press ✎ Plan route (P).');
    }
  }

  function toggle3d() {
    app.display.terrain3d = !app.display.terrain3d;
  }

  const myLocation = app.location;
  /** compass button: points the map north; in "follow with heading" the map keeps following without turning */
  function resetNorth() {
    myLocation.northPressed();
    mapApi?.resetNorth();
  }

  // "Keep screen on while planning": while the setting is on and the map is open (released when hidden, asked again
  // when the app comes back; silent where not supported)
  $effect(() => {
    void app.wakeLock.setWanted(app.settings.keepAwake && app.status === 'ready');
  });
</script>

<svelte:window bind:innerHeight bind:innerWidth {onkeydown} />

{#snippet menuButton(size: number)}
  <span class="menu-wrap">
    <GlassButton icon="menu" label="Menu" {size} expanded={ui.menuOpen} onclick={() => (ui.menuOpen ? ui.closeMenu() : ui.openMenu())} testid="menu-button" />
    {#if app.settings.online}<i class="status-dot" class:offline={!app.network} aria-hidden="true"></i>{/if}
  </span>
{/snippet}

<!-- first-run screen: the update prompt is part of the page, so it never covers the logo (phase 5 handover) -->
{#snippet inlineUpdate()}
  <UpdatePrompt placement="inline" onreload={() => app.applyUpdate()} onlater={() => (updateLater = true)} />
{/snippet}

{#if app.status === 'starting'}
  <div class="splash" aria-busy="true"></div>
{:else if app.status === 'error'}
  <main class="fatal" role="alert" data-testid="fatal-error">
    <h1>Can't start the planner</h1>
    <p>{app.error}</p>
  </main>
{:else if app.status === 'no-data'}
  <NoData {app} top={showUpdate ? inlineUpdate : undefined} />
{:else if app.data && app.resort}
  {#key app.dataVersion}
    <MapView
      ds={app.data}
      resort={app.resort}
      {route}
      {ui}
      {explore}
      {myLocation}
      display={app.display}
      basemap={app.basemap}
      online={app.onlineUsable}
      skiAreas={app.skiAreas}
      {padding}
      hoverEnabled={hoverDevice}
      initialView={app.mapView}
      onview={(v) => app.setMapView(v)}
      onmarkertap={markerTap}
      onmaptap={() => {
        if (!ui.wide && sheetContent && ui.detent === 'large') {
          ui.detent = 'medium';
          return true;
        }
        if (route.planMode && explore.card) closeInfo();
        return false;
      }}
      onfeature={(f, at) => void explore.openFeature(f, at)}
      onemptytap={emptyTap}
      onfallback={(msg) => app.onlineFallback(msg)}
      onterrainmissing={() => {
        app.display.terrain3d = false;
        ui.showToast('3D needs terrain data. Turn on online mode or build the data with terrain.');
      }}
      onready={(api) => (mapApi = api)}
    />
  {/key}

  {#if ui.wide && ui.landscape}
    <!-- landscape phone (spec §3.10): panel on the left; map buttons as on the phone, 48 px for touch -->
    {#if !ui.panelHidden}<DesktopPanel {app} landscape onselect={selectPanelTab} oncloseinfo={closeInfo} />{:else}<div class="top-left">{@render menuButton(48)}</div>{/if}
    <div class="top-right">
      <UndoRedo canUndo={route.canUndo} canRedo={route.canRedo} onundo={() => route.undo()} onredo={() => route.redo()} {desktop} />
      <TerrainButton on={app.display.terrain3d} ontoggle={toggle3d} />
    </div>
    <div class="compass-slot">
      <Compass bearing={ui.bearing} pitch={app.display.terrain3d ? 0 : ui.pitch} force={myLocation.mode === 'heading'} onreset={resetNorth} />
    </div>
    {#if route.planMode}
      <div class="mode-row landscape" class:full={ui.panelHidden}>
        <ModePill points={route.points.length} {desktop} onstop={() => route.togglePlanMode(false)} />
      </div>
    {/if}
    <div class="controls landscape" class:full={ui.panelHidden}>
      <span class="group">
        <GlassButton
          icon="panelLeft"
          label={ui.panelHidden ? 'Show the panel' : 'Hide the panel'}
          active={!ui.panelHidden}
          onclick={() => (ui.panelHidden = !ui.panelHidden)}
          testid="panel-toggle"
        />
        <PlanButton on={route.planMode} {desktop} ontoggle={() => route.togglePlanMode()} />
      </span>
      <LocateButton mode={myLocation.mode} ontap={() => myLocation.tap()} />
    </div>
    {#if ui.panelHidden}<InfoFloat {app} onclose={closeInfo} />{/if}
  {:else if ui.wide}
    <!-- desktop: panel on the left, toolbar at the top of the map area, map buttons bottom right (36 px, spec §3.11) -->
    {#if !ui.panelHidden}<DesktopPanel {app} />{/if}
    <div class="toolbar" class:full={ui.panelHidden}>
      <GlassButton
        icon="panelLeft"
        label={ui.panelHidden ? 'Show the panel' : 'Hide the panel'}
        active={!ui.panelHidden}
        size={compact ? 36 : 48}
        onclick={() => (ui.panelHidden = !ui.panelHidden)}
        testid="panel-toggle"
      />
      {#if ui.panelHidden}{@render menuButton(compact ? 36 : 48)}{/if}
      <PlanButton on={route.planMode} {desktop} {compact} ontoggle={() => route.togglePlanMode()} />
      <UndoRedo canUndo={route.canUndo} canRedo={route.canRedo} onundo={() => route.undo()} onredo={() => route.redo()} {desktop} {compact} />
      <TerrainButton on={app.display.terrain3d} ontoggle={toggle3d} {compact} />
    </div>
    {#if route.planMode}
      <div class="mode-row wide" class:full={ui.panelHidden}>
        <ModePill points={route.points.length} desktop onstop={() => route.togglePlanMode(false)} />
      </div>
    {/if}
    <div class="right-column" class:compact>
      <Compass bearing={ui.bearing} pitch={app.display.terrain3d ? 0 : ui.pitch} size={compact ? 36 : 48} force={myLocation.mode === 'heading'} onreset={resetNorth} />
      <div class="glass zoom" role="group" aria-label="Zoom">
        <button type="button" aria-label="Zoom in" title="Zoom in" onclick={() => mapApi?.zoomIn()} data-testid="zoom-in">+</button>
        <span class="divider" aria-hidden="true"></span>
        <button type="button" aria-label="Zoom out" title="Zoom out" onclick={() => mapApi?.zoomOut()} data-testid="zoom-out">−</button>
      </div>
      <LocateButton mode={myLocation.mode} size={compact ? 36 : 48} ontap={() => myLocation.tap()} />
    </div>
    <InfoFloat {app} onclose={closeInfo} column={compact ? 36 : 48} />
    <CreditLine wide onopen={() => ui.openMenu('about')} />
  {:else}
    <div class="top-left">{@render menuButton(48)}</div>
    <div class="top-right">
      <UndoRedo canUndo={route.canUndo} canRedo={route.canRedo} onundo={() => route.undo()} onredo={() => route.redo()} {desktop} />
      <TerrainButton on={app.display.terrain3d} ontoggle={toggle3d} />
    </div>
    <div class="compass-slot">
      <Compass bearing={ui.bearing} pitch={app.display.terrain3d ? 0 : ui.pitch} force={myLocation.mode === 'heading'} onreset={resetNorth} />
    </div>

    {#if route.planMode}
      <div class="mode-row">
        <ModePill points={route.points.length} {desktop} onstop={() => route.togglePlanMode(false)} />
      </div>
    {/if}

    <div class="controls" class:on-sheet={sheetContent !== null} class:under-large={sheetContent !== null && ui.detent === 'large'}>
      <PlanButton on={route.planMode} {desktop} ontoggle={() => route.togglePlanMode()} />
      <LocateButton mode={myLocation.mode} ontap={() => myLocation.tap()} />
    </div>

    {#if !sheetContent && !ui.searchOpen}<CreditLine onopen={() => ui.openMenu('about')} />{/if}

    <!-- the search field and its results replace the sheet while searching (no glass on glass) -->
    {#if sheetContent && !ui.searchOpen}
      <BottomSheet
        detent={ui.detent}
        labelledby="sheet-title"
        ondetent={(d) => (ui.detent = d)}
        onsettle={(top) => (ui.sheetTop = top)}
        onclose={closeSheet}
        testid={sheetContent === 'info' ? 'info-sheet' : 'sheet'}
        scrollKey={`${sheetContent}:${ui.routePage}:${explore.card?.title ?? ''}`}
      >
        {#snippet header()}
          {#if sheetContent === 'info' && explore.card}
            <InfoHeader card={explore.card} onclose={closeInfo} />
          {:else if sheetContent === 'route'}
            <RouteHeader {app} onclose={closeSheet} />
          {:else if sheetContent === 'saved'}
            <SavedHeader {app} onclose={closeSheet} />
          {:else}
            <SheetHeader title="Map" onclose={closeSheet} />
          {/if}
        {/snippet}
        {#if sheetContent === 'info'}
          <InfoBody {app} tall={ui.detent === 'large'} />
        {:else if sheetContent === 'route'}
          {#key ui.routePage}<RouteBody {app} />{/key}
        {:else if sheetContent === 'saved'}
          <SavedBody {app} />
        {:else}
          <MapBody {app} />
        {/if}
      </BottomSheet>
    {/if}

    {#if ui.searchOpen}
      <SearchOverlay search={app.search} onclose={() => (ui.searchOpen = false)} />
    {:else}
      <TabBar open={explore.card ? null : ui.sheet} onselect={selectTab} onsearch={openSearch} />
    {/if}
  {/if}

  {#if ui.menuOpen && Menu}<Menu {app} popover={ui.wide && !ui.landscape} />{/if}
{/if}

{#if showUpdate && app.status !== 'no-data'}<UpdatePrompt {placement} onreload={() => app.applyUpdate()} onlater={() => (updateLater = true)} />{/if}
{#if ui.toast}<Toast toast={ui.toast} ondone={() => ui.hideToast()} {placement} shift={showUpdate && app.status !== 'no-data' ? 52 : 0} />{/if}
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
  .menu-wrap {
    position: relative;
    display: inline-block;
  }
  /* online mode on: small status dot (orange without network), spec §3.1 */
  .status-dot {
    position: absolute;
    top: 2px;
    right: 2px;
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: var(--accent);
    box-shadow: 0 0 0 2px #fff;
    pointer-events: none;
  }
  .status-dot.offline {
    background: var(--orange);
  }
  .top-right {
    position: fixed;
    z-index: var(--z-controls);
    top: var(--controls-top);
    right: calc(var(--edge) + var(--safe-right));
    display: flex;
    gap: 8px;
  }
  .compass-slot {
    position: fixed;
    z-index: var(--z-controls);
    top: calc(var(--controls-top) + 56px);
    right: calc(var(--edge) + var(--safe-right));
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
  .mode-row.wide {
    top: 72px;
    left: calc(12px + var(--panel-w) + 12px);
    right: 72px;
  }
  .mode-row.wide.full {
    left: 12px;
  }
  .mode-row.landscape {
    top: calc(var(--controls-top) + 4px);
    left: calc(8px + 360px + 16px + var(--safe-left));
    right: calc(var(--edge) + 160px + var(--safe-right));
  }
  .mode-row.landscape.full {
    left: calc(var(--edge) + var(--ctl) + 8px + var(--safe-left));
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
   * detent (spec §2.9) */
  .controls.on-sheet {
    bottom: auto;
    top: calc(var(--sheet-y, var(--sheet-medium-top)) - 16px - var(--ctl));
    opacity: calc(1 - 2 * var(--sheet-progress, 0));
  }
  .controls.under-large {
    visibility: hidden;
  }
  /* landscape phone: Plan (with the panel button) bottom left of the map area, Locate bottom right (spec §3.10) */
  .controls.landscape {
    left: calc(8px + 360px + 16px + var(--safe-left));
    bottom: calc(16px + var(--safe-bottom));
  }
  .controls.landscape.full {
    left: calc(var(--edge) + var(--safe-left));
  }
  .controls .group {
    display: flex;
    gap: 8px;
  }
  /* desktop map toolbar (spec §3.11) */
  .toolbar {
    position: fixed;
    z-index: var(--z-controls);
    top: 12px;
    left: calc(12px + var(--panel-w) + 12px);
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .toolbar.full {
    left: 12px;
  }
  .right-column {
    position: fixed;
    z-index: var(--z-controls);
    right: calc(12px + var(--safe-right));
    bottom: 32px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
  }
  .zoom {
    display: flex;
    flex-direction: column;
    align-items: center;
    width: 48px;
    border-radius: var(--r-pill);
    padding: 2px 0;
  }
  .zoom button {
    width: 44px;
    height: 44px;
    border: 0;
    border-radius: 22px;
    background: none;
    color: inherit;
    font: 400 24px/1 var(--font);
    cursor: pointer;
  }
  @media (hover: hover) {
    .zoom button:hover {
      background: var(--glass-pill);
    }
  }
  .right-column.compact {
    gap: 8px;
  }
  .compact .zoom {
    width: 36px;
    padding: 0;
  }
  .compact .zoom button {
    width: 36px;
    height: 36px;
    border-radius: 18px;
    font-size: 20px;
  }
  .compact .zoom .divider {
    width: 18px;
  }
  .zoom .divider {
    width: 24px;
    height: 0.5px;
    background: var(--label-3);
  }
</style>
