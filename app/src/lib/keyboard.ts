// Desktop keyboard shortcuts (spec §4.7; old planner keydown handler). Pure, unit-tested.
export type Shortcut = 'undo' | 'redo' | 'plan' | 'escape' | 'search';

interface KeyLike {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

/** Inside text fields the browser's own undo/redo and typing win. */
export function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.closest !== 'function') return false;
  return !!el.closest('input:not([type=checkbox]):not([type=radio]):not([type=range]), textarea, select, [contenteditable="true"]');
}

/** ⌘Z / Ctrl+Z undo · ⌘Y / Ctrl+Y / ⇧⌘Z / Ctrl+Shift+Z redo · ⌘K / Ctrl+K search · P plan mode · Esc. */
export function shortcutFor(e: KeyLike, typing: boolean): Shortcut | null {
  const mod = e.metaKey || e.ctrlKey;
  const key = e.key.toLowerCase();
  if (mod && !e.altKey) {
    // ⌘K also works while typing (it jumps to the search field)
    if (key === 'k' && !e.shiftKey) return 'search';
    if (typing) return null;
    if (key === 'z') return e.shiftKey ? 'redo' : 'undo';
    if (key === 'y') return 'redo';
    return null;
  }
  if (e.altKey || typing) return null;
  if (key === 'p' && !e.shiftKey) return 'plan';
  if (key === 'escape') return 'escape';
  return null;
}
