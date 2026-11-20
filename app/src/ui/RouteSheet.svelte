<script lang="ts">
  // Route sheet content (spec §3.2): empty state, summary (Time · Distance · Descent + chips), points, warnings.
  import Icon from './Icon.svelte';
  import type { RouteState } from '../lib/stores/route.svelte.ts';
  import { pointLetter, pointRole } from '../lib/stores/route.svelte.ts';
  import { formatDistance, formatDuration, splitUnit } from '../lib/format.ts';

  let { route, desktop = false }: { route: RouteState; desktop?: boolean } = $props();

  const n = $derived(route.points.length);
  const summary = $derived(route.result?.summary ?? null);
  const roleLabel = { start: 'Start', stop: 'Stop', end: 'Destination' } as const;
  const stats = $derived(
    summary
      ? [
          { label: 'Time', ...splitUnit(`~${formatDuration(summary.duration)}`) },
          { label: 'Distance', ...splitUnit(formatDistance(summary.distance)) },
          { label: 'Descent', value: String(Math.round(summary.descent)), unit: 'm' },
        ]
      : [],
  );
  const chips = $derived(
    summary
      ? [
          `${formatDistance(summary.runDistance)} skiing`,
          `${summary.liftCount} ${summary.liftCount === 1 ? 'lift' : 'lifts'}`,
          `↑ ${Math.round(summary.ascent)} m`,
        ]
      : [],
  );
</script>

{#if n === 0}
  <div class="empty">
    <span class="empty-icon"><Icon name="route" size={40} strokeWidth={1.75} /></span>
    <h3>Plan a route</h3>
    <p>{desktop ? 'Click' : 'Tap'} <b>Plan route</b>, then {desktop ? 'click' : 'tap'} the map: first the start, then the destination.</p>
    {#if !route.planMode}
      <button type="button" class="btn" onclick={() => route.togglePlanMode(true)}>Plan route</button>
    {/if}
  </div>
{:else}
  {#if route.error}
    <div class="group error" role="alert" data-testid="route-error">
      <span class="warn-icon red"><Icon name="triangleAlert" size={20} /></span>
      <div>
        <div class="error-title">No route found</div>
        <div class="error-text">{route.error}</div>
      </div>
    </div>
  {:else if summary}
    <div class="group summary" aria-live="polite" data-testid="route-summary">
      <div class="stats">
        {#each stats as s (s.label)}
          <div class="stat">
            <div class="stat-label">{s.label}</div>
            <div class="stat-value">{s.value}<span class="unit"> {s.unit}</span></div>
          </div>
        {/each}
      </div>
      <div class="chips">
        {#each chips as c (c)}<span class="chip">{c}</span>{/each}
      </div>
    </div>
    {#if route.result && route.result.warnings.length}
      <div class="group">
        {#each route.result.warnings as w (w)}
          <div class="row warning"><span class="warn-icon"><Icon name="triangleAlert" size={20} /></span><span>{w}</span></div>
        {/each}
      </div>
    {/if}
  {:else if route.busy}
    <p class="hint">Finding the route…</p>
  {/if}

  <div class="group points" data-testid="route-points">
    {#each route.points as p, i (i)}
      <div class="row point">
        <span class={`badge ${pointRole(i, n)}`}>{pointLetter(i)}</span>
        <div class="point-text">
          <div class="point-title">{p[1].toFixed(5)}, {p[0].toFixed(5)}</div>
          <div class="point-sub">{roleLabel[pointRole(i, n)]}</div>
        </div>
        <button type="button" class="remove" aria-label={`Remove point ${pointLetter(i)}`} onclick={() => route.removePoint(i)}>
          <Icon name="circleX" size={22} />
        </button>
      </div>
    {/each}
    {#if n === 1}
      <div class="row hint-row">Now {desktop ? 'click' : 'tap'} the map to set the destination.</div>
    {/if}
  </div>
  <div class="actions">
    <button type="button" class="capsule" disabled={n < 2} onclick={() => route.reverse()}>
      <Icon name="arrowUpDown" size={17} /> Reverse
    </button>
    <button type="button" class="capsule destructive" onclick={() => route.clear()}>
      <Icon name="trash" size={17} /> Clear
    </button>
  </div>
{/if}

<style>
  .group {
    background: color-mix(in srgb, var(--bg-cell) 72%, transparent);
    border-radius: var(--r-cell);
    overflow: hidden;
    margin-bottom: 8px;
  }
  .empty {
    text-align: center;
    padding: 16px 8px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
  }
  .empty-icon {
    color: var(--label-3);
  }
  .empty h3 {
    margin: 4px 0 0;
    font-size: var(--t-body);
    font-weight: var(--fw-semibold);
  }
  .empty p {
    margin: 0;
    max-width: 280px;
    font-size: var(--t-subhead);
    color: var(--label-2);
  }
  .btn {
    margin-top: 8px;
    height: 36px;
    padding: 0 16px;
    border: 0;
    border-radius: var(--r-pill);
    background: var(--fill-3);
    color: var(--accent);
    font: 600 var(--t-subhead) var(--font);
    cursor: pointer;
  }
  .stats {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    padding: 12px 0 8px;
  }
  .stat {
    padding: 0 12px 0 16px;
  }
  .stat + .stat {
    border-left: 0.5px solid var(--separator);
  }
  .stat-label {
    font-size: var(--t-caption);
    font-weight: var(--fw-semibold);
    text-transform: uppercase;
    letter-spacing: 0.3px;
    color: var(--label-2);
  }
  .stat-value {
    font: 600 var(--t-title2) var(--font-rounded);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .unit {
    font-size: var(--t-subhead);
    color: var(--label-2);
  }
  .chips {
    display: flex;
    gap: 6px;
    overflow-x: auto;
    padding: 0 16px 12px;
    scrollbar-width: none;
  }
  .chip {
    flex: none;
    height: 26px;
    line-height: 26px;
    padding: 0 10px;
    border-radius: 13px;
    background: var(--fill-3);
    font-size: var(--t-footnote);
    font-weight: var(--fw-semibold);
    white-space: nowrap;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 12px;
    min-height: 44px;
    padding: 10px 16px;
    box-sizing: border-box;
  }
  .row + .row {
    border-top: 0.5px solid var(--separator);
  }
  .warning {
    font-size: var(--t-subhead);
  }
  .warn-icon {
    color: var(--orange);
    display: grid;
    flex: none;
  }
  .warn-icon.red {
    color: var(--red);
  }
  .error {
    display: flex;
    gap: 12px;
    padding: 12px 16px;
  }
  .error-title {
    font-weight: var(--fw-semibold);
  }
  .error-text {
    font-size: var(--t-subhead);
    color: var(--label-2);
  }
  .badge {
    flex: none;
    width: 26px;
    height: 26px;
    border-radius: 50%;
    display: grid;
    place-items: center;
    color: #fff;
    font: 700 13px var(--font-rounded);
  }
  .badge.start {
    background: var(--point-start);
  }
  .badge.stop {
    background: var(--point-stop);
  }
  .badge.end {
    background: var(--point-end);
  }
  .point-text {
    flex: 1;
    min-width: 0;
  }
  .point-title {
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .point-sub {
    font-size: var(--t-footnote);
    color: var(--label-2);
  }
  .remove {
    position: relative;
    flex: none;
    border: 0;
    background: none;
    color: var(--label-3);
    padding: 0;
    display: grid;
    cursor: pointer;
  }
  .remove::before {
    content: '';
    position: absolute;
    inset: -11px;
  }
  .hint-row,
  .hint {
    font-size: var(--t-subhead);
    color: var(--label-2);
  }
  .actions {
    display: flex;
    gap: 8px;
  }
  .capsule {
    height: 36px;
    padding: 0 14px;
    border: 0;
    border-radius: var(--r-pill);
    background: var(--fill-3);
    color: var(--accent);
    font: 600 var(--t-subhead) var(--font);
    display: inline-flex;
    align-items: center;
    gap: 6px;
    cursor: pointer;
  }
  .capsule.destructive {
    color: var(--red);
  }
  .capsule:disabled {
    opacity: 0.4;
    cursor: default;
  }
</style>
