<script lang="ts">
  // Menu › Appearance (spec §3.5): Solid interface (no see-through glass; saved), Keep screen on while planning
  // (Screen Wake Lock; only where the browser has it), units, dark mode note.
  import Switch from '../Switch.svelte';
  import type { AppState } from '../../lib/app.svelte.ts';

  let { app }: { app: AppState } = $props();
</script>

<div class="grp">
  <label class="row tappable">
    <span class="txt"><span class="t">Solid interface</span></span>
    <Switch checked={app.settings.solid} onchange={(v) => app.setSolid(v)} testid="solid-interface" />
  </label>
</div>
<p class="grp-f">Shows buttons and panels without the see-through effect. Easier to read.</p>

{#if app.wakeLock.supported}
  <div class="grp-gap"></div>
  <div class="grp">
    <label class="row tappable">
      <span class="txt"><span class="t">Keep screen on while planning</span></span>
      <Switch checked={app.settings.keepAwake} onchange={(v) => app.setKeepAwake(v)} testid="keep-awake" />
    </label>
  </div>
  <p class="grp-f">The screen does not turn off while the app is open. This uses more battery.</p>
{/if}

<div class="grp-gap"></div>
<div class="grp">
  <div class="row"><span class="txt"><span class="t">Units</span></span><span class="val">Metric</span></div>
</div>
<p class="grp-f">Dark mode follows your {app.desktop ? 'computer' : 'iPhone'} setting.</p>
