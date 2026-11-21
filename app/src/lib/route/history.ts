// Undo / redo of route points and route settings (old planner: recordHistory / restoreSnapshot / undo / redo).
// A snapshot is a JSON string of { points, options }; equal snapshots are not recorded twice.

export const MAX_HISTORY = 50;

export interface HistoryData {
  past: string[];
  future: string[];
}

const isSnap = (s: unknown): s is string => typeof s === 'string' && s.startsWith('{');

export class History {
  past: string[] = [];
  future: string[] = [];
  current: string;
  private readonly max: number;

  constructor(current: string, stored?: unknown, max = MAX_HISTORY) {
    this.current = current;
    this.max = max;
    const s = stored as Partial<HistoryData> | null | undefined;
    if (s && Array.isArray(s.past) && Array.isArray(s.future)) {
      this.past = s.past.filter(isSnap).slice(-max);
      this.future = s.future.filter(isSnap).slice(-max);
    }
  }

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }

  /** Records a new state. Returns false when nothing changed. A new state clears the redo list. */
  record(snap: string): boolean {
    if (snap === this.current) return false;
    this.past.push(this.current);
    if (this.past.length > this.max) this.past.splice(0, this.past.length - this.max);
    this.current = snap;
    this.future = [];
    return true;
  }

  /** Steps back; returns the snapshot to restore, or null. */
  undo(): string | null {
    const prev = this.past.pop();
    if (prev === undefined) return null;
    this.future.push(this.current);
    this.current = prev;
    return prev;
  }

  redo(): string | null {
    const next = this.future.pop();
    if (next === undefined) return null;
    this.past.push(this.current);
    if (this.past.length > this.max) this.past.shift();
    this.current = next;
    return next;
  }

  /** Replaces the current state without a history step (e.g. opening a saved route resets nothing). */
  reset(current: string): void {
    this.current = current;
  }

  toJSON(): HistoryData {
    return { past: this.past.slice(-this.max), future: this.future.slice(-this.max) };
  }
}
