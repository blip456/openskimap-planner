<script lang="ts">
  // "Tap the map to add points" pill, only while plan mode is on (spec §2.5).
  import Icon from './Icon.svelte';

  let { points, desktop = false, onstop }: { points: number; desktop?: boolean; onstop: () => void } = $props();
  const short = $derived(`${desktop ? 'Click' : 'Tap'} the map to add points`);
  // the longer hint only fits on wide phones (≥ 430 px); narrower screens keep the short text (spec §2.5)
  const long = $derived(points >= 2 && !desktop ? 'Tap to add a stop · drag a point to move it' : null);
</script>

<div class="glass pill" role="status" data-testid="mode-pill">
  <span class="icon"><Icon name="pencil" size={17} /></span>
  <span class="text">
    {#if long}<span class="long">{long}</span><span class="short">{short}</span>{:else}{short}{/if}{#if desktop}<span class="kbd"> · P</span>{/if}
  </span>
  <button type="button" class="stop" aria-label="Stop planning" onclick={onstop}><Icon name="x" size={17} /></button>
</div>

<style>
  .pill {
    display: flex;
    align-items: center;
    gap: 8px;
    height: 40px;
    padding: 0 4px 0 14px;
    border-radius: var(--r-pill);
    max-width: 100%;
    animation: pill-in var(--dur-base) var(--ease-out);
  }
  .icon {
    color: var(--glass-accent);
    display: grid;
  }
  .text {
    font-size: 15px;
    font-weight: var(--fw-semibold);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    min-width: 0;
  }
  .kbd {
    color: var(--glass-label-2);
  }
  .long {
    display: none;
  }
  @media (min-width: 430px) {
    .long {
      display: inline;
    }
    .long + .short {
      display: none;
    }
  }
  .stop {
    position: relative;
    flex: none;
    width: 32px;
    height: 32px;
    border-radius: var(--r-pill);
    border: 0;
    background: var(--fill-3);
    color: inherit;
    display: grid;
    place-items: center;
    cursor: pointer;
  }
  .stop::before {
    content: '';
    position: absolute;
    inset: -6px;
  }
  @keyframes pill-in {
    from {
      opacity: 0;
      transform: translateY(-6px);
    }
  }
</style>
