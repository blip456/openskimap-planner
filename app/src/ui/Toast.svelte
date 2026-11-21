<script lang="ts">
  // Solid toast (spec §2.19); one at a time, optional action ("Undo").
  import type { ToastData } from '../lib/stores/ui.svelte.ts';

  let { toast, ondone }: { toast: ToastData; ondone: () => void } = $props();
</script>

<div class="toast" role="status" data-testid="toast">
  <span>{toast.text}</span>
  {#if toast.action}
    <button
      type="button"
      onclick={() => {
        toast.action?.run();
        ondone();
      }}>{toast.action.label}</button
    >
  {/if}
</div>

<style>
  .toast {
    position: fixed;
    z-index: var(--z-toast);
    top: calc(var(--controls-top) + 56px);
    left: 50%;
    transform: translateX(-50%);
    max-width: min(340px, calc(100% - 32px));
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 10px 16px;
    border-radius: 20px;
    background: var(--toast-bg);
    color: var(--toast-label);
    font-size: 15px;
    font-weight: var(--fw-medium);
    animation: toast-in var(--dur-base) var(--ease-out);
  }
  button {
    border: 0;
    background: none;
    padding: 4px 0;
    color: #0a84ff;
    font: var(--fw-semibold) 15px var(--font);
    cursor: pointer;
  }
  @keyframes toast-in {
    from {
      opacity: 0;
      transform: translate(-50%, -8px);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .toast {
      animation: none;
    }
  }
</style>
