<script lang="ts">
  // Plan route capsule (spec §2.5): glass when off, tinted with the accent while plan mode is on.
  import Icon from './Icon.svelte';

  let { on, ontoggle, desktop = false, compact = false }: { on: boolean; ontoggle: () => void; desktop?: boolean; compact?: boolean } = $props();
</script>

<button
  type="button"
  class="glass plan"
  class:on
  class:compact
  aria-pressed={on}
  title={desktop ? (on ? 'Stop planning (P or Esc)' : 'Plan a route: click the map to add points (P)') : undefined}
  onclick={ontoggle}
  data-testid="plan-button"
>
  <span class="content">
    <Icon name="pencil" size={compact ? 17 : 20} />
    <span class="label">Plan route</span>
    {#if desktop}<kbd>P</kbd>{/if}
  </span>
</button>

<style>
  .plan {
    height: var(--ctl);
    border: 0;
    border-radius: var(--r-pill);
    padding: 0 18px 0 14px;
    cursor: pointer;
    font: inherit;
  }
  /* desktop toolbar with a mouse: 36 px capsule (spec §3.11) */
  .plan.compact {
    height: 36px;
    padding: 0 14px 0 12px;
  }
  .compact .label {
    font-size: 14px;
  }
  .content {
    display: flex;
    align-items: center;
    gap: 6px;
    transition: transform var(--dur-press) var(--spring-press);
  }
  .plan:active .content {
    transform: scale(var(--press-scale));
    transition-duration: var(--dur-instant);
  }
  .label {
    font-size: 16px;
    font-weight: var(--fw-semibold);
    white-space: nowrap;
  }
  .on {
    background: var(--tint-fill);
    color: var(--on-accent);
  }
  kbd {
    font: 500 12px var(--font);
    color: var(--glass-label-2);
    margin-left: 4px;
  }
  .on kbd {
    color: rgba(255, 255, 255, 0.85);
  }
</style>
