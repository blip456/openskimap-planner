<script lang="ts">
  // 3D capsule (spec §2.2): icon + "3D", accent when on; one glass surface.
  import Icon from './Icon.svelte';
  let { on, ontoggle, compact = false }: { on: boolean; ontoggle: () => void; compact?: boolean } = $props();
</script>

<button
  type="button"
  class="glass capsule"
  class:on
  class:compact
  aria-label="3D terrain"
  aria-pressed={on}
  title={on ? 'Show the map flat (2D)' : 'Show the mountains in 3D'}
  onclick={ontoggle}
  data-testid="terrain-button"
>
  <span class="content"><Icon name="box" size={compact ? 18 : 22} /><span class="label">3D</span></span>
</button>

<style>
  .capsule {
    height: var(--ctl);
    padding: 0 14px 0 12px;
    border: 0;
    border-radius: var(--r-pill);
    cursor: pointer;
    font: inherit;
    display: flex;
    align-items: center;
  }
  .capsule.compact {
    height: 36px;
    padding: 0 12px 0 10px;
  }
  .content {
    display: flex;
    align-items: center;
    gap: 6px;
    transition: transform var(--dur-press) var(--spring-press);
  }
  .capsule:active .content {
    transform: scale(var(--press-scale));
    transition-duration: var(--dur-instant);
  }
  .label {
    font-size: 15px;
    font-weight: var(--fw-bold);
  }
  .compact .label {
    font-size: 13px;
  }
  .on {
    color: var(--glass-accent);
  }
  @media (hover: hover) {
    .capsule:hover {
      background-image: linear-gradient(rgba(255, 255, 255, 0.04), rgba(255, 255, 255, 0.04));
    }
  }
</style>
