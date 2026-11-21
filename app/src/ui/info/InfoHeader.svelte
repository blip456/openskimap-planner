<script lang="ts">
  // Info card header (spec §2.13): name 22/700 with the piste/lift number, subtitle with a colour dot, close.
  import Icon from '../Icon.svelte';
  import type { InfoCardModel } from '../../lib/explore/info-card.ts';

  let { card, onclose, titleId = 'sheet-title' }: { card: InfoCardModel; onclose: () => void; titleId?: string } = $props();
</script>

<div class="info-head" data-testid="info-head">
  <div class="titles">
    <h2 id={titleId} tabindex="-1" data-testid="info-title">
      {#if card.badge}<span class="badge" style:background={card.badge.color}>{card.badge.text}</span>{/if}{card.title}
    </h2>
    {#if card.subtitle}
      <p class="subtitle">
        {#if card.dot}<i class="dot" style:background={card.dot}></i>{/if}{card.subtitle}
      </p>
    {/if}
  </div>
  <button type="button" class="round-btn" aria-label="Close" title="Close" onclick={onclose} data-testid="info-close">
    <Icon name="x" size={18} strokeWidth={2.4} />
  </button>
</div>

<style>
  .info-head {
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
    font-size: var(--t-title2);
    font-weight: var(--fw-bold);
    line-height: 1.27;
    outline: none;
    overflow-wrap: anywhere;
  }
  .badge {
    display: inline-block;
    min-width: 22px;
    margin-right: 8px;
    padding: 0 6px;
    border-radius: var(--r-sm);
    color: #fff;
    font: var(--fw-bold) var(--t-subhead) / 24px var(--font-rounded);
    text-align: center;
    vertical-align: 3px;
    box-shadow: inset 0 0 0 0.5px var(--swatch-border);
  }
  .subtitle {
    margin: 2px 0 0;
    font-size: var(--t-footnote);
    color: var(--label-2);
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .dot {
    flex: none;
    width: 10px;
    height: 10px;
    border-radius: 50%;
    box-shadow: inset 0 0 0 0.5px var(--swatch-border);
  }
</style>
