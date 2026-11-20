<script lang="ts">
  // Development overlay (dev builds only; loaded with a dynamic import that production builds drop).
  // Simulated iPhone safe areas, online/offline switch, fake GPS position + heading (used in phase 6).
  import Icon from './Icon.svelte';
  import type { AppState } from '../lib/app.svelte.ts';
  import { DevState } from '../lib/stores/dev.svelte.ts';

  let { app }: { app: AppState } = $props();
  const dev = new DevState();
  let open = $state(false);
  let position = $state('47.4044, 10.2777');
  let heading = $state('');
  let message = $state<string | null>(null);

  $effect(() => {
    const style = dev.safeAreaStyle();
    const root = document.documentElement;
    for (const k of ['--safe-top', '--safe-right', '--safe-bottom', '--safe-left']) root.style.removeProperty(k);
    for (const [k, v] of Object.entries(style)) root.style.setProperty(k, v);
    root.toggleAttribute('data-dev-safe-area', dev.safeArea);
  });

  function setPosition() {
    message = dev.setFakePosition(position, heading) ?? 'Fake position set (used from phase 6)';
  }
</script>

<div class="dev" data-testid="dev-overlay">
  <button type="button" class="toggle" aria-expanded={open} aria-label="Developer tools" onclick={() => (open = !open)}>
    <Icon name="wrench" size={16} />
  </button>
  {#if open}
    <div class="panel">
      <strong>Dev tools</strong>
      <label><input type="checkbox" bind:checked={dev.safeArea} /> iPhone safe areas (59 / 34 px)</label>
      <label><input type="checkbox" checked={app.settings.online} onchange={(e) => app.settings.setOnline(e.currentTarget.checked)} /> Online mode</label>
      <fieldset>
        <legend>Fake GPS</legend>
        <input type="text" bind:value={position} aria-label="Latitude, longitude" />
        <input type="number" bind:value={heading} placeholder="Heading °" aria-label="Heading" min="0" max="359" />
        <button type="button" onclick={setPosition}>Set</button>
        {#if dev.fakePosition}<button type="button" onclick={() => (dev.fakePosition = null)}>Clear</button>{/if}
      </fieldset>
      {#if message}<small>{message}</small>{/if}
      {#if app.caps.importData}
        <button type="button" onclick={() => void app.importFromBuild()} disabled={app.importing}>Load data from build/</button>
      {/if}
      {#if app.loadInfo}<small>Routing worker ready in {app.loadInfo.timings.totalMs} ms</small>{/if}
    </div>
  {/if}
</div>

<style>
  .dev {
    position: fixed;
    z-index: var(--z-dev);
    left: calc(4px + var(--safe-left));
    top: 45%;
    font: 12px/1.3 var(--font);
    color: #fff;
  }
  .toggle {
    width: 28px;
    height: 28px;
    border-radius: 8px;
    border: 0;
    background: rgba(255, 90, 0, 0.85);
    color: #fff;
    display: grid;
    place-items: center;
    cursor: pointer;
  }
  .panel {
    margin-top: 4px;
    width: 220px;
    padding: 10px;
    border-radius: 10px;
    background: rgba(20, 20, 24, 0.92);
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  fieldset {
    border: 1px solid rgba(255, 255, 255, 0.25);
    border-radius: 6px;
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    padding: 6px;
  }
  input[type='text'],
  input[type='number'] {
    width: 100%;
    font: inherit;
  }
  small {
    color: rgba(255, 255, 255, 0.7);
  }
</style>
