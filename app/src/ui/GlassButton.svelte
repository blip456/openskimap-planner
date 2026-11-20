<script lang="ts">
  // Round glass map button (spec §2.1): 48 × 48, icon 22.
  import Icon from './Icon.svelte';
  import type { IconName } from './icons.ts';

  let {
    icon,
    label,
    active = false,
    onclick,
    testid,
  }: { icon: IconName; label: string; active?: boolean; onclick?: () => void; testid?: string } = $props();
</script>

<button type="button" class="glass glass-button" class:active aria-label={label} title={label} {onclick} data-testid={testid}>
  <span class="content"><Icon name={icon} /></span>
</button>

<style>
  .glass-button {
    position: relative;
    width: var(--ctl);
    height: var(--ctl);
    border: 0;
    border-radius: var(--r-pill);
    padding: 0;
    display: grid;
    place-items: center;
    cursor: pointer;
    font: inherit;
  }
  .content {
    display: grid;
    place-items: center;
    transition: transform var(--dur-press) var(--spring-press);
  }
  .glass-button:active .content {
    transform: scale(var(--press-scale));
    transition-duration: var(--dur-instant);
  }
  .active {
    color: var(--accent);
  }
  @media (hover: hover) {
    .glass-button:hover {
      background-image: linear-gradient(rgba(255, 255, 255, 0.04), rgba(255, 255, 255, 0.04));
    }
  }
</style>
