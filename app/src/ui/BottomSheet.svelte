<script lang="ts">
  // Bottom sheet with the medium and large detents (spec §2.9, plan §8.3).
  // One element as tall as the large detent; detents are translateY offsets. Drag with pointer events: the handle
  // and header always drag; the body drags at the medium detent, and at the large detent it scrolls, with a
  // downward drag at scroll position 0 moving the sheet again (touch events, so the browser's scroll can be
  // stopped). Release picks the detent from the position projected with the finger's velocity (× 0.2 s).
  import { onMount, type Snippet } from 'svelte';
  import type { Detent } from '../lib/stores/ui.svelte.ts';
  import { chooseDetent } from './sheet-physics.ts';

  let {
    detent,
    labelledby,
    ondetent,
    onsettle,
    onclose,
    header,
    children,
    testid = 'sheet',
    scrollKey,
  }: {
    detent: Detent;
    labelledby: string;
    ondetent: (d: Detent) => void;
    /** visible top of the sheet (px) after it settled at a detent */
    onsettle?: (top: number) => void;
    onclose: () => void;
    header: Snippet;
    children: Snippet;
    testid?: string;
    /** when this changes (other tab or sub-page), the body scrolls back to the top */
    scrollKey?: string;
  } = $props();

  $effect(() => {
    void scrollKey;
    if (body) body.scrollTop = 0;
  });

  let el: HTMLDivElement;
  let body: HTMLDivElement;
  let vh = $state(typeof innerHeight === 'number' ? innerHeight : 800);
  /** top of the large detent (safe-top + 8), measured */
  let largeTop = $state(8);
  /** current translateY; null until measured */
  let offset = $state<number | null>(null);
  let dragging = $state(false);
  let closing = false;
  const reduceMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

  const mediumOffset = $derived(Math.max(0, Math.round(vh * 0.475) - largeTop));
  const closedOffset = $derived(vh - largeTop + 40);
  const detentOffset = (d: Detent) => (d === 'large' ? 0 : mediumOffset);
  const y = $derived(offset ?? closedOffset);
  /** 0 at medium (and below), 1 at large */
  const progress = $derived(mediumOffset > 0 ? Math.min(1, Math.max(0, 1 - y / mediumOffset)) : 1);
  const largeLook = $derived(progress > 0.5);

  function measure() {
    vh = innerHeight;
    largeTop = el.offsetTop; // a fixed element: from the top of the viewport, without the transform
  }

  // the controls on the map ride on the sheet (spec §2.9): they read these two variables
  $effect(() => {
    const root = document.documentElement.style;
    root.setProperty('--sheet-y', `${Math.round(largeTop + y)}px`);
    root.setProperty('--sheet-progress', progress.toFixed(3));
  });
  onMount(() => () => {
    document.documentElement.style.removeProperty('--sheet-y');
    document.documentElement.style.removeProperty('--sheet-progress');
  });

  // follow the detent from outside (tab tap, keyboard, "open route at medium")
  $effect(() => {
    const target = detentOffset(detent);
    if (!dragging && !closing) offset = target;
  });

  let settleTimer: ReturnType<typeof setTimeout> | null = null;
  $effect(() => {
    // tell the app where the sheet stands once it stops (map padding, spec §2.9: not during the drag)
    const top = Math.round(largeTop + detentOffset(detent));
    if (dragging) return;
    if (settleTimer) clearTimeout(settleTimer);
    settleTimer = setTimeout(() => onsettle?.(top), reduceMotion ? 0 : 320);
  });

  onMount(() => {
    measure();
    // open: start below the screen, then move to the detent (fade only with reduced motion)
    offset = closedOffset;
    requestAnimationFrame(() => requestAnimationFrame(() => (offset = detentOffset(detent))));
    const onResize = () => {
      measure();
      if (!dragging) offset = detentOffset(detent);
    };
    addEventListener('resize', onResize);
    body.addEventListener('touchstart', onTouchStart, { passive: true });
    body.addEventListener('touchmove', onTouchMove, { passive: false });
    body.addEventListener('touchend', onTouchEnd);
    body.addEventListener('touchcancel', onTouchEnd);
    return () => {
      removeEventListener('resize', onResize);
      if (settleTimer) clearTimeout(settleTimer);
    };
  });

  // --- drag core -------------------------------------------------------------------------------------------
  let startY = 0;
  let startOffset = 0;
  let samples: { y: number; t: number }[] = [];

  function begin(clientY: number) {
    dragging = true;
    startY = clientY;
    startOffset = offset ?? detentOffset(detent);
    samples = [{ y: clientY, t: performance.now() }];
  }

  function move(clientY: number) {
    const raw = startOffset + (clientY - startY);
    // rubber band above the large detent
    offset = raw < 0 ? -Math.sqrt(-raw) * 2 : raw;
    const t = performance.now();
    samples.push({ y: clientY, t });
    while (samples.length > 2 && t - samples[0].t > 100) samples.shift();
  }

  function end() {
    if (!dragging) return;
    const a = samples[0];
    const b = samples[samples.length - 1];
    const velocity = b && a && b.t > a.t ? (b.y - a.y) / (b.t - a.t) : 0; // px per ms
    dragging = false;
    const choice = chooseDetent(offset ?? 0, velocity, mediumOffset);
    if (choice === 'closed') close();
    else {
      offset = detentOffset(choice);
      if (choice !== detent) ondetent(choice);
    }
  }

  function close() {
    closing = true;
    offset = closedOffset;
    setTimeout(onclose, reduceMotion ? 0 : 260);
  }

  // --- pointer: handle, header, and the body below the top detent ------------------------------------------
  type Pending = { id: number; x: number; y: number; fromBody: boolean } | null;
  let pending: Pending = null;
  const NO_DRAG = 'input, textarea, select, [data-no-sheet-drag]';

  function onPointerDown(e: PointerEvent) {
    if (e.button !== 0 || (e.target as Element).closest(NO_DRAG)) return;
    const fromBody = body.contains(e.target as Node);
    // at the large detent the body scrolls: touch is handled by the touch handlers, a mouse only drags the header
    if (fromBody && detent === 'large') return;
    pending = { id: e.pointerId, x: e.clientX, y: e.clientY, fromBody };
  }

  function onPointerMove(e: PointerEvent) {
    if (pending && e.pointerId === pending.id && !dragging) {
      const dx = e.clientX - pending.x;
      const dy = e.clientY - pending.y;
      if (Math.abs(dy) < 8 && Math.abs(dx) < 8) return;
      if (Math.abs(dx) > Math.abs(dy)) {
        pending = null; // horizontal: chips scroll, chart scrubs
        return;
      }
      el.setPointerCapture(e.pointerId);
      begin(pending.y);
    }
    if (dragging && pending && e.pointerId === pending.id) move(e.clientY);
  }

  function onPointerUp(e: PointerEvent) {
    if (!pending || e.pointerId !== pending.id) return;
    pending = null;
    end();
  }

  // --- touch handoff at the large detent ---------------------------------------------------------------------
  let touch: { x: number; y: number; handoff: boolean | null } | null = null;

  function onTouchStart(e: TouchEvent) {
    if (detent !== 'large' || e.touches.length !== 1 || (e.target as Element).closest(NO_DRAG)) {
      touch = null;
      return;
    }
    touch = { x: e.touches[0].clientX, y: e.touches[0].clientY, handoff: null };
  }

  function onTouchMove(e: TouchEvent) {
    if (!touch) return;
    const t = e.touches[0];
    const dx = t.clientX - touch.x;
    const dy = t.clientY - touch.y;
    if (touch.handoff === null) {
      if (Math.abs(dy) < 8 && Math.abs(dx) < 8) return;
      touch.handoff = Math.abs(dy) > Math.abs(dx) && dy > 0 && body.scrollTop <= 0;
      if (touch.handoff) begin(t.clientY);
    }
    if (touch.handoff) {
      e.preventDefault(); // the sheet moves instead of the content
      move(t.clientY);
    }
  }

  function onTouchEnd() {
    if (touch?.handoff) end();
    touch = null;
  }

  // --- keyboard on the handle --------------------------------------------------------------------------------
  function onHandleKey(e: KeyboardEvent) {
    if (e.key === 'ArrowUp' || ((e.key === 'Enter' || e.key === ' ') && detent === 'medium')) {
      e.preventDefault();
      ondetent('large');
    } else if (e.key === 'ArrowDown' || ((e.key === 'Enter' || e.key === ' ') && detent === 'large')) {
      e.preventDefault();
      if (e.key === 'ArrowDown' && detent === 'medium') close();
      else ondetent('medium');
    }
  }
</script>

<div
  bind:this={el}
  id="sheet"
  class="sheet"
  class:large-look={largeLook}
  class:dragging
  class:fade={reduceMotion}
  role="dialog"
  aria-modal="false"
  tabindex="-1"
  aria-labelledby={labelledby}
  data-testid={testid}
  data-detent={detent}
  style:transform={`translate3d(0, ${y}px, 0)`}
  style:--medium-offset={`${mediumOffset}px`}
  style:--progress={progress}
  style:opacity={reduceMotion && offset === closedOffset ? 0 : undefined}
  onpointerdown={onPointerDown}
  onpointermove={onPointerMove}
  onpointerup={onPointerUp}
  onpointercancel={onPointerUp}
>
  <div class="surface glass-strong" aria-hidden="true"></div>
  <div class="surface solid" aria-hidden="true"></div>
  <button
    type="button"
    class="handle"
    aria-label={detent === 'large' ? 'Make the panel smaller' : 'Make the panel bigger'}
    onkeydown={onHandleKey}
    onclick={() => ondetent(detent === 'large' ? 'medium' : 'large')}
    data-testid="sheet-handle"
  >
    <span></span>
  </button>
  <header class="head">{@render header()}</header>
  <div class="body" bind:this={body} data-testid="sheet-body">
    {@render children()}
  </div>
</div>

<style>
  .sheet {
    --hidden-bottom: calc(var(--medium-offset) + var(--tabbar-bottom) + var(--tabbar-h) + 8px);
    position: fixed;
    z-index: var(--z-sheet);
    top: calc(var(--safe-top) + 8px);
    bottom: 0;
    left: calc(8px + var(--safe-left));
    right: calc(8px + var(--safe-right));
    margin: 0 auto;
    max-width: 560px;
    display: flex;
    flex-direction: column;
    /* medium: ends 8 px above the tab bar, bottom corners 32 (the part below is clipped, not laid out) */
    clip-path: inset(0 0 var(--hidden-bottom) 0 round var(--r-sheet) var(--r-sheet) 32px 32px);
    transition: transform var(--dur-sheet) var(--spring-sheet);
    will-change: auto;
    touch-action: none;
  }
  .sheet.dragging {
    transition: none;
    will-change: transform;
  }
  .sheet.fade {
    transition: opacity 200ms linear;
  }
  /* large: edge to edge, solid, bottom to the screen edge; the tab bar floats over it */
  .sheet.large-look {
    left: 0;
    right: 0;
    clip-path: inset(0 0 0 0 round var(--r-sheet) var(--r-sheet) 0 0);
  }
  .surface {
    position: absolute;
    inset: 0;
    pointer-events: none;
    border-radius: var(--r-sheet) var(--r-sheet) 0 0;
    transition: opacity var(--dur-fast);
  }
  .glass-strong {
    background: var(--glass-fill-strong);
    backdrop-filter: var(--glass-filter);
    -webkit-backdrop-filter: var(--glass-filter);
    box-shadow: var(--glass-rim);
  }
  .solid {
    background: var(--bg-grouped);
    opacity: 0;
  }
  .large-look .glass-strong {
    opacity: 0;
  }
  .large-look .solid {
    opacity: 1;
  }
  .handle {
    position: relative;
    flex: none;
    height: 20px;
    margin: 0;
    padding: 6px 0 0;
    border: 0;
    background: none;
    display: flex;
    justify-content: center;
    align-items: flex-start;
    cursor: grab;
  }
  .handle::before {
    /* hit area 44 high, full width */
    content: '';
    position: absolute;
    inset: -4px 0 -20px;
  }
  .handle span {
    width: var(--sheet-handle-w);
    height: var(--sheet-handle-h);
    border-radius: 3px;
    background: var(--label-3);
  }
  .handle:focus-visible span {
    outline: 3px solid var(--focus-ring);
    outline-offset: 3px;
  }
  .head {
    position: relative;
    flex: none;
  }
  .body {
    position: relative;
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: 4px 16px calc(var(--hidden-bottom) + 16px);
    /* medium: every touch drag moves the sheet (cells stay solid-looking on the glass) */
    touch-action: none;
    --cell-bg: color-mix(in srgb, var(--bg-cell) 72%, transparent);
  }
  .large-look .body {
    --bar-space: calc(var(--tabbar-bottom) + var(--tabbar-h));
    touch-action: pan-y;
    /* the last content can scroll clear of the floating tab bar (tab bar height + its distance from the bottom) */
    padding-bottom: calc(var(--bar-space) + 24px);
    --cell-bg: var(--bg-cell);
    /* scroll-edge fade only under the tab bar, not over the content above it */
    mask-image: linear-gradient(to bottom, #000 calc(100% - var(--bar-space) - 12px), transparent calc(100% - var(--bar-space) / 2));
    -webkit-mask-image: linear-gradient(to bottom, #000 calc(100% - var(--bar-space) - 12px), transparent calc(100% - var(--bar-space) / 2));
  }
  @media (min-width: 900px) {
    .sheet.large-look {
      left: calc(8px + var(--safe-left));
      right: calc(8px + var(--safe-right));
    }
  }
</style>
