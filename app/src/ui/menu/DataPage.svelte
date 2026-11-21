<script lang="ts">
  // Menu › Data (PWA only, spec §3.5 / §2.21, plan §5): what is installed (from the data file's manifest), the size
  // of each part, the browser storage (used / available, protection with persist()), Import new file (the new data
  // replaces the old only when it is complete) and Delete data.
  import { onMount } from 'svelte';
  import ImportProgress from '../ImportProgress.svelte';
  import ImportErrorBox from '../ImportErrorBox.svelte';
  import ConfirmDialog from '../ConfirmDialog.svelte';
  import type { AppState } from '../../lib/app.svelte.ts';
  import { formatBytes } from '../../lib/format.ts';
  import { dataParts, freeBytes, persistText, usedShare } from '../../lib/data/storage-info.ts';

  let { app }: { app: AppState } = $props();
  let input: HTMLInputElement;
  let confirmDelete = $state(false);
  const info = $derived(app.data?.info);
  const zoom = $derived(info?.zoom);
  const detail = $derived(
    zoom ? [zoom.terrain != null ? `Terrain z${zoom.terrain}` : null, zoom.basemap != null ? `Map z${zoom.basemap}` : null, zoom.ski != null ? `Runs z${zoom.ski}` : null].filter(Boolean).join(' · ') : '',
  );
  const parts = $derived(info?.files ? dataParts(info.files) : []);
  const storage = $derived(app.storage);
  const free = $derived(freeBytes(storage));
  const share = $derived(usedShare(storage));
  const protection = $derived(persistText(storage.persisted));
  const dev = import.meta.env.DEV;

  onMount(() => void app.refreshStorage());

  function formatDate(iso: string | null | undefined): string {
    if (!iso) return '–';
    const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`);
    return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  function picked() {
    const file = input.files?.[0];
    input.value = '';
    if (file) void app.importData(file);
  }
</script>

{#if app.importing}
  <ImportProgress progress={app.importProgress} oncancel={() => app.cancelRunningImport()} />
  <div class="grp-gap"></div>
{:else if app.importError}
  <ImportErrorBox failure={app.importError} />
  <div class="grp-gap"></div>
{/if}

<h3 class="grp-h">Installed data</h3>
<div class="grp" data-testid="installed-data">
  <div class="row"><span class="txt"><span class="t">Resorts</span></span><span class="val">{info?.resorts.map((r) => r.name).join(', ') || '–'}</span></div>
  <div class="row"><span class="txt"><span class="t">Built on</span></span><span class="val">{formatDate(info?.buildDate)}</span></div>
  {#if info?.openSkiDataDate}<div class="row"><span class="txt"><span class="t">Ski data from</span></span><span class="val">{formatDate(info.openSkiDataDate)}</span></div>{/if}
  {#if detail}<div class="row"><span class="txt"><span class="t">Detail level</span></span><span class="val">{detail}</span></div>{/if}
</div>

{#if parts.length}
  <div class="grp-gap"></div>
  <h3 class="grp-h">Size</h3>
  <div class="grp" data-testid="data-parts">
    {#each parts as p (p.id)}
      <div class="row"><span class="txt"><span class="t">{p.label}</span></span><span class="val">{formatBytes(p.bytes)}</span></div>
    {/each}
    <div class="row total"><span class="txt"><span class="t">Total</span></span><span class="val" data-testid="data-total">{formatBytes(info?.sizeBytes ?? 0)}</span></div>
  </div>
{/if}

<div class="grp-gap"></div>
<h3 class="grp-h">Storage on this device</h3>
<div class="grp" data-testid="storage">
  <div class="row col">
    <div class="line">
      <span class="t">Used by this app</span><span class="val" data-testid="storage-used">{storage.usage != null ? formatBytes(storage.usage) : '–'}</span>
    </div>
    {#if share != null}
      <div class="meter" role="meter" aria-label="Storage used" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(share * 100)}>
        <div class="fill" style:transform={`scaleX(${Math.max(0.01, share)})`}></div>
      </div>
    {/if}
  </div>
  {#if free != null}<div class="row"><span class="txt"><span class="t">Available</span></span><span class="val" data-testid="storage-free">{formatBytes(free)}</span></div>{/if}
  <div class="row">
    <span class="txt"><span class="t">Keep data</span></span>
    <span class="val" class:on={storage.persisted === true} class:off={storage.persisted === false} data-testid="storage-persisted">{protection.value}</span>
  </div>
  {#if storage.persisted === false}
    <button type="button" class="row link" onclick={() => void app.protectData()} data-testid="protect-data">
      <span class="txt"><span class="t">Ask to keep the data</span></span>
    </button>
  {/if}
</div>
<p class="grp-f" data-testid="storage-note">{protection.note}</p>

<div class="grp-gap"></div>
<div class="grp">
  <button type="button" class="row link" disabled={app.importing || app.deleting} onclick={() => input.click()} data-testid="menu-import">
    <span class="txt"><span class="t">Import new data file…</span></span>
  </button>
  {#if dev}
    <button type="button" class="row link" disabled={app.importing} onclick={() => void app.importFromBuild()}>
      <span class="txt"><span class="t">Load data from build/</span></span>
    </button>
  {/if}
</div>
<p class="grp-f">The new data replaces this data. Your current data stays until the new data is complete.</p>

<div class="grp-gap"></div>
<div class="grp">
  <button type="button" class="row destructive" disabled={app.importing || app.deleting} onclick={() => (confirmDelete = true)} data-testid="delete-data">
    <span class="txt"><span class="t">Delete data</span></span>
  </button>
</div>
<p class="grp-f">Frees {info?.sizeBytes ? formatBytes(info.sizeBytes) : 'the space'}. Saved routes and settings stay.</p>
<input bind:this={input} type="file" accept=".zip,application/zip" hidden onchange={picked} data-testid="menu-import-input" />

{#if confirmDelete}
  <ConfirmDialog
    title="Delete the map data?"
    message="The map, routes and search stop working until you import a data file again. Your saved routes stay."
    action="Delete"
    destructive
    onconfirm={() => {
      confirmDelete = false;
      void app.deleteData();
    }}
    oncancel={() => (confirmDelete = false)}
  />
{/if}

<style>
  .val {
    text-align: right;
    max-width: 60%;
  }
  .total .t {
    font-weight: var(--fw-semibold);
  }
  .row .val.on {
    color: var(--green);
  }
  .row .val.off {
    color: var(--orange);
  }
  .row.col {
    flex-direction: column;
    align-items: stretch;
    gap: 8px;
    padding-top: 12px;
    padding-bottom: 12px;
  }
  .line {
    display: flex;
    justify-content: space-between;
    gap: 12px;
  }
  .meter {
    height: 6px;
    border-radius: 3px;
    background: var(--fill-3);
    overflow: hidden;
  }
  .fill {
    height: 100%;
    background: var(--accent);
    transform-origin: left;
  }
</style>
