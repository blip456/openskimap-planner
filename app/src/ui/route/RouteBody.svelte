<script lang="ts">
  // Content of the Route sheet (spec §3.2). Order at medium: summary → points → warnings → profile → directions →
  // Route settings row. Empty: empty state. Error: error block, points, Route settings row.
  import Icon from '../Icon.svelte';
  import RouteSummary from './RouteSummary.svelte';
  import PointList from './PointList.svelte';
  import ProfileChart from './ProfileChart.svelte';
  import Directions from './Directions.svelte';
  import RouteSettings from './RouteSettings.svelte';
  import SpeedSettings from './SpeedSettings.svelte';
  import type { AppState } from '../../lib/app.svelte.ts';

  let { app }: { app: AppState } = $props();
  const route = $derived(app.route);
  const ui = $derived(app.ui);
  const desktop = $derived(app.desktop);
  const n = $derived(route.points.length);
  const result = $derived(route.result);
</script>

{#snippet settingsRow()}
  <div class="grp-gap"></div>
  <div class="grp">
    <button type="button" class="row has-icon" onclick={() => (ui.routePage = 'settings')} data-testid="open-route-settings">
      <span class="tile" style:background="var(--gray)"><Icon name="slidersHorizontal" size={18} /></span>
      <span class="txt"><span class="t">Route settings</span></span>
      <span class="chev"><Icon name="chevronRight" size={14} strokeWidth={3} /></span>
    </button>
  </div>
  <p class="grp-f">Times use your speed setting. Always check the piste map and the conditions on the day.</p>
{/snippet}

{#if ui.routePage === 'settings'}
  <RouteSettings {route} onspeeds={() => (ui.routePage = 'speeds')} />
{:else if ui.routePage === 'speeds'}
  <SpeedSettings {route} />
{:else if n === 0}
  <div class="empty-state" data-testid="route-empty">
    <span class="icon"><Icon name="route" size={40} strokeWidth={1.75} /></span>
    <h3>Plan a route</h3>
    <p>{desktop ? 'Click' : 'Tap'} <b>Plan route</b>, then {desktop ? 'click' : 'tap'} the map: first the start, then the destination.</p>
    <div class="empty-buttons">
      <button type="button" class="cap-btn primary" disabled={app.locating} onclick={() => void app.startFromMyLocation()} data-testid="start-from-location">
        <Icon name={app.locating ? 'loader' : 'locateFixed'} size={17} /> {app.locating ? 'Finding your location…' : 'Start from my location'}
      </button>
      {#if !route.planMode}
        <button type="button" class="cap-btn" onclick={() => route.togglePlanMode(true)}>
          <Icon name="pencil" size={17} /> Plan route
        </button>
      {/if}
    </div>
  </div>
  {@render settingsRow()}
{:else}
  {#if route.error}
    <div class="grp error" role="alert" data-testid="route-error">
      <span class="err-icon"><Icon name="triangleAlert" size={22} /></span>
      <div class="err-text">
        <div class="err-title">No route found</div>
        <div class="err-body">{route.error}</div>
        <button type="button" class="cap-btn" onclick={() => (ui.routePage = 'settings')}>Route settings</button>
      </div>
    </div>
  {:else if result}
    <div class:stale={route.busy}>
      <RouteSummary {result} {desktop} />
    </div>
  {:else if route.busy}
    <p class="busy" data-testid="route-busy">Finding the route…</p>
  {/if}

  <PointList {route} {ui} {desktop} locating={app.locating} onstart={() => void app.startFromMyLocation()} />

  {#if result && !route.error}
    {#if result.warnings.length}
      <div class="grp" data-testid="route-warnings">
        {#each result.warnings as w (w)}
          <div class="row warning"><span class="warn-icon"><Icon name="triangleAlert" size={20} /></span><span>{w}</span></div>
        {/each}
      </div>
    {/if}
    <ProfileChart
      {result}
      {desktop}
      tall={ui.detent === 'large' || desktop}
      mode={app.display.profileColor}
      onmode={(m) => (app.display.profileColor = m)}
      oncursor={(p) => (ui.profileCursor = p)}
    />
    <Directions {result} {route} {ui} {desktop} />
  {/if}
  {@render settingsRow()}
{/if}

<style>
  .empty-buttons {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 8px;
  }
  .stale {
    opacity: 0.6;
    transition: opacity var(--dur-fast);
  }
  .busy {
    margin: 4px 4px 12px;
    font-size: var(--t-subhead);
    color: var(--label-2);
  }
  .error {
    display: flex;
    gap: 12px;
    padding: 14px 16px;
  }
  .err-icon {
    color: var(--red);
    display: grid;
    flex: none;
  }
  .err-title {
    font-weight: var(--fw-semibold);
  }
  .err-body {
    margin: 2px 0 10px;
    font-size: var(--t-subhead);
    color: var(--label-2);
  }
  .warning {
    align-items: flex-start;
    font-size: var(--t-subhead);
    line-height: 1.33;
    --sep-inset: 48px;
  }
  .warn-icon {
    color: var(--orange);
    display: grid;
    flex: none;
  }
</style>
