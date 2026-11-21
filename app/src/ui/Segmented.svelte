<script lang="ts" generics="T extends string">
  // Segmented control (spec §2.12): radiogroup with a sliding selected thumb. `value` may be null (none selected,
  // e.g. custom speeds that match no preset).
  let {
    options,
    value,
    onchange,
    label,
    compact = false,
    testid,
  }: {
    options: { value: T; label: string; title?: string; testid?: string }[];
    value: T | null;
    onchange: (v: T) => void;
    label: string;
    compact?: boolean;
    testid?: string;
  } = $props();
  const index = $derived(options.findIndex((o) => o.value === value));
</script>

<div class="seg" class:compact role="radiogroup" aria-label={label} data-testid={testid} style:--n={options.length}>
  {#if index >= 0}<span class="thumb" style:transform={`translateX(${index * 100}%)`} aria-hidden="true"></span>{/if}
  {#each options as o (o.value)}
    <button
      type="button"
      role="radio"
      aria-checked={o.value === value}
      class:on={o.value === value}
      title={o.title}
      onclick={() => onchange(o.value)}
      data-value={o.value}
      data-testid={o.testid}>{o.label}</button
    >
  {/each}
</div>

<style>
  .seg {
    position: relative;
    display: grid;
    grid-template-columns: repeat(var(--n), 1fr);
    background: var(--fill-2);
    border-radius: 9px;
    padding: 2px;
    height: 32px;
    box-sizing: border-box;
    min-width: 0;
  }
  .seg.compact {
    height: 28px;
  }
  .thumb {
    position: absolute;
    top: 2px;
    bottom: 2px;
    left: 2px;
    width: calc((100% - 4px) / var(--n));
    border-radius: 7px;
    background: var(--bg-elevated);
    box-shadow: 0 3px 8px rgba(0, 0, 0, 0.12), 0 3px 1px rgba(0, 0, 0, 0.04);
    transition: transform var(--dur-press) var(--spring-press);
  }
  button {
    position: relative;
    border: 0;
    background: none;
    color: var(--label);
    font: var(--fw-medium) 13px var(--font);
    padding: 0 8px;
    border-radius: 7px;
    cursor: pointer;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .compact button {
    font-size: 12px;
  }
  button.on {
    font-weight: var(--fw-semibold);
  }
  @media (prefers-color-scheme: dark) {
    .thumb {
      background: #636366;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .thumb {
      transition: none;
    }
  }
</style>
