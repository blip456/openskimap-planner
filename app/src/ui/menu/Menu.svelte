<script lang="ts">
  // Settings menu (spec §2.22, §3.5): iPhone → modal large sheet over a scrim with pages that push in from the
  // right (back button, swipe from the left edge); desktop → popover under the menu button. Esc closes.
  import Icon from '../Icon.svelte';
  import RootPage from './RootPage.svelte';
  import ResortPage from './ResortPage.svelte';
  import DataPage from './DataPage.svelte';
  import BackupPage from './BackupPage.svelte';
  import AppearancePage from './AppearancePage.svelte';
  import GpxPage from './GpxPage.svelte';
  import AboutPage from './AboutPage.svelte';
  import type { AppState } from '../../lib/app.svelte.ts';
  import type { MenuPage } from '../../lib/stores/ui.svelte.ts';

  let { app, popover = false }: { app: AppState; popover?: boolean } = $props();
  const ui = $derived(app.ui);

  const TITLES: Record<Exclude<MenuPage, 'root'>, string> = {
    resort: 'Resort',
    data: 'Data',
    backup: 'Routes backup',
    appearance: 'Appearance',
    gpx: 'gpx.studio',
    about: 'About & credits',
  };
  const close = () => ui.closeMenu();
  const back = () => (ui.menuPage = 'root');

  let panel: HTMLDivElement;
  $effect(() => {
    void ui.menuPage;
    panel?.scrollTo?.(0, 0);
    // keyboard users land on the page title
    (panel?.querySelector('h1, h2') as HTMLElement | null)?.focus({ preventScroll: true });
  });

  // swipe from the left edge goes back (iOS)
  let swipe: { id: number; x: number; y: number } | null = null;
  function onpointerdown(e: PointerEvent) {
    if (popover || ui.menuPage === 'root' || e.pointerType === 'mouse') return;
    const left = panel.getBoundingClientRect().left;
    if (e.clientX - left <= 20) swipe = { id: e.pointerId, x: e.clientX, y: e.clientY };
  }
  function onpointermove(e: PointerEvent) {
    if (!swipe || e.pointerId !== swipe.id) return;
    if (e.clientX - swipe.x > 60 && Math.abs(e.clientY - swipe.y) < 40) {
      swipe = null;
      back();
    }
  }

  function onkeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  }
</script>

<button type="button" class="scrim" class:clear={popover} aria-label="Close settings" tabindex="-1" onclick={close} data-testid="menu-scrim"></button>
<div
  bind:this={panel}
  class="menu"
  class:popover
  role="dialog"
  aria-modal="true"
  aria-labelledby="menu-title"
  tabindex="-1"
  data-testid="menu"
  data-page={ui.menuPage}
  {onkeydown}
  {onpointerdown}
  {onpointermove}
  onpointerup={() => (swipe = null)}
>
  {#if ui.menuPage === 'root'}
    <div class="root-head">
      <button type="button" class="round-btn" aria-label="Close" title="Close" onclick={close} data-testid="menu-close">
        <Icon name="x" size={18} strokeWidth={2.4} />
      </button>
    </div>
    <h1 id="menu-title" class="large-title" tabindex="-1">Settings</h1>
  {:else}
    <div class="sub-head">
      <button type="button" class="back" onclick={back} data-testid="menu-back">
        <Icon name="chevronLeft" size={24} strokeWidth={2.4} /><span>Settings</span>
      </button>
      <h2 id="menu-title" tabindex="-1">{TITLES[ui.menuPage]}</h2>
      <button type="button" class="round-btn" aria-label="Close" title="Close" onclick={close} data-testid="menu-close">
        <Icon name="x" size={18} strokeWidth={2.4} />
      </button>
    </div>
  {/if}
  {#key ui.menuPage}
    <div class="page" class:pushed={ui.menuPage !== 'root'}>
      {#if ui.menuPage === 'root'}<RootPage {app} />
      {:else if ui.menuPage === 'resort'}<ResortPage {app} />
      {:else if ui.menuPage === 'data'}<DataPage {app} />
      {:else if ui.menuPage === 'backup'}<BackupPage {app} />
      {:else if ui.menuPage === 'appearance'}<AppearancePage {app} />
      {:else if ui.menuPage === 'gpx'}<GpxPage {app} />
      {:else}<AboutPage {app} />{/if}
    </div>
  {/key}
</div>

<style>
  .scrim {
    position: fixed;
    inset: 0;
    z-index: var(--z-modal);
    border: 0;
    padding: 0;
    background: var(--scrim);
    animation: fade var(--dur-base) var(--ease-out);
  }
  .scrim.clear {
    background: transparent;
  }
  .menu {
    position: fixed;
    z-index: var(--z-modal);
    top: calc(var(--safe-top) + 8px);
    left: 0;
    right: 0;
    bottom: 0;
    max-width: 640px;
    margin: 0 auto;
    overflow-y: auto;
    overscroll-behavior: contain;
    background: var(--bg-grouped);
    border-radius: var(--r-sheet) var(--r-sheet) 0 0;
    padding: 8px calc(16px + var(--safe-right)) calc(var(--safe-bottom) + 24px) calc(16px + var(--safe-left));
    box-sizing: border-box;
    color: var(--label);
    outline: none;
    animation: sheet-up var(--dur-sheet) var(--spring-sheet);
  }
  .menu.popover {
    top: 64px;
    left: 12px;
    right: auto;
    bottom: auto;
    width: 380px;
    max-height: min(640px, 80vh);
    margin: 0;
    border-radius: var(--r-card);
    background: var(--bg-grouped);
    border: 0.5px solid var(--separator);
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.18);
    padding: 8px 12px 16px;
    animation: pop var(--dur-base) var(--ease-out);
  }
  .root-head {
    display: flex;
    justify-content: flex-end;
    padding: 6px 0 0;
  }
  .large-title {
    margin: 0 4px 16px;
    font-size: var(--t-large-title);
    line-height: var(--t-large-title-lh);
    font-weight: var(--fw-bold);
    outline: none;
  }
  .sub-head {
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    align-items: center;
    gap: 8px;
    padding: 6px 0 12px;
    min-height: 52px;
    box-sizing: border-box;
  }
  .sub-head h2 {
    margin: 0;
    font-size: var(--t-headline);
    font-weight: var(--fw-semibold);
    text-align: center;
    white-space: nowrap;
    outline: none;
  }
  .back {
    justify-self: start;
    display: inline-flex;
    align-items: center;
    min-height: 44px;
    border: 0;
    background: none;
    color: var(--accent);
    font: 17px var(--font);
    cursor: pointer;
    padding: 0 4px 0 0;
    margin-left: -8px;
  }
  .sub-head .round-btn,
  .root-head .round-btn {
    justify-self: end;
  }
  .page.pushed {
    animation: push var(--dur-sheet) var(--spring-sheet);
  }
  @keyframes fade {
    from {
      opacity: 0;
    }
  }
  @keyframes sheet-up {
    from {
      transform: translateY(100%);
    }
  }
  @keyframes pop {
    from {
      opacity: 0;
      transform: translateY(-6px);
    }
  }
  @keyframes push {
    from {
      transform: translateX(40%);
      opacity: 0;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .menu,
    .page.pushed {
      animation: fade 200ms linear;
    }
  }
</style>
