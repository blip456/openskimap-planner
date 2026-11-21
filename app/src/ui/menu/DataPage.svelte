<script lang="ts">
  // Menu › Data (PWA only, spec §3.5 / §2.21): what is installed (from the data file's manifest) and Import data
  // file (the phase 3 import pipeline). The full storage screen (protection, delete) comes in phase 5.
  import Icon from '../Icon.svelte';
  import ImportProgress from '../ImportProgress.svelte';
  import type { AppState } from '../../lib/app.svelte.ts';
  import { formatMB } from '../../lib/format.ts';

  let { app }: { app: AppState } = $props();
  let input: HTMLInputElement;
  const info = $derived(app.data?.info);
  const zoom = $derived(info?.zoom);
  const detail = $derived(zoom ? [zoom.terrain != null ? `Terrain z${zoom.terrain}` : null, zoom.basemap != null ? `Map z${zoom.basemap}` : null].filter(Boolean).join(' · ') : '');
  let free = $state<number | null>(null);
  const dev = import.meta.env.DEV;

  $effect(() => {
    void app.dataVersion;
    navigator.storage
      ?.estimate?.()
      .then((e) => (free = e.quota != null && e.usage != null ? Math.max(0, e.quota - e.usage) : null))
      .catch(() => (free = null));
  });

  function formatDate(iso: string | null | undefined): string {
    if (!iso) return '–';
    const d = new Date(`${iso}T12:00:00Z`);
    return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  function picked() {
    const file = input.files?.[0];
    input.value = '';
    if (file) void app.importData(file);
  }
  const size = (b: number) => (b >= 1024 ** 3 ? `${(b / 1024 ** 3).toFixed(1)} GB` : formatMB(b));
</script>

{#if app.importing}
  <ImportProgress progress={app.importProgress} oncancel={() => app.cancelRunningImport()} />
  <div class="grp-gap"></div>
{:else if app.importError}
  <div class="grp err" role="alert" data-testid="import-error">
    <div class="row"><span class="red"><Icon name="triangleAlert" size={20} /></span><span class="txt">{app.importError}</span></div>
  </div>
  <div class="grp-gap"></div>
{/if}

<h3 class="grp-h">Installed data</h3>
<div class="grp" data-testid="installed-data">
  <div class="row"><span class="txt"><span class="t">Resorts</span></span><span class="val">{info?.resorts.map((r) => r.name).join(', ') || '–'}</span></div>
  <div class="row"><span class="txt"><span class="t">Built on</span></span><span class="val">{formatDate(info?.buildDate)}</span></div>
  {#if detail}<div class="row"><span class="txt"><span class="t">Detail level</span></span><span class="val">{detail}</span></div>{/if}
  {#if info?.sizeBytes}<div class="row"><span class="txt"><span class="t">Space used</span></span><span class="val">{size(info.sizeBytes)}</span></div>{/if}
  {#if free != null}<div class="row"><span class="txt"><span class="t">Free space</span></span><span class="val">{size(free)}</span></div>{/if}
</div>
<p class="grp-f">A new data file replaces this data. Your current data stays until the new data is ready.</p>

<div class="grp-gap"></div>
<div class="grp">
  <button type="button" class="row link" disabled={app.importing} onclick={() => input.click()} data-testid="menu-import">
    <span class="txt"><span class="t">Import data file…</span></span>
  </button>
  {#if dev}
    <button type="button" class="row link" disabled={app.importing} onclick={() => void app.importFromBuild()}>
      <span class="txt"><span class="t">Load data from build/</span></span>
    </button>
  {/if}
</div>
<input bind:this={input} type="file" accept=".zip,application/zip" hidden onchange={picked} data-testid="menu-import-input" />

<style>
  .val {
    text-align: right;
    max-width: 60%;
  }
  .red {
    color: var(--red);
    display: grid;
  }
  .err .txt {
    font-size: var(--t-subhead);
  }
</style>
