<script lang="ts">
  // Import progress group (spec §2.21).
  import type { ImportProgress } from '../lib/data/import/pipeline.ts';
  import { formatMB } from '../lib/format.ts';

  let { progress, oncancel }: { progress: ImportProgress | null; oncancel: () => void } = $props();

  const pct = $derived(progress && progress.bytesTotal ? Math.floor((progress.bytesDone / progress.bytesTotal) * 100) : 0);
  const detail = $derived.by(() => {
    if (!progress || progress.phase === 'checking') return 'Checking the file…';
    if (progress.phase === 'finishing') return 'Finishing…';
    const name = progress.file?.split('/').pop() ?? '';
    return `Copying ${name} · ${formatMB(progress.bytesDone)} of ${formatMB(progress.bytesTotal)}`;
  });
</script>

<div class="group" data-testid="import-progress">
  <div class="head">
    <span class="title">Importing data…</span>
    <span class="pct">{pct}%</span>
  </div>
  <div class="detail">{detail}</div>
  <div class="track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="Import progress">
    <div class="bar" style:transform={`scaleX(${pct / 100})`}></div>
  </div>
  <button type="button" class="cancel" onclick={oncancel}>Cancel import</button>
</div>
<p class="footer">Keep the app open until the import is done. Your current data stays until the new data is ready.</p>

<style>
  .group {
    background: var(--bg-cell);
    border-radius: var(--r-cell);
    padding: 14px 16px 0;
    text-align: left;
  }
  .head {
    display: flex;
    justify-content: space-between;
    font-weight: var(--fw-semibold);
  }
  .pct {
    color: var(--label-2);
    font-weight: var(--fw-regular);
    font-variant-numeric: tabular-nums;
  }
  .detail {
    font-size: var(--t-footnote);
    color: var(--label-2);
    margin: 2px 0 10px;
    font-variant-numeric: tabular-nums;
  }
  .track {
    height: 6px;
    border-radius: 3px;
    background: var(--fill-1);
    overflow: hidden;
  }
  .bar {
    height: 100%;
    background: var(--accent);
    transform-origin: left;
    transition: transform var(--dur-fast) linear;
  }
  .cancel {
    display: block;
    width: calc(100% + 32px);
    margin: 12px -16px 0;
    min-height: 44px;
    border: 0;
    border-top: 0.5px solid var(--separator);
    background: none;
    color: var(--red);
    font: inherit;
    text-align: left;
    padding: 0 16px;
    cursor: pointer;
  }
  .footer {
    font-size: var(--t-footnote);
    color: var(--label-2);
    margin: 7px 16px 0;
    text-align: left;
  }
</style>
