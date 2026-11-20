// Route points, plan mode and the routing result. The router is injected (the worker client in the app, a fake in
// tests). Requests are debounced and only the newest answer is used.
import type { RouteOptionsInput } from '@core/routing/index.ts';
import type { RouteResponse } from '../worker/engine.ts';

export type LngLat = [number, number];
export type Router = (points: LngLat[], options: RouteOptionsInput) => Promise<RouteResponse>;

export const MAX_POINTS = 25;

/** A, B, …, Z, AA, AB, … (same as the current planner) */
export function pointLetter(i: number): string {
  return i < 26 ? String.fromCharCode(65 + i) : `${String.fromCharCode(64 + Math.floor(i / 26))}${String.fromCharCode(65 + (i % 26))}`;
}

export type PointRole = 'start' | 'stop' | 'end';
export function pointRole(i: number, n: number): PointRole {
  if (i === 0) return 'start';
  if (i === n - 1 && n > 1) return 'end';
  return 'stop';
}

export class RouteState {
  points = $state<LngLat[]>([]);
  planMode = $state(false);
  result = $state.raw<RouteResponse | null>(null);
  error = $state<string | null>(null);
  busy = $state(false);
  options = $state.raw<RouteOptionsInput>({});

  private router: Router | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private requestId = 0;
  private readonly delay: number;

  constructor(options: { delay?: number } = {}) {
    this.delay = options.delay ?? 120;
  }

  setRouter(router: Router | null): void {
    this.router = router;
    this.schedule();
  }

  togglePlanMode(on = !this.planMode): void {
    this.planMode = on;
  }

  /** Map tap: adds a point at the end, only in plan mode. Returns true when a point was added. */
  tap(p: LngLat): boolean {
    if (!this.planMode) return false;
    return this.addPoint(p);
  }

  addPoint(p: LngLat): boolean {
    if (this.points.length >= MAX_POINTS) {
      this.error = `A route can have at most ${MAX_POINTS} points.`;
      return false;
    }
    this.points = [...this.points, [p[0], p[1]]];
    this.schedule();
    return true;
  }

  movePoint(i: number, p: LngLat): void {
    this.points = this.points.map((q, j) => (j === i ? [p[0], p[1]] : q));
    this.schedule();
  }

  removePoint(i: number): void {
    this.points = this.points.filter((_, j) => j !== i);
    this.schedule();
  }

  clear(): void {
    this.points = [];
    this.schedule();
  }

  reverse(): void {
    this.points = [...this.points].reverse();
    this.schedule();
  }

  private schedule(): void {
    if (this.timer) clearTimeout(this.timer);
    if (this.points.length < 2 || !this.router) {
      this.requestId++;
      this.result = null;
      this.error = null;
      this.busy = false;
      return;
    }
    this.busy = true;
    this.timer = setTimeout(() => void this.compute(), this.delay);
  }

  /** Runs the routing now (also used by tests). */
  async compute(): Promise<void> {
    this.timer = null;
    const router = this.router;
    if (!router || this.points.length < 2) return;
    const id = ++this.requestId;
    try {
      const result = await router($state.snapshot(this.points) as LngLat[], this.options);
      if (id !== this.requestId) return;
      this.result = result;
      this.error = null;
    } catch (err) {
      if (id !== this.requestId) return;
      this.result = null;
      this.error = err instanceof Error ? err.message : String(err);
    } finally {
      if (id === this.requestId) this.busy = false;
    }
  }
}
