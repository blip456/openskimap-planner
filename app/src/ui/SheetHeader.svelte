<script lang="ts">
  // Sheet header (spec §2.9): title 20/700 + subtitle, round 36 px action buttons, close.
  import type { Snippet } from 'svelte';
  import Icon from './Icon.svelte';

  let {
    title,
    titleId = 'sheet-title',
    subtitle,
    actions,
    onclose,
  }: { title: string; titleId?: string; subtitle?: Snippet; actions?: Snippet; onclose?: () => void } = $props();
</script>

<div class="sheet-head">
  <div class="titles">
    <h2 id={titleId} tabindex="-1">{title}</h2>
    {#if subtitle}<p class="subtitle">{@render subtitle()}</p>{/if}
  </div>
  {#if actions}{@render actions()}{/if}
  {#if onclose}
  <button type="button" class="round-btn" aria-label="Close" title="Close" onclick={onclose} data-testid="sheet-close">
      <Icon name="x" size={18} strokeWidth={2.4} />
    </button>
  {/if}
</div>

<style>
  .sheet-head {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    padding: 6px 16px 8px 20px;
    min-height: 52px;
    box-sizing: border-box;
  }
  .titles {
    flex: 1;
    min-width: 0;
  }
  h2 {
    margin: 0;
    font-size: var(--t-title3);
    font-weight: var(--fw-bold);
    line-height: 1.25;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    outline: none;
  }
  .subtitle {
    margin: 2px 0 0;
    font-size: var(--t-footnote);
    color: var(--label-2);
  }
</style>
