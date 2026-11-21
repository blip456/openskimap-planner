<script lang="ts">
  // "Speed per run colour" sub-page: one km/h field per run colour, ski paths and walking (old planner SPEED_FIELDS).
  import Segmented from '../Segmented.svelte';
  import type { RouteState } from '../../lib/stores/route.svelte.ts';
  import { PRESETS, SPEED_FIELDS, SPEED_PRESETS, activePreset, type SpeedPreset } from '../../lib/route/options.ts';

  let { route }: { route: RouteState } = $props();
  const speeds = $derived(route.options.speeds);

  function set(key: string, input: HTMLInputElement) {
    const v = Math.min(100, Math.max(1, Number(input.value) || speeds[key]));
    input.value = String(v);
    if (v !== speeds[key]) route.setOptions({ speeds: { ...speeds, [key]: v } });
  }
</script>

<div data-testid="speed-settings">
  <div class="grp">
    <div class="row">
      <div class="preset">
        <Segmented
          label="Speed preset"
          value={activePreset(speeds)}
          options={PRESETS.map((p) => ({ value: p.key, label: p.label }))}
          onchange={(p: SpeedPreset) => route.setOptions({ speeds: { ...SPEED_PRESETS[p] } })}
        />
      </div>
    </div>
  </div>
  <div class="grp-gap small"></div>
  <div class="grp">
    {#each SPEED_FIELDS as f (f.key)}
      <label class="row field">
        <i class="swatch" style:background={f.color}></i>
        <span class="txt"><span class="t">{f.label}</span></span>
        <input
          type="number"
          inputmode="decimal"
          min="1"
          max="100"
          step="1"
          value={speeds[f.key]}
          onchange={(e) => set(f.key, e.currentTarget)}
          aria-label={`${f.label}, km/h`}
          data-testid={`speed-${f.key}`}
        />
        <span class="unit">km/h</span>
      </label>
    {/each}
  </div>
  <p class="grp-f">Your average speed in km/h, with short stops.</p>
</div>

<style>
  .grp-gap.small {
    height: 8px;
  }
  .preset {
    flex: 1;
  }
  .field {
    --sep-inset: 40px;
  }
  input {
    width: 64px;
    height: 32px;
    border: 0;
    border-radius: var(--r-sm);
    background: var(--fill-3);
    color: var(--label);
    font: 17px var(--font);
    font-variant-numeric: tabular-nums;
    text-align: right;
    padding: 0 8px;
    box-sizing: border-box;
  }
  .unit {
    color: var(--label-2);
    font-size: var(--t-subhead);
    width: 38px;
  }
</style>
