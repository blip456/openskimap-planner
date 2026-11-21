<script lang="ts">
  // iPhone search (spec §2.4, §3.7, §4.5): the field sits 10 px above the keyboard (positioned from visualViewport),
  // the results are a strong-glass panel above it. A tap on the map (the backdrop) or ✕ closes it.
  import { onMount } from 'svelte';
  import Icon from '../Icon.svelte';
  import SearchResults from './SearchResults.svelte';
  import type { SearchState } from '../../lib/stores/search.svelte.ts';

  let { search, onclose }: { search: SearchState; onclose: () => void } = $props();
  let input: HTMLInputElement;
  /** px from the bottom of the layout viewport to the top of the keyboard (0 without keyboard) */
  let keyboard = $state(0);

  onMount(() => {
    const vv = window.visualViewport;
    const place = () => {
      if (!vv) return;
      keyboard = Math.max(0, Math.round(innerHeight - (vv.height + vv.offsetTop)));
    };
    place();
    vv?.addEventListener('resize', place);
    vv?.addEventListener('scroll', place);
    input.focus();
    return () => {
      vv?.removeEventListener('resize', place);
      vv?.removeEventListener('scroll', place);
      // iOS 26: the page can stay shifted after the keyboard closes (plan §8.6)
      window.scrollTo(0, 0);
    };
  });

  function onkeydown(e: KeyboardEvent) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      search.move(e.key === 'ArrowDown' ? 1 : -1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      search.enter();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onclose();
    }
  }
</script>

<button type="button" class="backdrop" aria-label="Close search" tabindex="-1" onclick={onclose}></button>
<div class="search-layer" style:--kb={`${keyboard}px`} data-testid="search-overlay">
  {#if search.items.length || search.footnote}
    <div class="panel glass" data-testid="search-panel">
      <SearchResults {search} listId="search-results-phone" />
    </div>
  {/if}
  <div class="field glass">
    <span class="icon"><Icon name="search" size={20} /></span>
    <input
      bind:this={input}
      type="search"
      enterkeyhint="search"
      autocapitalize="off"
      autocomplete="off"
      spellcheck="false"
      placeholder="Runs, lifts, places, coordinates"
      aria-label="Search"
      aria-controls="search-results-phone"
      aria-activedescendant={search.active >= 0 ? `search-results-phone-${search.active}` : undefined}
      value={search.query}
      oninput={(e) => search.setQuery(e.currentTarget.value)}
      onpaste={(e) => setTimeout(() => search.setQuery((e.target as HTMLInputElement).value, true), 0)}
      {onkeydown}
      data-testid="search-input"
    />
    <button type="button" class="round-btn" aria-label="Close search" title="Close search" onclick={onclose} data-testid="search-close">
      <Icon name="x" size={18} strokeWidth={2.4} />
    </button>
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: calc(var(--z-search) - 1);
    border: 0;
    padding: 0;
    background: transparent;
  }
  .search-layer {
    position: fixed;
    z-index: var(--z-search);
    left: calc(12px + var(--safe-left));
    right: calc(12px + var(--safe-right));
    /* above the keyboard; without keyboard where the tab bar is */
    bottom: max(calc(var(--kb) + 10px), var(--tabbar-bottom));
    display: flex;
    flex-direction: column;
    gap: 8px;
    max-width: 560px;
    margin: 0 auto;
    animation: rise var(--dur-sheet) var(--spring-sheet);
  }
  .panel {
    background: var(--glass-fill-strong);
    border-radius: var(--r-card);
    overflow-y: auto;
    overscroll-behavior: contain;
    /* the space between the field and the top row of map buttons */
    max-height: calc(100vh - var(--kb) - var(--controls-top) - 48px - 8px - 52px - 28px);
    padding: 4px 0;
  }
  .field {
    display: flex;
    align-items: center;
    gap: 8px;
    height: 52px;
    padding: 0 8px 0 16px;
    border-radius: 26px;
    box-sizing: border-box;
  }
  .icon {
    display: grid;
    color: var(--label-2);
  }
  input {
    flex: 1;
    min-width: 0;
    border: 0;
    background: none;
    color: inherit;
    font: 17px var(--font);
    outline: none;
    -webkit-appearance: none;
    appearance: none;
  }
  input::-webkit-search-cancel-button {
    display: none;
  }
  input::placeholder {
    color: var(--label-3);
  }
  @keyframes rise {
    from {
      opacity: 0;
      transform: translateY(16px) scale(0.96);
    }
  }
</style>
