<script lang="ts">
  // Header of the Route sheet (spec §3.2): route name or "Route", resort · "Changed since you saved it",
  // Share GPX + Close. On the settings sub-pages: back button and page title.
  import Icon from '../Icon.svelte';
  import SheetHeader from '../SheetHeader.svelte';
  import SubPageHeader from '../SubPageHeader.svelte';
  import type { AppState } from '../../lib/app.svelte.ts';

  let { app, onclose }: { app: AppState; onclose: () => void } = $props();
  const route = $derived(app.route);
  const ui = $derived(app.ui);
  const title = $derived(route.savedId && route.routeName ? route.routeName : 'Route');
  const n = $derived(route.points.length);
</script>

{#if ui.routePage === 'settings'}
  <SubPageHeader title="Route settings" back="Route" onback={() => (ui.routePage = 'main')} {onclose} />
{:else if ui.routePage === 'speeds'}
  <SubPageHeader title="Speed per run colour" back="Settings" onback={() => (ui.routePage = 'settings')} {onclose} />
{:else}
  <SheetHeader {title} {onclose}>
    {#snippet subtitle()}
      {app.resort?.name ?? ''}{#if route.changedSinceSaved}{' · '}<span class="changed" data-testid="changed-since-saved"
          >Changed since you saved it</span
        >{:else if n >= 2}{` · ${n} points`}{/if}
    {/snippet}
    {#snippet actions()}
      <button
        type="button"
        class="round-btn accent"
        aria-label="Share GPX"
        title={app.desktop ? 'Download this route as a GPX file' : 'Share GPX'}
        disabled={!route.result}
        onclick={() => void app.shareGpx()}
        data-testid="share-gpx"
      >
        <Icon name="share" size={18} strokeWidth={2.4} />
      </button>
    {/snippet}
  </SheetHeader>
{/if}

<style>
  .changed {
    color: var(--orange);
  }
</style>
