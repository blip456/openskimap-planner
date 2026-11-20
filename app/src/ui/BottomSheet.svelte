<script lang="ts">
  // Bottom sheet (spec §2.9). Phase 3: the medium detent only; drag and the large detent come in phase 4/7.
  import type { Snippet } from 'svelte';
  import Icon from './Icon.svelte';

  let { title, subtitle, onclose, children }: { title: string; subtitle?: string; onclose: () => void; children: Snippet } = $props();
</script>

<div id="sheet" class="glass sheet" role="dialog" aria-modal="false" aria-labelledby="sheet-title" data-testid="sheet">
  <div class="handle" aria-hidden="true"></div>
  <header>
    <div class="titles">
      <h2 id="sheet-title">{title}</h2>
      {#if subtitle}<p class="subtitle">{subtitle}</p>{/if}
    </div>
    <button type="button" class="round" aria-label="Close" onclick={onclose}><Icon name="x" size={18} strokeWidth={2.4} /></button>
  </header>
  <div class="body">
    {@render children()}
  </div>
</div>

<style>
  .sheet {
    position: fixed;
    z-index: var(--z-sheet);
    left: calc(8px + var(--safe-left));
    right: calc(8px + var(--safe-right));
    top: var(--sheet-medium-top);
    bottom: calc(var(--tabbar-bottom) + var(--tabbar-h) + 8px);
    margin: 0 auto;
    max-width: 560px;
    border-radius: var(--r-sheet) var(--r-sheet) 32px 32px;
    background: var(--glass-fill-strong);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    animation: sheet-in var(--dur-sheet) var(--spring-sheet);
  }
  .handle {
    width: var(--sheet-handle-w);
    height: var(--sheet-handle-h);
    border-radius: 3px;
    background: var(--label-3);
    margin: 6px auto 0;
    flex: none;
  }
  header {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    padding: 8px 16px 8px 20px;
    min-height: 52px;
    flex: none;
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
  }
  .subtitle {
    margin: 2px 0 0;
    font-size: var(--t-footnote);
    color: var(--label-2);
  }
  .round {
    position: relative;
    flex: none;
    width: var(--ctl-sm);
    height: var(--ctl-sm);
    border: 0;
    border-radius: var(--r-pill);
    background: var(--fill-3);
    color: var(--label-2);
    display: grid;
    place-items: center;
    cursor: pointer;
  }
  .round::before {
    content: '';
    position: absolute;
    inset: -4px;
  }
  .body {
    flex: 1;
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: 4px 16px 16px;
    touch-action: pan-y;
  }
  @keyframes sheet-in {
    from {
      transform: translateY(100%);
      opacity: 0;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .sheet {
      animation-name: sheet-fade;
    }
    @keyframes sheet-fade {
      from {
        opacity: 0;
      }
    }
  }
</style>
