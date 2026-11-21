<script lang="ts">
  // Route settings sub-page (spec §3.2): Runs, No route found?, Lifts, Speed, Advanced. Same option keys and
  // defaults as the core (DEFAULT_OPTIONS, SPEED_PRESETS) and the old planner. Every change is undoable.
  import Icon from '../Icon.svelte';
  import Switch from '../Switch.svelte';
  import Segmented from '../Segmented.svelte';
  import type { RouteState } from '../../lib/stores/route.svelte.ts';
  import {
    DIFFICULTY_CHOICES,
    LIFT_CHOICES,
    LIFT_DOWN_CHOICES,
    LIFT_WAIT_MAX_MIN,
    LINK_DISTANCE_MAX,
    PRESETS,
    SPEED_PRESETS,
    activePreset,
    toggleIn,
    type SpeedPreset,
  } from '../../lib/route/options.ts';

  let { route, onspeeds }: { route: RouteState; onspeeds: () => void } = $props();

  const o = $derived(route.options);
  const preset = $derived(activePreset(o.speeds));
  const waitMin = $derived(Math.round(o.liftWait / 60));
  const allDiff = DIFFICULTY_CHOICES.map((c) => c.key);
  const allLifts = LIFT_CHOICES.map((c) => c.key);
  const allDown = LIFT_DOWN_CHOICES.map((c) => c.key);
  let linkDraft = $state<number | null>(null);
</script>

<div class="settings" data-testid="route-settings">
  <h3 class="grp-h">Runs</h3>
  <div class="grp">
    <div class="checks" role="group" aria-label="Runs you are allowed to ski">
      {#each DIFFICULTY_CHOICES as d (d.key)}
        <label class="check">
          <input
            type="checkbox"
            checked={o.difficulties.includes(d.key)}
            onchange={(e) => route.setOptions({ difficulties: toggleIn(o.difficulties, d.key, e.currentTarget.checked, allDiff) })}
            data-testid={`difficulty-${d.key}`}
          />
          <span class="box" aria-hidden="true"><Icon name="check" size={14} strokeWidth={3} /></span>
          <i class="swatch" style:background={d.color}></i>
          <span>{d.label}</span>
        </label>
      {/each}
    </div>
  </div>
  <p class="grp-f">Runs you are allowed to ski.</p>
  <div class="grp-gap"></div>
  <div class="grp">
    <label class="row tappable">
      <span class="txt"><span class="t">Prefer easier runs</span></span>
      <Switch checked={o.preferEasier} onchange={(v) => route.setOptions({ preferEasier: v })} />
    </label>
    <label class="row tappable">
      <span class="txt"><span class="t">Use ski paths</span></span>
      <Switch checked={o.includeConnections} onchange={(v) => route.setOptions({ includeConnections: v })} />
    </label>
  </div>

  <div class="grp-gap"></div>
  <h3 class="grp-h">No route found?</h3>
  <div class="grp" role="radiogroup" aria-label="No route found?">
    {#each [{ v: 'fallback', t: 'Use harder runs (with a warning)' }, { v: 'never', t: 'Show no route' }] as const as c (c.v)}
      <button
        type="button"
        class="row"
        role="radio"
        aria-checked={o.harderRuns === c.v}
        onclick={() => route.setOptions({ harderRuns: c.v })}
        data-testid={`harder-${c.v}`}
      >
        <span class="txt"><span class="t">{c.t}</span></span>
        {#if o.harderRuns === c.v}<span class="chk"><Icon name="check" size={20} strokeWidth={2.6} /></span>{/if}
      </button>
    {/each}
  </div>

  <div class="grp-gap"></div>
  <h3 class="grp-h">Lifts</h3>
  <div class="grp">
    {#each LIFT_CHOICES as l (l.key)}
      <label class="row tappable">
        <span class="txt"><span class="t">{l.label}</span></span>
        <Switch checked={o.liftGroups.includes(l.key)} onchange={(v) => route.setOptions({ liftGroups: toggleIn(o.liftGroups, l.key, v, allLifts) })} />
      </label>
    {/each}
  </div>
  <div class="grp-gap small"></div>
  <div class="grp">
    <label class="row tappable" title="T-bar, button lift, rope tow">
      <span class="txt"><span class="t">Avoid drag lifts</span></span>
      <Switch checked={o.avoidDragLifts} onchange={(v) => route.setOptions({ avoidDragLifts: v })} />
    </label>
    <label class="row tappable">
      <span class="txt"><span class="t">Ride lifts down</span></span>
      <Switch checked={o.liftDown} onchange={(v) => route.setOptions({ liftDown: v })} testid="lift-down" />
    </label>
    {#if o.liftDown}
      {#each LIFT_DOWN_CHOICES as l (l.key)}
        <label class="row tappable indent">
          <span class="txt"><span class="t">{l.label}</span></span>
          <Switch
            checked={o.liftDownGroups.includes(l.key)}
            onchange={(v) => route.setOptions({ liftDownGroups: toggleIn(o.liftDownGroups, l.key, v, allDown) })}
          />
        </label>
      {/each}
    {/if}
    <div class="row">
      <span class="txt"><span class="t">Waiting time per lift</span></span>
      <span class="val" data-testid="lift-wait">{waitMin} min</span>
      <span class="stepper">
        <button
          type="button"
          aria-label="Less waiting time"
          disabled={waitMin <= 0}
          onclick={() => route.setOptions({ liftWait: Math.max(0, waitMin - 1) * 60 })}><Icon name="minus" size={17} /></button
        >
        <span class="divider"></span>
        <button
          type="button"
          aria-label="More waiting time"
          disabled={waitMin >= LIFT_WAIT_MAX_MIN}
          onclick={() => route.setOptions({ liftWait: Math.min(LIFT_WAIT_MAX_MIN, waitMin + 1) * 60 })}><Icon name="plus" size={17} /></button
        >
      </span>
    </div>
  </div>

  <div class="grp-gap"></div>
  <h3 class="grp-h">Speed</h3>
  <div class="grp">
    <div class="row">
      <div class="preset">
        <Segmented
          label="Speed preset"
          value={preset}
          options={PRESETS.map((p) => ({ value: p.key, label: p.label, title: `Fill in typical ${p.label.toLowerCase()} speeds` }))}
          onchange={(p: SpeedPreset) => route.setOptions({ speeds: { ...SPEED_PRESETS[p] } })}
          testid="speed-preset"
        />
      </div>
    </div>
    <button type="button" class="row" onclick={onspeeds} data-testid="open-speeds">
      <span class="txt"><span class="t">Speed per run colour</span></span>
      <span class="val">{preset ? PRESETS.find((p) => p.key === preset)?.label : 'Custom'}</span>
      <span class="chev"><Icon name="chevronRight" size={14} strokeWidth={3} /></span>
    </button>
  </div>
  <p class="grp-f">Your average speed with short stops. Used for times and for choosing between runs.</p>

  <div class="grp-gap"></div>
  <h3 class="grp-h">Advanced</h3>
  <div class="grp">
    <div class="row slider-row">
      <span class="txt"><span class="t">Max walk between runs and lifts</span></span>
      <span class="val" data-testid="link-distance">{linkDraft ?? o.linkDistance} m</span>
      <input
        type="range"
        min="0"
        max={LINK_DISTANCE_MAX}
        step="5"
        value={o.linkDistance}
        aria-label="Max walk between runs and lifts, metres"
        oninput={(e) => (linkDraft = Number(e.currentTarget.value))}
        onchange={(e) => {
          linkDraft = null;
          route.setOptions({ linkDistance: Number(e.currentTarget.value) });
        }}
      />
    </div>
  </div>
  <p class="grp-f">In the map data, runs and lifts do not always touch. The route may walk this far to connect them.</p>
</div>

<style>
  .checks {
    display: grid;
    grid-template-columns: 1fr 1fr;
    padding: 6px 8px;
  }
  .check {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 44px;
    padding: 0 8px;
    cursor: pointer;
    font-size: var(--t-body);
    border-radius: 12px;
  }
  .check input {
    position: absolute;
    opacity: 0;
    width: 1px;
    height: 1px;
  }
  .box {
    flex: none;
    width: 22px;
    height: 22px;
    border-radius: 6px;
    border: 1.5px solid var(--label-3);
    box-sizing: border-box;
    display: grid;
    place-items: center;
    color: transparent;
  }
  .check input:checked + .box {
    background: var(--accent-fill);
    border-color: var(--accent);
    color: #fff;
  }
  .check input:focus-visible + .box {
    outline: 3px solid var(--focus-ring);
    outline-offset: 2px;
  }
  .grp-gap.small {
    height: 8px;
  }
  .indent {
    padding-left: 32px;
    --sep-inset: 32px;
  }
  .stepper {
    flex: none;
    display: flex;
    align-items: center;
    background: var(--fill-2);
    border-radius: 9px;
    height: 32px;
  }
  .stepper button {
    position: relative;
    width: 46px;
    height: 32px;
    border: 0;
    background: none;
    color: var(--label);
    display: grid;
    place-items: center;
    cursor: pointer;
  }
  .stepper button::before {
    content: '';
    position: absolute;
    inset: -6px 0;
  }
  .stepper button:disabled {
    color: var(--label-3);
    cursor: default;
  }
  .stepper .divider {
    width: 1px;
    height: 18px;
    background: var(--separator);
  }
  .preset {
    flex: 1;
  }
  .slider-row {
    flex-wrap: wrap;
  }
  .slider-row input {
    flex: 1 1 100%;
    accent-color: var(--accent);
    margin: 4px 0;
    touch-action: pan-x;
  }
</style>
