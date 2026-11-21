<script lang="ts">
  // iOS-style alert (spec §2.23): title, message, Cancel + action. Esc = Cancel. Uses <dialog> (focus trapped).
  import { onMount } from 'svelte';

  let {
    title,
    message = '',
    action,
    destructive = false,
    onconfirm,
    oncancel,
  }: { title: string; message?: string; action: string; destructive?: boolean; onconfirm: () => void; oncancel: () => void } = $props();
  let dialog: HTMLDialogElement;

  onMount(() => {
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
  });
</script>

<dialog
  bind:this={dialog}
  class="alert"
  aria-labelledby="alert-title"
  data-testid="confirm-dialog"
  oncancel={(e) => {
    e.preventDefault();
    oncancel();
  }}
>
  <h2 id="alert-title">{title}</h2>
  {#if message}<p>{message}</p>{/if}
  <div class="buttons">
    <button type="button" class="cancel" onclick={oncancel} data-testid="confirm-cancel">Cancel</button>
    <button type="button" class:destructive onclick={onconfirm} data-testid="confirm-ok">{action}</button>
  </div>
</dialog>

<style>
  .alert {
    z-index: var(--z-alert);
    width: 270px;
    padding: 0;
    border: 0;
    border-radius: var(--r-card);
    background: color-mix(in srgb, var(--bg-elevated) 96%, transparent);
    color: var(--label);
    text-align: center;
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.18);
  }
  .alert::backdrop {
    background: var(--scrim);
  }
  h2 {
    margin: 20px 16px 2px;
    font-size: var(--t-headline);
    font-weight: var(--fw-semibold);
  }
  p {
    margin: 0 16px 16px;
    font-size: var(--t-footnote);
  }
  .buttons {
    display: grid;
    grid-template-columns: 1fr 1fr;
    border-top: 0.5px solid var(--separator);
  }
  button {
    height: 44px;
    border: 0;
    background: none;
    color: var(--accent);
    font: var(--t-body) var(--font);
    cursor: pointer;
  }
  button + button {
    border-left: 0.5px solid var(--separator);
  }
  .cancel {
    font-weight: var(--fw-semibold);
  }
  .destructive {
    color: var(--red);
  }
</style>
