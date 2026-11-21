<script lang="ts">
  // Info card content (spec §2.13, old planner skiCard/placeCard/cardActions): key numbers, "Use this spot in your
  // route", then all details, the steepness note, the elevation profile (touch scrubbing, cursor on the map), tags,
  // description and links.
  import ProfileChart from '../route/ProfileChart.svelte';
  import { pinActions } from '../../lib/explore/info-card.ts';
  import type { AppState } from '../../lib/app.svelte.ts';

  let { app, tall = false }: { app: AppState; tall?: boolean } = $props();
  const explore = $derived(app.explore);
  const card = $derived(explore.card);
  const actions = $derived(pinActions(app.route.points.length));
</script>

{#if card}
  <div class="info" data-testid="info-card" data-kind={card.kind} aria-busy={explore.loading}>
    {#if card.crumbs.length}<p class="crumbs">{card.crumbs.join(' › ')}</p>{/if}

    {#if card.stats.length}
      <div class="grp stats" data-testid="info-stats" style:--n={card.stats.length}>
        {#each card.stats as st (st.label)}
          <div class="stat">
            <div class="stat-label">{st.label}</div>
            <div class="stat-value">{st.value}</div>
          </div>
        {/each}
      </div>
    {/if}

    {#if card.coords || card.approximate}
      <div class="grp">
        {#if card.coords}<div class="row"><span class="txt"><span class="t">Position</span></span><span class="val coords">{card.coords}</span></div>{/if}
        {#if card.approximate}<div class="row note-row">{card.approximate}</div>{/if}
      </div>
    {/if}

    <h3 class="grp-h">Use this spot in your route</h3>
    <div class="btn-row actions" data-testid="info-actions">
      {#each actions as a (a.id)}
        <button type="button" class="cap-btn" class:primary={a.primary} onclick={() => explore.use(a.id)} data-testid={`use-${a.id}`}>{a.label}</button>
      {/each}
    </div>

    {#if card.note}
      <p class="note {card.note.tone}" data-testid="info-note">{card.note.text}</p>
    {/if}
    {#if card.pisteNote}<p class="note">{card.pisteNote}</p>{/if}

    {#if card.profile}
      <ProfileChart
        result={card.profile}
        mode={card.profileMode}
        title="Elevation profile"
        showPoints={false}
        desktop={app.desktop}
        {tall}
        testid="info-profile"
        oncursor={(p) => (app.ui.profileCursor = p)}
      />
    {/if}

    {#if card.rows.length}
      <h3 class="grp-h">Details</h3>
      <div class="grp" data-testid="info-rows">
        {#each card.rows as r (r.label)}
          <div class="row value-row"><span class="txt"><span class="t">{r.label}</span></span><span class="val">{r.value}</span></div>
        {/each}
      </div>
    {/if}

    {#if card.tags.length}
      <div class="tags">
        {#each card.tags as t (t)}<span class="chip">{t}</span>{/each}
      </div>
    {/if}
    {#if card.description}<p class="desc">{card.description}</p>{/if}
    {#if card.links.length}
      <p class="links">
        Source & links:
        {#each card.links as l, i (l.href)}{#if i}{' · '}{/if}<a href={l.href} target="_blank" rel="noopener noreferrer">{l.label}</a>{/each}
      </p>
    {/if}
  </div>
{/if}

<style>
  .crumbs {
    margin: 0 4px 10px;
    font-size: var(--t-footnote);
    color: var(--label-2);
  }
  .stats {
    display: grid;
    grid-template-columns: repeat(var(--n), 1fr);
    padding: 12px 0;
  }
  .stat {
    padding: 0 8px 0 16px;
    min-width: 0;
  }
  .stat + .stat {
    border-left: 0.5px solid var(--separator);
  }
  .stat-label {
    font-size: var(--t-caption);
    font-weight: var(--fw-semibold);
    text-transform: uppercase;
    letter-spacing: 0.3px;
    color: var(--label-2);
  }
  .stat-value {
    font: var(--fw-semibold) var(--t-title2) var(--font-rounded);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .grp-h {
    margin-top: 16px;
  }
  .actions {
    margin-bottom: 4px;
  }
  .coords {
    font-variant-numeric: tabular-nums;
  }
  .note-row {
    font-size: var(--t-subhead);
    color: var(--orange);
  }
  .value-row {
    align-items: baseline;
    flex-wrap: wrap;
  }
  .value-row .val {
    text-align: right;
    margin-left: auto;
  }
  .note {
    margin: 12px 4px 8px;
    font-size: var(--t-subhead);
    line-height: 1.35;
    color: var(--label-2);
  }
  .note.steeper {
    color: var(--red);
  }
  .note.easier {
    color: var(--green);
  }
  .tags {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin: 4px 0 8px;
  }
  .chip {
    height: 26px;
    line-height: 26px;
    padding: 0 10px;
    border-radius: 13px;
    background: var(--fill-3);
    font: var(--fw-semibold) var(--t-footnote) var(--font);
  }
  .desc,
  .links {
    margin: 8px 4px;
    font-size: var(--t-footnote);
    color: var(--label-2);
    line-height: 1.38;
  }
  .links a {
    color: var(--accent);
  }
</style>
