<script lang="ts">
  // Big stats Time · Distance · Descent + one scrolling line of chips (spec §2.15, old planner renderResult).
  import type { RouteResponse } from '../../lib/worker/engine.ts';
  import { formatDistance, formatDuration, splitUnit } from '../../lib/format.ts';
  import { routeGradient } from '../../lib/route/profile.ts';

  let { result, desktop = false }: { result: RouteResponse; desktop?: boolean } = $props();

  const s = $derived(result.summary);
  const stats = $derived([
    { label: 'Time', ...splitUnit(`~${formatDuration(s.duration)}`) },
    { label: 'Distance', ...splitUnit(formatDistance(s.distance)) },
    { label: 'Descent', value: String(Math.round(s.descent)), unit: 'm' },
  ]);
  const gradient = $derived(routeGradient(result));
  const chips = $derived.by(() => {
    const out: { text: string; title?: string }[] = [
      { text: `${formatDistance(s.runDistance)} skiing` },
      { text: `${s.liftCount} ${s.liftCount === 1 ? 'lift' : 'lifts'}` },
      { text: `↑ ${Math.round(s.ascent)} m` },
    ];
    if (gradient) {
      out.push({ text: `avg ${Math.round(gradient.avg * 100)}%`, title: 'Average gradient of the downhill runs (descent ÷ horizontal distance)' });
      if (gradient.max != null) out.push({ text: `max ${Math.round(gradient.max * 100)}%`, title: 'Steepest 30 m section of the downhill runs' });
    }
    return out;
  });
  // screen readers: "Route: 42 minutes, 8.4 kilometres" (spec §4.8)
  const spoken = $derived(`Route: ${formatDuration(s.duration).replace('min', 'minutes').replace(' h ', ' hours ')}, ${formatDistance(s.distance).replace('km', 'kilometres').replace(/ m$/, ' metres')}`);
</script>

<div class="grp summary" data-testid="route-summary">
  <span class="sr-only" aria-live="polite">{spoken}</span>
  <div class="stats">
    {#each stats as st (st.label)}
      <div class="stat">
        <div class="stat-label">{st.label}</div>
        <div class="stat-value">{st.value}<span class="unit">{st.unit}</span></div>
      </div>
    {/each}
  </div>
  <div class="chips">
    {#each chips as c (c.text)}<span class="chip" title={desktop ? c.title : undefined} data-testid="route-chip">{c.text}</span>{/each}
  </div>
</div>

<style>
  .stats {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    padding: 12px 0 10px;
  }
  .stat {
    padding: 0 8px 0 16px;
    min-width: 0;
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
    font: var(--fw-semibold) var(--t-title2) var(--font-rounded);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .unit {
    margin-left: 2px;
    font-size: var(--t-subhead);
    color: var(--label-2);
  }
  .chips {
    display: flex;
    gap: 6px;
    overflow-x: auto;
    padding: 0 16px 12px;
    scrollbar-width: none;
    touch-action: pan-x;
  }
  .chips::-webkit-scrollbar {
    display: none;
  }
  .chip {
    flex: none;
    height: 26px;
    line-height: 26px;
    padding: 0 10px;
    border-radius: 13px;
    background: var(--fill-3);
    font: var(--fw-semibold) var(--t-footnote) var(--font-rounded);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
  }
</style>
