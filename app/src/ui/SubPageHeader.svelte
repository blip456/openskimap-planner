<script lang="ts">
  // Header of a pushed sub-page (spec §2.22): back button (chevron + previous title), centred title, close.
  import Icon from './Icon.svelte';

  let {
    title,
    back,
    titleId = 'sheet-title',
    onback,
    onclose,
  }: { title: string; back: string; titleId?: string; onback: () => void; onclose: () => void } = $props();
</script>

<div class="sub-head">
  <button type="button" class="back" onclick={onback} data-testid="sheet-back">
    <Icon name="chevronLeft" size={24} strokeWidth={2.4} /><span>{back}</span>
  </button>
  <h2 id={titleId} tabindex="-1">{title}</h2>
  <button type="button" class="round-btn" aria-label="Close" title="Close" onclick={onclose} data-testid="sheet-close">
    <Icon name="x" size={18} strokeWidth={2.4} />
  </button>
</div>

<style>
  .sub-head {
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    align-items: center;
    gap: 8px;
    padding: 4px 16px 8px 8px;
    min-height: 52px;
    box-sizing: border-box;
  }
  .back {
    justify-self: start;
    display: inline-flex;
    align-items: center;
    gap: 0;
    min-height: 44px;
    border: 0;
    background: none;
    color: var(--accent);
    font: 17px var(--font);
    cursor: pointer;
    padding: 0 4px 0 0;
    max-width: 100%;
    white-space: nowrap;
    overflow: hidden;
  }
  h2 {
    margin: 0;
    font-size: var(--t-headline);
    font-weight: var(--fw-semibold);
    text-align: center;
    white-space: nowrap;
    outline: none;
  }
  .round-btn {
    justify-self: end;
  }
</style>
