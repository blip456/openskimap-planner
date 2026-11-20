<script lang="ts">
  // Solid toast (spec §2.19); one at a time.
  let { text }: { text: string } = $props();
</script>

<div class="toast" role="status">{text}</div>

<style>
  .toast {
    position: fixed;
    z-index: var(--z-toast);
    top: calc(var(--controls-top) + 56px);
    left: 50%;
    transform: translateX(-50%);
    max-width: min(340px, calc(100% - 32px));
    padding: 10px 16px;
    border-radius: 20px;
    background: var(--toast-bg);
    color: var(--toast-label);
    font-size: 15px;
    font-weight: var(--fw-medium);
    animation: toast-in var(--dur-base) var(--ease-out);
  }
  @keyframes toast-in {
    from {
      opacity: 0;
      transform: translate(-50%, -8px);
    }
  }
</style>
