<script lang="ts">
  // A failed import (no-data screen and Menu › Data): a clear title for the kind of problem, the message from the
  // import, and what to do next.
  import Icon from './Icon.svelte';
  import { importFailureTitle, type ImportFailure } from '../lib/data/storage-info.ts';

  let { failure }: { failure: ImportFailure } = $props();

  const HINTS: Record<ImportFailure['code'], string> = {
    'not-data': 'Pick the ZIP file made by npm run build:pwa-data. Its name starts with "openskimap-data-". Do not unzip it or zip it again.',
    damaged: 'Copy the file to the iPhone again. If it still fails, build it again on your computer.',
    'no-space': 'Your current data was not changed.',
    other: 'Your current data was not changed.',
  };
</script>

<div class="box" role="alert" data-testid="import-error" data-code={failure.code}>
  <span class="icon"><Icon name="triangleAlert" size={22} /></span>
  <div class="txt">
    <strong data-testid="import-error-title">{importFailureTitle(failure.code)}</strong>
    <span>{failure.message}</span>
    <span class="hint">{HINTS[failure.code]}</span>
  </div>
</div>

<style>
  .box {
    display: flex;
    gap: 12px;
    align-items: flex-start;
    padding: 12px 16px;
    background: var(--bg-cell);
    border-radius: var(--r-cell);
    text-align: left;
    font-size: var(--t-subhead);
    color: var(--label);
    box-sizing: border-box;
  }
  .icon {
    color: var(--red);
    display: grid;
    padding-top: 1px;
  }
  .txt {
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-width: 0;
    overflow-wrap: anywhere;
  }
  strong {
    font-size: var(--t-body);
    font-weight: var(--fw-semibold);
  }
  .hint {
    color: var(--label-2);
    font-size: var(--t-footnote);
  }
</style>
