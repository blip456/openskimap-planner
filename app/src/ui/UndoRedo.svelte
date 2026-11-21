<script lang="ts">
  // Undo / redo capsule (spec §2.8): one glass surface; hidden when there is nothing to undo or redo; the redo
  // segment only shows when redo is possible.
  import Icon from './Icon.svelte';

  let {
    canUndo,
    canRedo,
    onundo,
    onredo,
    desktop = false,
  }: { canUndo: boolean; canRedo: boolean; onundo: () => void; onredo: () => void; desktop?: boolean } = $props();
  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
  const mod = isMac ? '⌘' : 'Ctrl+';
</script>

{#if canUndo || canRedo}
  <div class="glass capsule" role="group" aria-label="Undo and redo" data-testid="undo-redo">
    <button
      type="button"
      class="seg"
      aria-label="Undo"
      title={desktop ? `Undo (${mod}Z)` : 'Undo'}
      disabled={!canUndo}
      aria-disabled={!canUndo}
      onclick={onundo}
      data-testid="undo"
    >
      <span class="content"><Icon name="undo2" /></span>
    </button>
    {#if canRedo}
      <span class="divider" aria-hidden="true"></span>
      <button type="button" class="seg redo" aria-label="Redo" title={desktop ? `Redo (${mod}${isMac ? '⇧Z' : 'Y'})` : 'Redo'} onclick={onredo} data-testid="redo">
        <span class="content"><Icon name="redo2" /></span>
      </button>
    {/if}
  </div>
{/if}

<style>
  .capsule {
    display: flex;
    align-items: center;
    height: var(--ctl);
    padding: 0 2px;
    border-radius: var(--r-pill);
    animation: cap-in var(--dur-fast) var(--ease-out);
  }
  .seg {
    position: relative;
    width: 44px;
    height: 44px;
    border: 0;
    border-radius: 22px;
    background: none;
    color: inherit;
    display: grid;
    place-items: center;
    cursor: pointer;
    padding: 0;
  }
  .seg:disabled {
    opacity: 0.35;
    cursor: default;
  }
  .content {
    display: grid;
    transition: transform var(--dur-press) var(--spring-press);
  }
  .seg:not(:disabled):active {
    background: var(--glass-pill-pressed);
  }
  .seg:not(:disabled):active .content {
    transform: scale(var(--press-scale));
    transition-duration: var(--dur-instant);
  }
  @media (hover: hover) {
    .seg:not(:disabled):hover {
      background: rgba(255, 255, 255, 0.08);
    }
  }
  .divider {
    width: 0.5px;
    height: 24px;
    background: var(--label-3);
  }
  .redo {
    animation: cap-in var(--dur-fast) var(--ease-out);
  }
  @keyframes cap-in {
    from {
      opacity: 0;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .capsule,
    .redo {
      animation: none;
    }
  }
</style>
