<script lang="ts">
  // Header of the Saved sheet: "Saved routes", Edit / Done, Close (spec §2.9, §3.3).
  import SheetHeader from '../SheetHeader.svelte';
  import type { AppState } from '../../lib/app.svelte.ts';

  let { app, onclose }: { app: AppState; onclose: () => void } = $props();
</script>

<SheetHeader title="Saved routes" {onclose}>
  {#snippet actions()}
    {#if app.saved.count > 0}
      <button type="button" class="edit" onclick={() => (app.ui.savedEdit = !app.ui.savedEdit)} data-testid="saved-edit">
        {app.ui.savedEdit ? 'Done' : 'Edit'}
      </button>
    {/if}
  {/snippet}
</SheetHeader>

<style>
  .edit {
    height: 36px;
    border: 0;
    background: none;
    color: var(--accent);
    font: 17px var(--font);
    padding: 0 6px;
    cursor: pointer;
  }
</style>
