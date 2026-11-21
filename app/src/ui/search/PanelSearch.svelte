<script lang="ts">
  // Desktop search field in the panel header (spec §3.11): ⌘K / Ctrl K focuses it, results drop down under it,
  // ↑/↓ move the highlight, Enter picks, Esc closes the results.
  import Icon from '../Icon.svelte';
  import SearchResults from './SearchResults.svelte';
  import type { SearchState } from '../../lib/stores/search.svelte.ts';

  let { search, focus = 0 }: { search: SearchState; focus?: number } = $props();
  let input: HTMLInputElement;
  let open = $state(false);
  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

  // ⌘K: the app bumps `focus`
  $effect(() => {
    if (!focus) return;
    input.focus();
    input.select();
    open = true;
  });

  function onkeydown(e: KeyboardEvent) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      open = true;
      search.move(e.key === 'ArrowDown' ? 1 : -1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      open = true;
      search.enter();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      if (open && search.items.length) open = false;
      else input.blur();
    }
  }
</script>

<div class="psearch">
  <div class="field">
    <span class="icon"><Icon name="search" size={16} /></span>
    <input
      bind:this={input}
      type="search"
      autocomplete="off"
      spellcheck="false"
      placeholder="Search runs, lifts, places…"
      title="Search a run, lift, hut or village, or paste coordinates / a Google Maps link"
      role="combobox"
      aria-autocomplete="list"
      aria-label="Search"
      aria-keyshortcuts="Meta+K Control+K"
      aria-controls="search-results-panel"
      aria-expanded={open && search.items.length > 0}
      aria-activedescendant={open && search.active >= 0 ? `search-results-panel-${search.active}` : undefined}
      value={search.query}
      oninput={(e) => {
        open = true;
        search.setQuery(e.currentTarget.value);
      }}
      onpaste={(e) => setTimeout(() => search.setQuery((e.target as HTMLInputElement).value, true), 0)}
      onfocus={() => (open = true)}
      onblur={() => setTimeout(() => (open = false), 150)}
      {onkeydown}
      data-testid="search-input"
    />
    {#if search.query}
      <button
        type="button"
        class="clear"
        aria-label="Clear search"
        onmousedown={(e) => e.preventDefault()}
        onclick={() => {
          search.clear();
          input.focus();
        }}><Icon name="circleX" size={16} /></button
      >
    {:else}
      <kbd aria-hidden="true">{isMac ? '⌘K' : 'Ctrl K'}</kbd>
    {/if}
  </div>
  {#if open && (search.items.length || search.footnote)}
    <div class="drop" data-testid="search-panel">
      <SearchResults {search} listId="search-results-panel" />
    </div>
  {/if}
</div>

<style>
  .psearch {
    position: relative;
    flex: 1;
    min-width: 0;
  }
  .field {
    display: flex;
    align-items: center;
    gap: 6px;
    height: 36px;
    padding: 0 8px 0 10px;
    border-radius: 10px;
    background: var(--fill-3);
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
    color: var(--label);
    font: var(--t-body) var(--font);
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
  .field:focus-within {
    outline: 3px solid var(--focus-ring);
    outline-offset: 0;
  }
  kbd {
    font: var(--fw-medium) 12px var(--font);
    color: var(--label-2);
    padding: 1px 5px;
    border-radius: var(--r-xs);
    border: 0.5px solid var(--separator);
  }
  /* no keyboard shortcut hint on touch screens (landscape phone) */
  @media (pointer: coarse) {
    kbd {
      display: none;
    }
  }
  .clear {
    border: 0;
    background: none;
    padding: 0;
    color: var(--label-3);
    display: grid;
    cursor: pointer;
  }
  .drop {
    position: absolute;
    z-index: 5;
    left: 0;
    right: 0;
    top: 42px;
    max-height: min(60vh, 480px);
    overflow-y: auto;
    border-radius: var(--r-md);
    background: var(--bg-elevated);
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.18);
    border: 0.5px solid var(--separator);
    padding: 4px 0;
    color: var(--label);
  }
</style>
