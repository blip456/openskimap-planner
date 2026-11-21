<script lang="ts">
  // First run / no data screen (spec §3.9): how to get the data ZIP onto the iPhone, and a big import button.
  import Icon from './Icon.svelte';
  import ImportProgress from './ImportProgress.svelte';
  import ImportErrorBox from './ImportErrorBox.svelte';
  import type { AppState } from '../lib/app.svelte.ts';

  let { app }: { app: AppState } = $props();
  let input: HTMLInputElement;
  const standalone = typeof matchMedia === 'function' && matchMedia('(display-mode: standalone)').matches;
  const dev = import.meta.env.DEV;

  function picked() {
    const file = input.files?.[0];
    input.value = '';
    if (file) void app.importData(file);
  }
</script>

<main class="nodata" data-testid="no-data">
  <img class="logo" src="/logo.svg" alt="" width="96" height="96" />
  <h1>Ski route planner</h1>
  <p class="lead">Plan ski routes on your iPhone, also without internet. First, add the map data. You do this once.</p>

  {#if app.importing}
    <ImportProgress progress={app.importProgress} oncancel={() => app.cancelRunningImport()} />
  {:else}
    <ol class="group steps" data-testid="first-run-steps">
      <li>
        <span class="num">1</span><span>On your computer, run <code>npm run build:pwa-data</code>. It makes a ZIP file named
          <code>openskimap-data-….zip</code>.</span>
      </li>
      <li>
        <span class="num">2</span><span>Send the ZIP file to this iPhone. With <b>AirDrop</b> it goes to Files › Downloads. You
          can also save it in <b>iCloud Drive</b>.</span>
      </li>
      <li><span class="num">3</span><span>Tap <b>Import data file</b> below and pick the ZIP file in Files. Do not unzip it.</span></li>
    </ol>
    {#if app.importError}
      <div class="error"><ImportErrorBox failure={app.importError} /></div>
    {/if}
    {#if !standalone}
      <p class="tip">Tip: add this app to your Home Screen first (Share › Add to Home Screen). The data is safer there.</p>
    {/if}
  {/if}

  <div class="buttons">
    <button type="button" class="primary" disabled={app.importing} onclick={() => input.click()} data-testid="import-button">
      <Icon name="fileDown" size={20} /> Import data file
    </button>
    {#if dev}
      <button type="button" class="secondary" disabled={app.importing} onclick={() => void app.importFromBuild()} data-testid="import-from-build">
        Load data from build/
      </button>
    {/if}
  </div>
  <input bind:this={input} type="file" accept=".zip,application/zip" hidden onchange={picked} data-testid="import-input" />
</main>

<style>
  .nodata {
    position: fixed;
    inset: 0;
    overflow-y: auto;
    background: var(--bg-grouped);
    padding: calc(var(--safe-top) + 40px) calc(20px + var(--safe-right)) calc(var(--safe-bottom) + 24px) calc(20px + var(--safe-left));
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    box-sizing: border-box;
  }
  .nodata > :global(*) {
    width: 100%;
    max-width: 440px;
  }
  .logo {
    width: 96px;
    height: 96px;
    border-radius: 22px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18);
  }
  h1 {
    font-size: var(--t-title1);
    font-weight: var(--fw-bold);
    margin: 20px 0 6px;
  }
  .lead {
    font-size: var(--t-body);
    color: var(--label-2);
    margin: 0 0 24px;
  }
  .group {
    background: var(--bg-cell);
    border-radius: var(--r-cell);
    box-sizing: border-box;
  }
  .steps {
    list-style: none;
    margin: 0;
    padding: 0;
    text-align: left;
  }
  .steps li {
    display: flex;
    gap: 12px;
    align-items: flex-start;
    padding: 12px 16px;
    font-size: var(--t-subhead);
  }
  .steps li + li {
    border-top: 0.5px solid var(--separator);
  }
  .num {
    flex: none;
    width: 24px;
    height: 24px;
    border-radius: 50%;
    background: var(--accent);
    color: var(--on-accent);
    font: 700 13px/24px var(--font-rounded);
    text-align: center;
  }
  code {
    font-family: var(--font-mono);
    font-size: 0.9em;
  }
  .error {
    margin-top: 12px;
  }
  .tip {
    font-size: var(--t-footnote);
    color: var(--label-2);
    margin: 12px 16px 0;
  }
  .buttons {
    margin-top: auto;
    padding-top: 24px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .primary,
  .secondary {
    height: 50px;
    border: 0;
    border-radius: 14px;
    font: 600 var(--t-body) var(--font);
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    cursor: pointer;
  }
  .primary {
    background: var(--accent);
    color: var(--on-accent);
  }
  .secondary {
    background: var(--fill-3);
    color: var(--accent);
  }
  button:disabled {
    opacity: 0.4;
    cursor: default;
  }
</style>
