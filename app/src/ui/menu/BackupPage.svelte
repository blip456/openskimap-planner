<script lang="ts">
  // Menu › Routes backup (spec §3.5): export all routes of this device as one JSON file, import a backup (asks
  // first), and on the desktop "Copy all to this browser" when routes are saved in the project folder.
  import Icon from '../Icon.svelte';
  import ConfirmDialog from '../ConfirmDialog.svelte';
  import type { AppState } from '../../lib/app.svelte.ts';

  let { app }: { app: AppState } = $props();
  let input: HTMLInputElement;
  let pending = $state<{ text: string; count: number } | null>(null);
  let error = $state<string | null>(null);

  async function picked() {
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    const r = await app.readBackup(file);
    if ('error' in r) {
      error = r.error;
      return;
    }
    error = null;
    if (!r.count) {
      error = 'This backup has no routes.';
      return;
    }
    pending = r;
  }
</script>

<div class="grp">
  <button type="button" class="row link has-icon" onclick={() => void app.exportBackup()} data-testid="export-backup">
    <span class="tile" style:background="var(--accent)"><Icon name="share" size={18} /></span>
    <span class="txt"><span class="t">Export backup</span></span>
  </button>
  <button type="button" class="row link has-icon" onclick={() => input.click()} data-testid="import-backup">
    <span class="tile" style:background="var(--accent)"><Icon name="fileUp" size={18} /></span>
    <span class="txt"><span class="t">Import backup…</span></span>
  </button>
  {#if app.caps.projectFolderRoutes}
    <button type="button" class="row link has-icon" onclick={() => void app.copyAllToBrowser()} data-testid="copy-to-browser">
      <span class="tile" style:background="var(--accent)"><Icon name="copy" size={18} /></span>
      <span class="txt"><span class="t">Copy all to this browser</span><span class="s">Copies the routes of the project folder</span></span>
    </button>
  {/if}
</div>
{#if error}<p class="grp-f err" role="alert" data-testid="backup-error">{error}</p>{/if}
<p class="grp-f">A backup is one file with all your saved routes{app.caps.projectFolderRoutes ? ' of this browser' : ''}. Keep it in Files or iCloud Drive.</p>
<input bind:this={input} type="file" accept=".json,application/json" hidden onchange={picked} data-testid="import-backup-input" />

{#if pending}
  <ConfirmDialog
    title={`Add ${pending.count} route${pending.count === 1 ? '' : 's'} from the backup?`}
    message="Routes with the same id replace the earlier copy."
    action="Add"
    onconfirm={() => {
      const p = pending;
      pending = null;
      if (p) void app.importBackup(p.text);
    }}
    oncancel={() => (pending = null)}
  />
{/if}

<style>
  .err {
    color: var(--red);
    margin-bottom: 8px;
  }
</style>
