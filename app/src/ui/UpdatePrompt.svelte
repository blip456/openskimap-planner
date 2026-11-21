<script lang="ts">
  // "New version available · Reload" (phase 5). Shown when the service worker has a new version waiting. Nothing
  // reloads on its own: the user taps Reload when it suits them (a route in progress is saved anyway).
  import Icon from './Icon.svelte';

  // placement 'inline': part of the page flow (first-run screen), not floating over it
  let { onreload, onlater, placement = 'top' }: { onreload: () => void; onlater: () => void; placement?: 'top' | 'low' | 'inline' } = $props();
</script>

<div class="update" class:low={placement === 'low'} class:inline={placement === 'inline'} role="status" data-testid="update-prompt">
  <span>New version available</span>
  <button type="button" class="reload" onclick={onreload} data-testid="update-reload">Reload</button>
  <button type="button" class="later" aria-label="Later" title="Later" onclick={onlater}><Icon name="x" size={16} strokeWidth={2.4} /></button>
</div>

<style>
  .update {
    position: fixed;
    z-index: var(--z-toast);
    top: calc(var(--controls-top) + 56px);
    left: 50%;
    transform: translateX(-50%);
    max-width: min(340px, calc(100% - 32px));
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 6px 8px 6px 16px;
    border-radius: 22px;
    background: var(--toast-bg);
    color: var(--toast-label);
    font-size: 15px;
    font-weight: var(--fw-medium);
    white-space: nowrap;
    animation: in var(--dur-base) var(--ease-out);
  }
  .update.low {
    top: auto;
    bottom: calc(var(--tabbar-bottom) + var(--tabbar-h) + 12px);
  }
  .update.inline {
    position: static;
    transform: none;
    width: max-content;
    max-width: 100%;
    animation: none;
  }
  button {
    border: 0;
    background: none;
    cursor: pointer;
    min-height: 32px;
    font: var(--fw-semibold) 15px var(--font);
  }
  .reload {
    color: #0a84ff;
    padding: 4px 4px;
  }
  .later {
    color: inherit;
    opacity: 0.6;
    width: 32px;
    display: grid;
    place-items: center;
  }
  @keyframes in {
    from {
      opacity: 0;
      transform: translate(-50%, -8px);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .update {
      animation: none;
    }
  }
</style>
