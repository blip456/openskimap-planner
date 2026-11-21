<script lang="ts">
  // Menu root (spec §3.5): Resort · Online mode · Data (PWA) · Routes backup · Appearance · gpx.studio (desktop
  // build) · About & credits.
  import Icon from '../Icon.svelte';
  import Switch from '../Switch.svelte';
  import type { IconName } from '../icons.ts';
  import type { MenuPage } from '../../lib/stores/ui.svelte.ts';
  import type { AppState } from '../../lib/app.svelte.ts';
  import { formatMB } from '../../lib/format.ts';

  let { app }: { app: AppState } = $props();
  const caps = $derived(app.caps);
  const size = $derived(app.data?.info.sizeBytes);
  const version = import.meta.env.VITE_APP_VERSION;
</script>

{#snippet chevronRow(page: MenuPage, icon: IconName, color: string, title: string, value: string = '')}
  <button type="button" class="row has-icon" onclick={() => (app.ui.menuPage = page)} data-testid={`menu-row-${page}`}>
    <span class="tile" style:background={color}><Icon name={icon} size={18} /></span>
    <span class="txt"><span class="t">{title}</span></span>
    {#if value}<span class="val">{value}</span>{/if}
    <span class="chev"><Icon name="chevronRight" size={14} strokeWidth={3} /></span>
  </button>
{/snippet}

<div class="grp">
  {@render chevronRow('resort', 'mountainSnow', 'var(--green)', 'Resort', app.resort?.name ?? '')}
  <label class="row has-icon tappable">
    <span class="tile" style:background="var(--accent)"><Icon name="globe" size={18} /></span>
    <span class="txt"><span class="t">Online mode</span></span>
    {#if app.settings.online && !app.network}<span class="val warn">No internet</span>{/if}
    <Switch checked={app.settings.online} onchange={(v) => app.setOnline(v)} testid="online-mode" />
  </label>
</div>
<p class="grp-f">Off: everything works without internet. On: adds online maps and online search.</p>

<div class="grp-gap"></div>
<div class="grp">
  {#if caps.importData}{@render chevronRow('data', 'hardDrive', 'var(--gray)', 'Data', size ? formatMB(size) : '')}{/if}
  {@render chevronRow('backup', 'archive', 'var(--orange)', 'Routes backup')}
  {@render chevronRow('appearance', 'sunMoon', 'var(--indigo)', 'Appearance')}
</div>

{#if caps.target === 'desktop'}
  <div class="grp-gap"></div>
  <div class="grp">
    {@render chevronRow('gpx', 'link', 'var(--teal)', 'gpx.studio')}
  </div>
{/if}

<div class="grp-gap"></div>
<div class="grp">
  {@render chevronRow('about', 'info', 'var(--gray)', 'About & credits', version)}
</div>
<p class="grp-f">Always check the piste map and the conditions on the day.</p>

<style>
  .row .val {
    max-width: 55%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .warn {
    color: var(--orange);
  }
</style>
