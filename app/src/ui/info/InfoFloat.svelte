<script lang="ts">
  // Desktop info card (spec §2.26): floating card at the top right of the map, glass header, solid body.
  import InfoHeader from './InfoHeader.svelte';
  import InfoBody from './InfoBody.svelte';
  import type { AppState } from '../../lib/app.svelte.ts';

  /** `column`: width of the map button column on the right (36 desktop with a mouse, 48 touch) */
  let { app, onclose, column = 48 }: { app: AppState; onclose: () => void; column?: number } = $props();
</script>

{#if app.explore.card}
  <div class="float" style:--column={`${column}px`} role="dialog" aria-modal="false" aria-labelledby="info-title" data-testid="info-float">
    <header class="glass head"><InfoHeader card={app.explore.card} {onclose} titleId="info-title" /></header>
    <div class="body"><InfoBody {app} tall /></div>
  </div>
{/if}

<style>
  .float {
    position: fixed;
    z-index: var(--z-sheet);
    top: 72px;
    right: calc(12px + var(--column) + 12px + var(--safe-right));
    width: 340px;
    max-height: 60vh;
    display: flex;
    flex-direction: column;
    border-radius: var(--r-card);
    overflow: hidden;
    background: var(--bg-grouped);
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.18), 0 1px 3px rgba(0, 0, 0, 0.08);
    color: var(--label);
    --r-cell: 12px;
    animation: pop var(--dur-base) var(--ease-out);
  }
  .head {
    flex: none;
    padding-top: 6px;
    border-radius: var(--r-card) var(--r-card) 0 0;
    box-shadow: 0 0.5px 0 var(--separator);
    color: var(--label);
  }
  .body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: 8px 12px 16px;
  }
  @keyframes pop {
    from {
      opacity: 0;
      transform: translateY(-6px);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .float {
      animation: none;
    }
  }
</style>
