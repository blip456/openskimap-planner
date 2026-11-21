<script lang="ts">
  // Menu › Appearance (spec §3.5): Solid interface (no see-through glass; saved), units, dark mode note.
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

<div class="grp-gap"></div>
<div class="grp">
  <div class="row"><span class="txt"><span class="t">Units</span></span><span class="val">Metric</span></div>
</div>
<p class="grp-f">Dark mode follows your {app.desktop ? 'computer' : 'iPhone'} setting.</p>
