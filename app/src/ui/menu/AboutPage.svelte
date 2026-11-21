<script lang="ts">
  // Menu › About & credits (spec §3.5; README "Data & licenses"): version, data sources and licences, map credits.
  import Icon from '../Icon.svelte';
  import type { AppState } from '../../lib/app.svelte.ts';

  let { app }: { app: AppState } = $props();
  const version = import.meta.env.VITE_APP_VERSION;

  const SOURCES = [
    { title: 'OpenSkiData / OpenSkiMap.org', sub: 'Runs, lifts and ski areas', href: 'https://openskidata.org' },
    { title: 'OpenStreetMap contributors', sub: 'Map data, ODbL licence', href: 'https://www.openstreetmap.org/copyright' },
    { title: 'Skimap.org', sub: 'Ski area data', href: 'https://skimap.org' },
    { title: "Who's On First", sub: 'Places', href: 'https://whosonfirst.org' },
    { title: 'Mapterhorn', sub: 'Terrain (elevation)', href: 'https://mapterhorn.com/attribution' },
    { title: 'Protomaps', sub: 'Basemap (OpenStreetMap); fonts and icons (OFL)', href: 'https://protomaps.com' },
  ];
  const ONLINE = [
    { title: 'OpenStreetMap tiles', sub: 'Tile usage policy', href: 'https://operations.osmfoundation.org/policies/tiles/' },
    { title: 'OpenFreeMap', sub: 'Online vector map', href: 'https://openfreemap.org' },
    { title: 'OpenSnowMap', sub: 'Piste tiles © opensnowmap.org, CC-BY-SA', href: 'https://www.opensnowmap.org' },
  ];
</script>

<div class="about-head">
  <img src="/logo.svg" alt="" width="64" height="64" />
  <div class="name">Ski route planner</div>
  <div class="ver" data-testid="app-version">Version {version}</div>
</div>

{#snippet linkRows(rows: { title: string; sub: string; href: string }[])}
  <div class="grp">
    {#each rows as r (r.href)}
      <a class="row tappable" href={r.href} target="_blank" rel="noopener noreferrer">
        <span class="txt"><span class="t">{r.title}</span><span class="s">{r.sub}</span></span>
        <span class="chev"><Icon name="externalLink" size={15} /></span>
      </a>
    {/each}
  </div>
{/snippet}

<h3 class="grp-h">Data sources</h3>
{@render linkRows(SOURCES)}
<p class="grp-f">
  The map is built {app.caps.target === 'pwa' ? 'on your computer and stored on this device' : 'and served locally'} from the downloadable OpenSkiData files.
</p>

<div class="grp-gap"></div>
<h3 class="grp-h">Online maps (online mode only)</h3>
{@render linkRows(ONLINE)}
<p class="grp-f">Online maps load their tiles straight from these providers while you use them.</p>

<div class="grp-gap"></div>
<p class="grp-f">Always check the piste map and the conditions on the day.</p>

<style>
  .about-head {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    margin: 0 0 20px;
  }
  .about-head img {
    border-radius: 14px;
    box-shadow: 0 4px 14px rgba(0, 0, 0, 0.15);
  }
  .name {
    margin-top: 6px;
    font-size: var(--t-title3);
    font-weight: var(--fw-bold);
  }
  .ver {
    font-size: var(--t-footnote);
    color: var(--label-2);
  }
  a.row {
    text-decoration: none;
    color: inherit;
  }
  .txt {
    display: flex;
    flex-direction: column;
  }
</style>
