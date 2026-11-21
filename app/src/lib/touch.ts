// iOS Safari zooms the whole page on a pinch even with `touch-action: pan-x pan-y` in some cases (and always in
// older versions), through its own "gesture" events. Cancelling them keeps the page at scale 1. The map is not
// affected: MapLibre reads touch events, not gesture events.
export const PAGE_GESTURES = ['gesturestart', 'gesturechange', 'gestureend'] as const;

export function blockPageZoom(target: Pick<EventTarget, 'addEventListener' | 'removeEventListener'>): () => void {
  const cancel = (e: Event) => e.preventDefault();
  for (const t of PAGE_GESTURES) target.addEventListener(t, cancel, { passive: false } as AddEventListenerOptions);
  return () => {
    for (const t of PAGE_GESTURES) target.removeEventListener(t, cancel);
  };
}
