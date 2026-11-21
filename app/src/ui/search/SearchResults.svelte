<script lang="ts">
  // Search result rows (spec §2.4): 29 px icon tile, title, subtitle; ↑/↓ highlight, Enter picks (desktop).
  import Icon from '../Icon.svelte';
  import type { SearchState } from '../../lib/stores/search.svelte.ts';

  let { search, listId = 'search-results' }: { search: SearchState; listId?: string } = $props();
  let list = $state<HTMLUListElement>();

  // keep the highlighted row visible
  $effect(() => {
    const i = search.active;
    list?.children[i]?.scrollIntoView({ block: 'nearest' });
  });
</script>

{#if search.items.length}
  <ul class="results" role="listbox" id={listId} aria-label="Search results" bind:this={list} data-testid="search-results">
    {#each search.items as it, i (it.key)}
      <li
        role="option"
        id={`${listId}-${i}`}
        aria-selected={i === search.active}
        aria-disabled={it.disabled || undefined}
        class:active={i === search.active}
        class:disabled={it.disabled}
        class:error={it.error}
        class:online={!!it.online}
        data-testid="search-result"
        onmousedown={(e) => e.preventDefault()}
        onclick={() => void search.activate(it)}
        onkeydown={(e) => e.key === 'Enter' && void search.activate(it)}
      >
        <span class="tile" class:spin={it.icon === 'loader'} style:background={it.color}><Icon name={it.icon} size={18} /></span>
        <span class="txt">
          <span class="t">{it.title}</span>
          {#if it.sub}<span class="s">{it.sub}</span>{/if}
        </span>
      </li>
    {/each}
  </ul>
{/if}
{#if search.footnote}<p class="foot" data-testid="search-footnote">{search.footnote}</p>{/if}

<style>
  .results {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  li {
    position: relative;
    display: flex;
    align-items: center;
    gap: 12px;
    min-height: 56px;
    padding: 6px 16px;
    box-sizing: border-box;
    cursor: pointer;
  }
  li + li::before {
    content: '';
    position: absolute;
    top: 0;
    left: 57px;
    right: 0;
    height: 0.5px;
    background: var(--separator);
  }
  li.active {
    background: var(--fill-3);
  }
  li.disabled {
    cursor: default;
  }
  @media (hover: hover) {
    li:not(.disabled):hover {
      background: var(--fill-4);
    }
    li.active:hover {
      background: var(--fill-3);
    }
  }
  .tile {
    flex: none;
    width: 29px;
    height: 29px;
    border-radius: var(--r-icon);
    display: grid;
    place-items: center;
    color: #fff;
  }
  .tile.spin :global(svg) {
    animation: spin 1s linear infinite;
  }
  .txt {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }
  .t {
    font-size: var(--t-body);
    line-height: 1.3;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .online .t {
    color: var(--accent);
  }
  .error .t {
    color: var(--red);
  }
  .s {
    font-size: var(--t-footnote);
    color: var(--label-2);
    line-height: 1.38;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .error .s,
  .disabled .s {
    white-space: normal;
  }
  .foot {
    margin: 8px 16px 10px;
    font-size: var(--t-footnote);
    color: var(--label-2);
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .tile.spin :global(svg) {
      animation: none;
    }
  }
</style>
