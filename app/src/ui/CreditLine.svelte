<script lang="ts">
  // Short credit line on the map (spec §2.27); full credits go to Menu › About (phase 4).
</script>

<div class="credit">© OpenStreetMap · OpenSkiData</div>

<style>
  /* spec §2.27: 5 px above the tab bar, no box, white halo */
  .credit {
    position: fixed;
    z-index: var(--z-credit);
    left: 0;
    right: 0;
    bottom: calc(var(--tabbar-bottom) + var(--tabbar-h) + 5px);
    text-align: center;
    font-size: 10px;
    color: rgba(0, 0, 0, 0.62);
    text-shadow:
      0 0 2px #fff,
      0 0 2px #fff,
      0 0 2px #fff;
    pointer-events: none;
  }
</style>
