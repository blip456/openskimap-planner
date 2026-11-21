<script lang="ts">
  // Menu › Resort (spec §3.5): one checkmark row per resort in the data. Picking one opens it on the map.
  import Icon from '../Icon.svelte';
  import type { AppState } from '../../lib/app.svelte.ts';

  let { app }: { app: AppState } = $props();
  const resorts = $derived(app.data?.info.resorts ?? []);
  const built = $derived(app.data?.info.buildDate ? `Built ${formatDate(app.data.info.buildDate)}` : '');

  function formatDate(iso: string): string {
    const d = new Date(`${iso}T12:00:00Z`);
    return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  async function pick(id: string) {
    if (id !== app.resort?.id) await app.switchResort(id);
    app.ui.closeMenu();
  }
</script>

<div class="grp" role="radiogroup" aria-label="Resort" data-testid="resort-list">
  {#each resorts as r (r.id)}
    <button type="button" class="row" role="radio" aria-checked={r.id === app.resort?.id} onclick={() => void pick(r.id)} data-testid={`resort-${r.id}`}>
      <span class="txt">
        <span class="t">{r.name}</span>
        {#if built}<span class="s">{built}</span>{/if}
      </span>
      {#if r.id === app.resort?.id}<span class="chk"><Icon name="check" size={20} strokeWidth={2.6} /></span>{/if}
    </button>
  {/each}
</div>
<p class="grp-f">To add a resort, add it to resorts.json, build a new data file with it{app.caps.importData ? ' and import it' : ''}.</p>
