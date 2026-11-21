// Route points, plan mode, route settings, the routing result and undo/redo. The router is injected (the worker
// client in the app, a fake in tests). Requests are debounced like the old planner's scheduleRoute, and only the
// newest answer is used (an older answer that arrives late is ignored).
import type { RouteOptions, RouteOptionsInput } from '@core/routing/index.ts';
import type { RouteResponse } from '../worker/engine.ts';
import { History } from '../route/history.ts';
import { cleanOptions, defaultOptions } from '../route/options.ts';
import { MAX_POINTS, type LngLat, type PlannerData } from './planner-persist.ts';

export type { LngLat };
export type Router = (points: LngLat[], options: RouteOptionsInput) => Promise<RouteResponse>;
/** Looks up a readable name for a route point (nearest run/lift), or null. */
export type PointNamer = (p: LngLat) => Promise<string | null>;

export { MAX_POINTS };

/** A, B, …, Z, AA, AB, … (same as the old planner) */
export function pointLetter(i: number): string {
  return i < 26 ? String.fromCharCode(65 + i) : `${String.fromCharCode(64 + Math.floor(i / 26))}${String.fromCharCode(65 + (i % 26))}`;
}

export type PointRole = 'start' | 'stop' | 'end';
export function pointRole(i: number, n: number): PointRole {
  if (i === 0) return 'start';
  if (i === n - 1 && n > 1) return 'end';
  return 'stop';
}
export const ROLE_LABEL: Record<PointRole, string> = { start: 'Start', stop: 'Stop', end: 'Destination' };

const pointKey = (p: LngLat): string => `${p[0].toFixed(5)},${p[1].toFixed(5)}`;

export interface SavedRouteInput {
  id: string;
  name: string;
  folder: string;
  points: LngLat[];
  options: unknown;
}

export class RouteState {
  points = $state<LngLat[]>([]);
  planMode = $state(false);
  options = $state.raw<RouteOptions>(defaultOptions());
  result = $state.raw<RouteResponse | null>(null);
  error = $state<string | null>(null);
  busy = $state(false);

  /** name and folder typed in the Saved sheet; linked saved route (old planner: savedId / savedSnapshot) */
  routeName = $state('');
  routeFolder = $state('');
  savedId = $state<string | null>(null);
  savedSnapshot = $state<string | null>(null);
  /** legs whose directions are collapsed, keyed "A-B" (old planner: collapsedLegs) */
  collapsedLegs = $state<string[]>([]);
  /** nearest names of the route points, by rounded coordinates */
  names = $state<Record<string, string>>({});

  /** bumps on every history change, so canUndo / canRedo are reactive */
  private historyVersion = $state(0);
  readonly history: History;
  /** shown as a toast by the app (e.g. "at most 25 points") */
  onNotice: ((text: string) => void) | null = null;

  private router: Router | null = null;
  private namer: PointNamer | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private requestId = 0;
  private readonly delay: number;

  constructor(options: { delay?: number; stored?: Partial<PlannerData> } = {}) {
    this.delay = options.delay ?? 150;
    const s = options.stored;
    if (s) {
      this.points = s.points ?? [];
      this.planMode = s.planMode ?? false;
      this.options = s.options ?? defaultOptions();
      this.routeName = s.routeName ?? '';
      this.routeFolder = s.routeFolder ?? '';
      this.savedId = s.savedId ?? null;
      this.savedSnapshot = s.savedId ? (s.savedSnapshot ?? null) : null;
      this.collapsedLegs = s.collapsedLegs ?? [];
    }
    this.history = new History(this.snapshot(), s?.history);
  }

  // --- routing ---------------------------------------------------------------------------------------------

  setRouter(router: Router | null): void {
    this.router = router;
    this.schedule();
  }

  setNamer(namer: PointNamer | null): void {
    this.namer = namer;
    this.lookUpNames();
  }

  private schedule(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
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
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const router = this.router;
    if (!router || this.points.length < 2) return;
    const id = ++this.requestId;
    this.busy = true;
    try {
      const result = await router($state.snapshot(this.points) as LngLat[], $state.snapshot(this.options) as RouteOptions);
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

  // --- points ------------------------------------------------------------------------------------------------

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
      this.onNotice?.(`A route can have at most ${MAX_POINTS} points.`);
      return false;
    }
    this.points = [...this.points, [p[0], p[1]]];
    this.pointsChanged();
    return true;
  }

  movePoint(i: number, p: LngLat): void {
    if (i < 0 || i >= this.points.length) return;
    this.points = this.points.map((q, j) => (j === i ? [p[0], p[1]] : q));
    this.pointsChanged();
  }

  removePoint(i: number): void {
    if (i < 0 || i >= this.points.length) return;
    this.points = this.points.filter((_, j) => j !== i);
    this.pointsChanged();
  }

  /** Removes all points; an empty map starts a new route (no longer linked to a saved one). */
  clear(): void {
    this.points = [];
    this.savedId = null;
    this.savedSnapshot = null;
    this.pointsChanged();
  }

  reverse(): void {
    if (this.points.length < 2) return;
    this.points = [...this.points].reverse();
    this.pointsChanged();
  }

  private pointsChanged(): void {
    this.record();
    this.schedule();
    this.lookUpNames();
  }

  /** Nearest name of a point, or null while unknown. */
  nameOf(p: LngLat): string | null {
    return this.names[pointKey(p)] ?? null;
  }

  private lookUpNames(): void {
    const namer = this.namer;
    if (!namer) return;
    for (const p of this.points) {
      const key = pointKey(p);
      if (key in this.names) continue;
      this.names[key] = '';
      void namer([p[0], p[1]]).then(
        (name) => (this.names[key] = name ?? ''),
        () => (this.names[key] = ''),
      );
    }
  }

  // --- settings ------------------------------------------------------------------------------------------------

  setOptions(patch: Partial<RouteOptions>): void {
    this.options = cleanOptions({ ...this.options, ...patch });
    this.record();
    this.schedule();
  }

  // --- legs ------------------------------------------------------------------------------------------------------

  isLegCollapsed(key: string): boolean {
    return this.collapsedLegs.includes(key);
  }

  toggleLeg(key: string, collapsed = !this.isLegCollapsed(key)): void {
    this.collapsedLegs = collapsed ? [...this.collapsedLegs.filter((k) => k !== key), key] : this.collapsedLegs.filter((k) => k !== key);
  }

  // --- undo / redo -------------------------------------------------------------------------------------------

  snapshot(): string {
    return JSON.stringify({ points: $state.snapshot(this.points), options: $state.snapshot(this.options) });
  }

  get canUndo(): boolean {
    void this.historyVersion;
    return this.history.canUndo;
  }

  get canRedo(): boolean {
    void this.historyVersion;
    return this.history.canRedo;
  }

  private record(): void {
    if (this.history.record(this.snapshot())) this.historyVersion++;
  }

  undo(): boolean {
    const snap = this.history.undo();
    if (snap === null) return false;
    this.restore(snap);
    return true;
  }

  redo(): boolean {
    const snap = this.history.redo();
    if (snap === null) return false;
    this.restore(snap);
    return true;
  }

  private restore(snap: string): void {
    try {
      const { points, options } = JSON.parse(snap) as { points: LngLat[]; options: unknown };
      this.points = Array.isArray(points) ? points : [];
      this.options = cleanOptions(options);
    } catch {
      // a broken snapshot is skipped
    }
    this.historyVersion++;
    this.schedule();
    this.lookUpNames();
  }

  // --- saved routes ----------------------------------------------------------------------------------------

  /** The current route differs from the saved route it was opened from. */
  get changedSinceSaved(): boolean {
    return !!this.savedId && this.savedSnapshot !== null && this.savedSnapshot !== this.snapshot();
  }

  /** After a successful save. */
  markSaved(id: string, name: string, folder: string): void {
    this.savedId = id;
    this.savedSnapshot = this.snapshot();
    this.routeName = name;
    this.routeFolder = folder;
  }

  /** The linked saved route was deleted or the storage place changed. */
  unlinkSaved(): void {
    this.savedId = null;
    this.savedSnapshot = null;
  }

  /** Opens a saved route with the settings it was planned with (old planner: openSavedRoute). Undoable. */
  openSaved(r: SavedRouteInput): void {
    this.options = cleanOptions(r.options);
    this.points = r.points.filter((p) => Array.isArray(p) && p.length >= 2).map((p) => [p[0], p[1]]);
    this.savedId = r.id;
    this.routeName = r.name;
    this.routeFolder = r.folder;
    this.collapsedLegs = [];
    this.pointsChanged();
    this.savedSnapshot = this.snapshot();
  }

  /** What is stored in localStorage. */
  toData(): Pick<PlannerData, 'points' | 'planMode' | 'options' | 'routeName' | 'routeFolder' | 'savedId' | 'savedSnapshot' | 'collapsedLegs' | 'history'> {
    return {
      points: $state.snapshot(this.points) as LngLat[],
      planMode: this.planMode,
      options: $state.snapshot(this.options) as RouteOptions,
      routeName: this.routeName,
      routeFolder: this.routeFolder,
      savedId: this.savedId,
      savedSnapshot: this.savedSnapshot,
      collapsedLegs: [...this.collapsedLegs],
      history: this.historyJson(),
    };
  }

  private historyJson() {
    void this.historyVersion; // reactive dependency for the persistence effect
    return this.history.toJSON();
  }
}
