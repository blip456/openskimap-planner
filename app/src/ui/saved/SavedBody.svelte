<script lang="ts">
  // Saved sheet content (spec §3.3; old planner "Saved routes"): save the current route (name, folder), the saved
  // routes grouped by folder, open / share GPX / delete (swipe on touch, Edit mode, or the delete button with a
  // mouse), share a folder as ZIP. Desktop with the project folder: storage choice This device | Project folder.
  import Icon from '../Icon.svelte';
  import Segmented from '../Segmented.svelte';
  import SwipeRow from './SwipeRow.svelte';
  import type { AppState } from '../../lib/app.svelte.ts';
  import { DEFAULT_FOLDER, type SavedRouteMeta } from '../../lib/saved/stores.ts';
  import { formatDistance } from '../../lib/format.ts';
  import type { StorageId } from '../../lib/stores/saved.svelte.ts';

  let { app }: { app: AppState } = $props();
  const route = $derived(app.route);
  const saved = $derived(app.saved);
  const desktop = $derived(app.desktop);
  const canSave = $derived(route.points.length >= 2);
  let openSwipe = $state<string | null>(null);

  const dateFmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' });
  function meta(r: SavedRouteMeta): string {
    const parts = [`${r.points} point${r.points === 1 ? '' : 's'}`];
    if (r.summary?.distance != null) parts.push(formatDistance(r.summary.distance));
    const d = new Date(r.updatedAt);
    if (!Number.isNaN(d.getTime())) parts.push(dateFmt.format(d));
    if (r.resort !== app.resort?.id) parts.unshift(r.resortName || r.resort);
    return parts.join(' · ');
  }

  async function openRoute(id: string) {
    await saved.open(id);
  }

  async function remove(r: SavedRouteMeta) {
    openSwipe = null;
    await saved.delete(r);
  }

  const footer = $derived(
    saved.storage === 'server'
      ? 'Saved as files in the saved-routes folder of the project.'
      : desktop
        ? 'Saved in this browser only.'
        : 'Saved on this iPhone only. Export a backup in Settings.',
  );
</script>

<div data-testid="saved-sheet">
  {#if saved.stores.server}
    <div class="storage">
      <Segmented
        label="Where to save routes"
        value={saved.storage}
        options={[
          { value: 'browser', label: 'This device', title: 'Saved in this browser only' },
          { value: 'server', label: 'Project folder', title: 'Saved as files in the saved-routes folder of the project' },
        ]}
        onchange={(v: StorageId) => void saved.setStorage(v)}
        testid="storage-choice"
      />
    </div>
  {/if}

  <h3 class="grp-h">Current route</h3>
  <div class="grp">
    {#if !canSave}
      <div class="row"><span class="txt muted">Plan a route with a start and a destination to save it.</span></div>
    {:else}
      <label class="row field">
        <span class="label">Name</span>
        <input
          type="text"
          placeholder={`${app.resort?.name ?? 'Ski'} route`}
          bind:value={route.routeName}
          maxlength="120"
          autocomplete="off"
          enterkeyhint="done"
          data-testid="route-name"
        />
      </label>
      <label class="row field">
        <span class="label">Folder</span>
        <input type="text" placeholder={DEFAULT_FOLDER} bind:value={route.routeFolder} maxlength="60" list="folder-list" autocomplete="off" data-testid="route-folder" />
        <datalist id="folder-list">
          {#each saved.folderNames as f (f)}<option value={f}></option>{/each}
        </datalist>
        <span class="pick" title="Pick a folder">
          <Icon name="chevronDown" size={16} strokeWidth={2.4} />
          <select aria-label="Pick a folder" onchange={(e) => (route.routeFolder = e.currentTarget.value)} value="">
            <option value="" disabled>Folders</option>
            {#each saved.folderNames as f (f)}<option value={f}>{f}</option>{/each}
          </select>
        </span>
      </label>
      {#if route.savedId}
        <button type="button" class="row link" onclick={() => void saved.save(false)} disabled={saved.saving} data-testid="save-route">Save changes</button>
        <button type="button" class="row link" onclick={() => void saved.save(true)} disabled={saved.saving} data-testid="save-copy">Save as new route</button>
      {:else}
        <button type="button" class="row link" onclick={() => void saved.save(false)} disabled={saved.saving} data-testid="save-route">Save route</button>
      {/if}
    {/if}
  </div>
  {#if saved.status}
    <p class="grp-f" class:err={saved.status.error} data-testid="save-status">{saved.status.text}</p>
  {:else if route.changedSinceSaved}
    <p class="grp-f changed">Changed since you saved it.</p>
  {:else}
    <p class="grp-f">{footer}</p>
  {/if}

  <div class="grp-gap"></div>
  {#if saved.error}
    <p class="grp-f err">Could not load saved routes: {saved.error}</p>
  {:else if !saved.folders.length}
    <div class="empty-state" data-testid="saved-empty">
      <span class="icon"><Icon name="bookmark" size={40} strokeWidth={1.75} /></span>
      <h3>No saved routes</h3>
      <p>Routes you save appear here, grouped by folder.</p>
    </div>
  {:else}
    {#each saved.folders as folder (folder.name)}
      <h3 class="grp-h folder-h"><Icon name="folder" size={14} strokeWidth={2.2} /> {folder.name}</h3>
      <div class="grp" data-testid={`folder-${folder.name}`}>
        {#each folder.routes as r (r.id)}
          <SwipeRow ondelete={() => void remove(r)} open={openSwipe === r.id} testid={`saved-row-${r.id}`}>
            <div class="row saved-row">
              {#if app.ui.savedEdit}
                <button type="button" class="minus" aria-label={`Delete ${r.name}`} onclick={() => void remove(r)} data-testid="edit-delete">
                  <Icon name="circleMinus" size={22} />
                </button>
              {/if}
              <button type="button" class="open" onclick={() => void openRoute(r.id)} data-testid="open-saved" title="Open this route">
                <span class="t">{r.name}</span>
                <span class="s">{meta(r)}</span>
              </button>
              {#if route.savedId === r.id}
                <span class="current" title="Open now" aria-label="Open now"><Icon name="circleCheck" size={20} /></span>
              {/if}
              <button
                type="button"
                class="icon-btn"
                aria-label={`${desktop ? 'Download' : 'Share'} GPX of ${r.name}`}
                title={desktop ? 'Download GPX' : 'Share GPX'}
                onclick={() => void app.shareBlob(() => saved.store.gpxBlob(r.id))}
                data-testid="saved-gpx"
              >
                <Icon name="share" size={18} strokeWidth={2.2} />
              </button>
              {#if desktop && !app.ui.savedEdit}
                <button type="button" class="icon-btn red" aria-label={`Delete ${r.name}`} title="Delete" onclick={() => void remove(r)} data-testid="saved-delete">
                  <Icon name="trash" size={18} strokeWidth={2.2} />
                </button>
              {/if}
            </div>
          </SwipeRow>
        {/each}
        <button
          type="button"
          class="row link"
          onclick={() => void app.shareBlob(() => saved.store.zipBlob(folder.name))}
          title="All GPX files of this folder in one ZIP file"
          data-testid="share-folder"
        >
          <Icon name="share" size={18} strokeWidth={2.2} /> {desktop ? 'Download folder (ZIP)' : 'Share folder (ZIP)'}
        </button>
      </div>
      <div class="grp-gap small"></div>
    {/each}
  {/if}
</div>

<style>
  .storage {
    margin: 0 0 16px;
  }
  .muted {
    color: var(--label-2);
    font-size: var(--t-subhead);
  }
  .field {
    gap: 8px;
  }
  .field .label {
    flex: none;
    width: 64px;
  }
  .field input {
    flex: 1;
    min-width: 0;
    height: 32px;
    border: 0;
    background: none;
    color: var(--label);
    font: 17px var(--font);
    text-align: right;
    padding: 0;
    outline: none;
  }
  .field input::placeholder {
    color: var(--label-3);
  }
  .pick {
    position: relative;
    flex: none;
    width: 28px;
    height: 32px;
    display: grid;
    place-items: center;
    color: var(--label-3);
  }
  .pick select {
    position: absolute;
    inset: -6px;
    opacity: 0;
    cursor: pointer;
    font-size: 17px;
  }
  .err {
    color: var(--red);
  }
  .changed {
    color: var(--orange);
  }
  .grp-gap.small {
    height: 16px;
  }
  .folder-h {
    display: flex;
    align-items: center;
    gap: 5px;
  }
  .saved-row {
    gap: 8px;
    padding-right: 8px;
  }
  .open {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    border: 0;
    background: none;
    color: inherit;
    font: inherit;
    padding: 0;
    text-align: left;
    cursor: pointer;
  }
  .open .t {
    font-size: var(--t-body);
    max-width: 100%;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .open .s {
    font-size: var(--t-footnote);
    color: var(--label-2);
  }
  .current {
    display: grid;
    color: var(--green);
  }
  .icon-btn,
  .minus {
    position: relative;
    flex: none;
    width: 36px;
    height: 36px;
    border: 0;
    border-radius: var(--r-pill);
    background: none;
    color: var(--accent);
    display: grid;
    place-items: center;
    cursor: pointer;
    padding: 0;
  }
  .icon-btn::before,
  .minus::before {
    content: '';
    position: absolute;
    inset: -4px;
  }
  .icon-btn.red,
  .minus {
    color: var(--red);
  }
  @media (hover: hover) {
    .icon-btn:hover {
      background: var(--fill-3);
    }
  }
  .link {
    gap: 8px;
  }
</style>
