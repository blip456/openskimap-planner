<script lang="ts">
  // Floating tab capsule (Route · Saved · Map) + separate search button (spec §2.3, §2.4).
  import Icon from './Icon.svelte';
  import type { IconName } from './icons.ts';
  import type { SheetId } from '../lib/stores/ui.svelte.ts';

  let { open, onselect, onsearch }: { open: SheetId | null; onselect: (id: SheetId) => void; onsearch: () => void } = $props();

  const tabs: { id: SheetId; label: string; icon: IconName }[] = [
    { id: 'route', label: 'Route', icon: 'route' },
    { id: 'saved', label: 'Saved', icon: 'bookmark' },
    { id: 'map', label: 'Map', icon: 'map' },
  ];
  const selected = $derived(tabs.findIndex((t) => t.id === open));
</script>

<div class="bar-row">
  <nav class="glass tabs" aria-label="Panels">
    {#if selected >= 0}
      <span class="pill" style:transform={`translateX(${selected * 100}%)`} aria-hidden="true"></span>
    {/if}
    {#each tabs as tab (tab.id)}
      <button
        type="button"
        class="tab"
        class:selected={tab.id === open}
        aria-expanded={tab.id === open}
        aria-controls="sheet"
        aria-current={tab.id === open ? 'true' : undefined}
        onclick={() => onselect(tab.id)}
        data-testid={`tab-${tab.id}`}
      >
        <span class="content">
          <Icon name={tab.icon} size={24} />
          <span class="label">{tab.label}</span>
        </span>
      </button>
    {/each}
  </nav>
  <button type="button" class="glass search" aria-label="Search" title="Search" onclick={onsearch} data-testid="search-button">
    <Icon name="search" size={24} />
  </button>
</div>

<style>
  .bar-row {
    position: fixed;
    left: calc(var(--edge) + var(--safe-left));
    right: calc(var(--edge) + var(--safe-right));
    bottom: var(--tabbar-bottom);
    z-index: var(--z-tabbar);
    display: flex;
    gap: 10px;
    justify-content: center;
    pointer-events: none;
  }
  .tabs,
  .search {
    pointer-events: auto;
  }
  .tabs {
    position: relative;
    flex: 1;
    max-width: 440px;
    height: var(--tabbar-h);
    box-sizing: border-box; /* 64 high including the 4 px padding (spec §2.3) */
    padding: 4px;
    border-radius: var(--r-pill);
    display: grid;
    grid-template-columns: repeat(3, 1fr);
  }
  .pill {
    position: absolute;
    top: 4px;
    left: 4px;
    width: calc((100% - 8px) / 3);
    height: var(--tab-item-h);
    border-radius: var(--r-pill);
    background: var(--glass-pill);
    transition: transform var(--dur-press) var(--spring-press);
  }
  .tab {
    position: relative;
    height: var(--tab-item-h);
    border: 0;
    background: none;
    color: inherit;
    font: inherit;
    cursor: pointer;
    border-radius: var(--r-pill);
    padding: 0;
  }
  .content {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 3px;
    transition: transform var(--dur-press) var(--spring-press);
  }
  .tab:active .content {
    transform: scale(var(--press-scale));
    transition-duration: var(--dur-instant);
  }
  .label {
    font-size: 10px;
    line-height: 11px;
    font-weight: var(--fw-semibold);
  }
  .selected {
    color: var(--glass-accent);
  }
  .search {
    flex: none;
    width: var(--tabbar-h);
    height: var(--tabbar-h);
    border: 0;
    border-radius: var(--r-pill);
    display: grid;
    place-items: center;
    cursor: pointer;
  }
</style>
