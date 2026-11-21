<script lang="ts">
  // Route points A, B, C… with remove buttons, then Start from my location, Reverse and Clear (spec §2.14).
  import Icon from '../Icon.svelte';
  import { pointLetter, pointRole, ROLE_LABEL, type RouteState } from '../../lib/stores/route.svelte.ts';
  import type { UiState } from '../../lib/stores/ui.svelte.ts';

  let {
    route,
    ui,
    desktop = false,
    locating = false,
    onstart,
  }: { route: RouteState; ui: UiState; desktop?: boolean; locating?: boolean; onstart?: () => void } = $props();

  const n = $derived(route.points.length);
  let flashing = $state<number | null>(null);
  let rows: HTMLElement[] = $state([]);

  // iPhone: a tap on a marker flashes its row (spec §2.24)
  $effect(() => {
    const f = ui.flashPoint;
    if (!f) return;
    flashing = f.index;
    rows[f.index]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    const t = setTimeout(() => (flashing = null), 600);
    return () => clearTimeout(t);
  });

  const title = (p: [number, number]) => route.nameOf(p) || `${p[1].toFixed(5)}, ${p[0].toFixed(5)}`;
</script>

<div class="grp" data-testid="route-points">
  {#each route.points as p, i (i)}
    {@const role = pointRole(i, n)}
    <div class="row point" class:flash={flashing === i} bind:this={rows[i]} data-testid={`point-row-${pointLetter(i)}`}>
      <span class={`badge ${role}`}>{pointLetter(i)}</span>
      <div class="txt">
        <div class="t" class:coords={!route.nameOf(p)}>{title(p)}</div>
        <div class="s">{ROLE_LABEL[role]}</div>
      </div>
      <button type="button" class="remove" aria-label={`Remove point ${pointLetter(i)}`} title="Remove" onclick={() => route.removePoint(i)}>
        <Icon name="circleX" size={22} />
      </button>
    </div>
  {/each}
  {#if n === 1}
    <div class="row hint">Now {desktop ? 'click' : 'tap'} the map to set the destination.</div>
  {/if}
</div>
<div class="btn-row" class:three={!!onstart}>
  {#if onstart}
    <!-- the snapped position becomes the new start A (phase 6) -->
    <button type="button" class="cap-btn" disabled={locating} onclick={onstart} aria-label="Start from my location" title="Start from my location" data-testid="start-from-location">
      <Icon name={locating ? 'loader' : 'locateFixed'} size={17} /> My location
    </button>
  {/if}
  <button type="button" class="cap-btn" disabled={n < 2} onclick={() => route.reverse()} title="Swap start and destination" data-testid="reverse">
    <Icon name="arrowUpDown" size={17} /> Reverse
  </button>
  <button type="button" class="cap-btn destructive" disabled={n === 0} onclick={() => route.clear()} title="Remove all points" data-testid="clear">
    <Icon name="trash" size={17} /> Clear
  </button>
</div>

<style>
  /* three buttons fit in one line on a 390 px phone */
  .btn-row.three {
    gap: 6px;
  }
  .btn-row.three .cap-btn {
    padding: 0 11px;
    gap: 5px;
  }
  .point {
    --sep-inset: 56px;
    transition: background var(--dur-fast);
  }
  .point.flash {
    background: var(--fill-3);
    transition: none;
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
  .t {
    white-space: nowrap;
  }
  .coords {
    font-variant-numeric: tabular-nums;
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
  @media (hover: hover) {
    .remove:hover {
      color: var(--label-2);
    }
  }
  .hint {
    font-size: var(--t-subhead);
    color: var(--label-2);
  }
</style>
