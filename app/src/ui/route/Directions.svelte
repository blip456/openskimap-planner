<script lang="ts">
  // Directions per leg (spec §2.18; old planner renderResult): one collapsible group per leg (A → B, B → C …),
  // collapsed legs are remembered. Hover (mouse) or tap a leg/step to highlight it on the map; the zoom button
  // shows the leg on the map, a tap on a step zooms to the step.
  import Icon from '../Icon.svelte';
  import type { RouteResponse } from '../../lib/worker/engine.ts';
  import { pointLetter, pointRole, type RouteState } from '../../lib/stores/route.svelte.ts';
  import type { UiState } from '../../lib/stores/ui.svelte.ts';
  import { legMeta, stepIcon, stepMeta, stepTitle } from '../../lib/route/steps.ts';
  import { stepColor } from '../../lib/map/route-layers.ts';
  import type { RouteStep } from '@core/routing/index.ts';

  let { result, route, ui, desktop = false }: { result: RouteResponse; route: RouteState; ui: UiState; desktop?: boolean } = $props();

  const n = $derived(result.legs.length + 1);
  const legs = $derived(
    result.legs.map((leg) => {
      const steps = result.steps.map((s, i) => ({ s, i })).filter(({ s }) => s.leg === leg.index);
      return { leg, steps, key: `${leg.from}-${leg.to}` };
    }),
  );

  type Coords = RouteStep['coordinates'];
  type Steps = { s: { coordinates: Coords } }[];
  const lines = (steps: Steps) => steps.map(({ s }) => s.coordinates);
  const hover = (steps: Steps | null) => {
    if (desktop) ui.setHighlight(steps ? lines(steps) : null);
  };

  function tapStep(coords: Coords) {
    ui.setHighlight([coords], 2000);
    ui.fitTo(coords);
    if (ui.detent === 'large') ui.detent = 'medium';
  }

  function toggleLeg(key: string, steps: Steps) {
    route.toggleLeg(key);
    if (!desktop) ui.setHighlight(lines(steps), 2000);
  }
</script>

<h3 class="grp-h big">Directions</h3>
{#each legs as { leg, steps, key } (key)}
  {@const collapsed = route.isLegCollapsed(key)}
  <div class="grp leg" data-testid={`leg-${key}`} data-collapsed={collapsed}>
    <div class="leg-head" role="presentation" onmouseenter={() => hover(steps)} onmouseleave={() => hover(null)}>
      <button
        type="button"
        class="leg-toggle"
        aria-expanded={!collapsed}
        aria-controls={`leg-steps-${key}`}
        onclick={() => toggleLeg(key, steps)}
        data-testid={`leg-toggle-${key}`}
      >
        <span class={`badge ${pointRole(leg.index, n)}`}>{pointLetter(leg.index)}</span>
        <span class="arrow" aria-hidden="true">→</span>
        <span class={`badge ${pointRole(leg.index + 1, n)}`}>{pointLetter(leg.index + 1)}</span>
        <span class="meta">{legMeta(leg.summary)}</span>
        <span class="chev" class:collapsed><Icon name="chevronDown" size={16} strokeWidth={2.4} /></span>
      </button>
      <button
        type="button"
        class="zoom"
        aria-label={`Show ${pointLetter(leg.index)} to ${pointLetter(leg.index + 1)} on the map`}
        title="Show this part on the map"
        onclick={() => tapStep(steps.flatMap(({ s }) => s.coordinates))}
        disabled={!steps.length}
      >
        <Icon name="maximize2" size={16} strokeWidth={2.2} />
      </button>
    </div>
    {#if !collapsed}
      <div id={`leg-steps-${key}`}>
        {#if steps.length}
          {#each steps as { s }, j (j)}
            {@const icon = stepIcon(s)}
            <button
              type="button"
              class="row step"
              onmouseenter={() => desktop && ui.setHighlight([s.coordinates])}
              onmouseleave={() => desktop && ui.setHighlight(null)}
              onclick={() => tapStep(s.coordinates)}
            >
              <span class="step-icon" style:background={stepColor(s)}>
                {#if icon === 'number'}{j + 1}{:else if icon === 'lift-up'}<Icon name="arrowUp" size={15} strokeWidth={2.6} />{:else if icon === 'lift-down'}<Icon
                    name="arrowDown"
                    size={15}
                    strokeWidth={2.6}
                  />{:else}<Icon name="footprints" size={15} strokeWidth={2.2} />{/if}
              </span>
              <span class="txt">
                <span class="t step-title">{stepTitle(s)}</span>
                <span class="s">{stepMeta(s)}</span>
              </span>
            </button>
          {/each}
        {:else}
          <div class="row empty">Both points are at the same spot.</div>
        {/if}
      </div>
    {/if}
  </div>
{/each}

<style>
  .grp-h.big {
    margin: 16px 4px 8px;
  }
  .leg-head {
    display: flex;
    align-items: center;
    min-height: 52px;
    padding-right: 8px;
  }
  .leg-toggle {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 6px;
    min-height: 52px;
    padding: 0 8px 0 16px;
    border: 0;
    background: none;
    color: inherit;
    font: inherit;
    cursor: pointer;
    text-align: left;
  }
  .badge {
    flex: none;
    width: 20px;
    height: 20px;
    border-radius: 50%;
    display: grid;
    place-items: center;
    color: #fff;
    font: 700 11px var(--font-rounded);
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
  .arrow {
    color: var(--label-3);
    font-weight: var(--fw-semibold);
  }
  .meta {
    flex: 1;
    min-width: 0;
    text-align: right;
    font-size: var(--t-subhead);
    color: var(--label-2);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .chev {
    display: grid;
    color: var(--label-3);
    transition: transform var(--dur-base) var(--ease-out);
  }
  .chev.collapsed {
    transform: rotate(-90deg);
  }
  .zoom {
    position: relative;
    flex: none;
    width: 32px;
    height: 32px;
    border: 0;
    border-radius: var(--r-pill);
    background: var(--fill-3);
    color: var(--accent);
    display: grid;
    place-items: center;
    cursor: pointer;
  }
  .zoom::before {
    content: '';
    position: absolute;
    inset: -6px;
  }
  .zoom:disabled {
    opacity: 0.4;
  }
  .step {
    --sep-inset: 52px;
    align-items: flex-start;
  }
  .step::before {
    content: '';
    position: absolute;
    top: 0;
    right: 0;
    left: 52px;
    height: 0.5px;
    background: var(--separator);
  }
  .step-icon {
    flex: none;
    width: 24px;
    height: 24px;
    margin-top: 1px;
    border-radius: var(--r-icon);
    display: grid;
    place-items: center;
    color: #fff;
    font: 700 12px var(--font-rounded);
    box-shadow: inset 0 0 0 0.5px var(--swatch-border);
  }
  .step .txt {
    display: flex;
    flex-direction: column;
  }
  .step-title {
    font-size: var(--t-callout);
    white-space: normal;
  }
  .empty {
    font-size: var(--t-subhead);
    color: var(--label-2);
  }
  @media (prefers-reduced-motion: reduce) {
    .chev {
      transition: none;
    }
  }
</style>
