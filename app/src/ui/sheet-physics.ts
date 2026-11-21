// Detent choice after a sheet drag (spec §1.8, §2.9): the sheet keeps the finger's velocity; the detent nearest to
// the projected end position (offset + velocity × 0.2 s) wins; more than 80 px below medium closes the sheet.
import type { Detent } from '../lib/stores/ui.svelte.ts';

export const PROJECTION_MS = 200;
export const CLOSE_BELOW = 80;

/** offset: translateY from the large detent (px); velocity: px per ms (positive = down). */
export function chooseDetent(offset: number, velocity: number, mediumOffset: number): Detent | 'closed' {
  const projected = offset + velocity * PROJECTION_MS;
  if (projected > mediumOffset + CLOSE_BELOW) return 'closed';
  return Math.abs(projected) < Math.abs(projected - mediumOffset) ? 'large' : 'medium';
}
