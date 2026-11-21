<script lang="ts">
  // Menu › gpx.studio (desktop build only, spec §3.5): the TileServer GL tile links with Copy buttons.
  import Icon from '../Icon.svelte';
  import type { AppState } from '../../lib/app.svelte.ts';
  import { gpxStudioLinks } from '../../lib/gpx-studio.ts';

  let { app }: { app: AppState } = $props();
  const links = $derived(gpxStudioLinks(app.caps.tileServerUrl));
  let copied = $state<string | null>(null);
  let timer: ReturnType<typeof setTimeout> | null = null;

  async function copy(url: string) {
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // older browsers / no permission: select-and-copy fallback
      const ta = document.createElement('textarea');
      ta.value = url;
      document.body.append(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    copied = url;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => (copied = null), 1500);
  }
</script>

<p class="grp-f intro">In gpx.studio: Map layers ⚙ → Custom layers. Paste a link.</p>
<div class="grp" data-testid="gpx-links">
  {#each links as l (l.url)}
    <div class="row link-row">
      <span class="txt">
        <span class="t">{l.title}</span>
        <span class="url" title={l.url}>{l.url}</span>
      </span>
      <button type="button" class="cap-btn" onclick={() => void copy(l.url)} data-testid="gpx-copy">
        {#if copied === l.url}<Icon name="check" size={16} /> Copied{:else}<Icon name="copy" size={16} /> Copy{/if}
      </button>
    </div>
  {/each}
</div>
<p class="grp-f">The tile server must be running (npm start). JPG is a basemap, PNG an overlay.</p>

<style>
  .intro {
    margin-bottom: 8px;
  }
  .link-row .txt {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .url {
    font: 13px var(--font-mono);
    color: var(--label-2);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
</style>
