<script lang="ts">
  // Locate button (spec §2.6): Show my location → Follow → Follow with heading → off, like Apple Maps. The icon and
  // the label change per state; "Finding your location" pulses (not with reduced motion).
  import Icon from './Icon.svelte';
  import { locateLabel, type LocateMode } from '../lib/location/locate.ts';

  let { mode, ontap, size = 48 }: { mode: LocateMode; ontap: () => void; size?: number } = $props();
  const label = $derived(locateLabel(mode));
  const off = $derived(mode === 'denied' || mode === 'unavailable');
  const accent = $derived(mode === 'searching' || mode === 'centred' || mode === 'follow' || mode === 'heading');
  const iconSize = $derived(size < 40 ? 18 : 22);
</script>

<button
  type="button"
  class="glass locate"
  class:accent
  class:off
  class:searching={mode === 'searching'}
  style:width={`${size}px`}
  style:height={`${size}px`}
  aria-label={label}
  aria-pressed={mode === 'follow' || mode === 'heading'}
  title={label}
  onclick={ontap}
  data-testid="locate-button"
  data-state={mode}
>
  <span class="content">
    {#if mode === 'heading'}
      <!-- custom "location-heading" (spec §7): filled navigation arrow with a short line above, like SF location.north.line.fill -->
      <svg width={iconSize} height={iconSize} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M12 2.5v3" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" fill="none" />
        <path d="M12 8 L18.5 21 L12 17.6 L5.5 21 Z" fill="currentColor" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" />
      </svg>
    {:else if off}
      <Icon name="navigationOff" size={iconSize} />
    {:else}
      <Icon name="navigation" size={iconSize} filled={mode === 'follow'} />
    {/if}
  </span>
</button>

<style>
  .locate {
    position: relative;
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
  .locate:active .content {
    transform: scale(var(--press-scale));
    transition-duration: var(--dur-instant);
  }
  .accent {
    color: var(--glass-accent);
  }
  .off {
    color: var(--label-3);
  }
  .searching .content {
    animation: pulse 1s ease-in-out infinite alternate;
  }
  @keyframes pulse {
    to {
      opacity: 0.4;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .searching .content {
      animation: none;
    }
  }
  @media (hover: hover) {
    .locate:hover {
      background-image: linear-gradient(rgba(255, 255, 255, 0.04), rgba(255, 255, 255, 0.04));
    }
  }
</style>
