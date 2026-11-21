<script lang="ts">
  // List row that can be swiped left to show a red Delete action (80 wide); a full swipe deletes (spec §3.3).
  // Only touch swipes; with a mouse the row has a delete button instead.
  import type { Snippet } from 'svelte';

  let {
    ondelete,
    open = $bindable(false),
    children,
    testid,
  }: { ondelete: () => void; open?: boolean; children: Snippet; testid?: string } = $props();

  const ACTION = 80;
  let width = $state(320);
  let dx = $state(0);
  let drag = $state<{ id: number; x: number; y: number; base: number; active: boolean } | null>(null);
  let swiped = false;
  /** a full swipe deletes once: the click that can follow the touch (the red action is under the finger by then)
   * must not delete again (phase 7: a second delete raced the Undo of the first) */
  let fired = false;
  function fire() {
    if (fired) return;
    fired = true;
    ondelete();
  }

  $effect(() => {
    if (!drag) dx = open ? -ACTION : 0;
  });

  function down(e: PointerEvent) {
    if (e.pointerType === 'mouse') return;
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY, base: open ? -ACTION : 0, active: false };
  }
  function move(e: PointerEvent) {
    if (!drag || e.pointerId !== drag.id) return;
    const mx = e.clientX - drag.x;
    const my = e.clientY - drag.y;
    if (!drag.active) {
      if (Math.abs(my) > 8 && Math.abs(my) > Math.abs(mx)) {
        drag = null;
        return;
      }
      if (Math.abs(mx) < 8) return;
      drag.active = true;
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    }
    e.stopPropagation();
    dx = Math.min(0, Math.max(-width, drag.base + mx));
  }
  function up(e: PointerEvent) {
    if (!drag || e.pointerId !== drag.id) return;
    const wasActive = drag.active;
    drag = null;
    if (!wasActive) return;
    e.stopPropagation();
    swiped = true;
    setTimeout(() => (swiped = false), 50);
    if (dx < -width * 0.6) {
      dx = -width;
      setTimeout(fire, 150);
    } else {
      open = dx < -ACTION / 2;
      dx = open ? -ACTION : 0;
    }
  }
</script>

<div class="swipe" bind:clientWidth={width} data-testid={testid}>
  <button type="button" class="action" style:width={`${Math.max(ACTION, -dx)}px`} onclick={() => !swiped && fire()} tabindex={open ? 0 : -1} aria-hidden={!open}>
    Delete
  </button>
  <div
    class="content"
    class:moving={!!drag}
    style:transform={`translateX(${dx}px)`}
    onpointerdown={down}
    onpointermove={move}
    onpointerup={up}
    onpointercancel={() => {
      drag = null;
      dx = open ? -ACTION : 0;
    }}
    onclickcapture={(e) => {
      if (swiped || open) {
        e.stopPropagation();
        e.preventDefault();
        if (open && !swiped) open = false;
      }
    }}
    role="presentation"
  >
    {@render children()}
  </div>
</div>

<style>
  .swipe {
    position: relative;
    overflow: hidden;
  }
  .action {
    position: absolute;
    top: 0;
    right: 0;
    bottom: 0;
    border: 0;
    background: var(--red);
    color: #fff;
    font: var(--fw-semibold) var(--t-body) var(--font);
    cursor: pointer;
  }
  .content {
    position: relative;
    background: var(--cell-bg, var(--bg-cell));
    transition: transform var(--dur-base) var(--ease-out);
    touch-action: pan-y;
  }
  .content.moving {
    transition: none;
  }
</style>
