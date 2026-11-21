<script lang="ts">
  // Short credit line on the map (spec §2.27): clear of the tab bar; tap → Menu › About & credits.
  // Desktop: bottom-right of the map with a "Credits" link.
  let { wide = false, onopen }: { wide?: boolean; onopen: () => void } = $props();
</script>

<div class="credit" class:wide data-testid="credit-line">
  <button type="button" onclick={onopen} title="Data sources and licences">© OpenStreetMap · OpenSkiData{#if wide}{' · '}<u>Credits</u>{/if}</button>
</div>

<style>
  /* spec §2.27: 5 px above the tab bar, no box, white halo */
  .credit {
    position: fixed;
    z-index: var(--z-credit);
    left: 0;
    right: 0;
    bottom: calc(var(--tabbar-bottom) + var(--tabbar-h) + 5px);
    text-align: center;
    pointer-events: none;
  }
  .credit.wide {
    left: auto;
    right: 12px;
    bottom: 6px;
  }
  button {
    pointer-events: auto;
    border: 0;
    background: none;
    padding: 2px 4px;
    font: 10px var(--font);
    color: rgba(0, 0, 0, 0.62);
    text-shadow:
      0 0 2px #fff,
      0 0 2px #fff,
      0 0 2px #fff;
    cursor: pointer;
  }
  .wide button {
    font-size: 11px;
  }
</style>
