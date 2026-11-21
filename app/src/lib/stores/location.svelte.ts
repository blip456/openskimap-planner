// My location (plan §7, spec §2.6 + §2.25): the GPS position while the page is visible, the compass heading, and
// the Locate button mode. The GPS runs only while the app is on screen: it stops when the page is hidden and starts
// again when it comes back. No background tracking. The map reads `fix`, `heading`, `mode` and the request counters.
import { HeadingSmoother, headingFromEvent, type OrientationLike } from '../location/heading.ts';
import {
  COMPASS_DENIED,
  errorCodeOf,
  locateError,
  locateFix,
  locatePan,
  locateRotate,
  locateTap,
  locationMessage,
  type LocateAction,
  type LocateMode,
  type LocationErrorCode,
  type Step,
} from '../location/locate.ts';
import { isFresh, type Fix } from '../location/start.ts';

type GeoLike = Pick<Geolocation, 'watchPosition' | 'clearWatch'>;
type Listen = Pick<EventTarget, 'addEventListener' | 'removeEventListener'>;

export interface LocationDeps {
  /** navigator.geolocation; null/undefined = not supported */
  geolocation?: GeoLike | null;
  /** window.isSecureContext (location needs https or localhost) */
  secure?: boolean;
  doc?: Listen & { visibilityState: DocumentVisibilityState };
  /** where deviceorientation events arrive (window) */
  win?: Listen;
  /** iOS: DeviceOrientationEvent.requestPermission; undefined where no permission is needed */
  requestCompass?: () => Promise<string>;
  /** the device may have a compass (false on a desktop with a mouse) */
  compassAvailable?: boolean;
  /** screen.orientation.angle */
  screenAngle?: () => number;
  /** wall clock for fix times (Date.now) */
  now?: () => number;
  /** monotonic clock for the heading throttle (performance.now) */
  clock?: () => number;
  toast?: (text: string) => void;
}

/** A fix older than this is shown grey (spec §2.25). */
export const STALE_MS = 30_000;
const WATCH_OPTIONS: PositionOptions = { enableHighAccuracy: true, maximumAge: 5_000, timeout: 20_000 };

interface Waiter {
  resolve: (f: Fix) => void;
  reject: (code: LocationErrorCode) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class LocationError extends Error {
  readonly code: LocationErrorCode;
  constructor(code: LocationErrorCode) {
    super(locationMessage(code));
    this.code = code;
  }
}

export class LocationState {
  mode = $state<LocateMode>('off');
  fix = $state.raw<Fix | null>(null);
  /** smoothed compass heading of the top of the screen, degrees from north; null without a compass */
  heading = $state<number | null>(null);
  /** ± degrees (iOS) */
  headingAccuracy = $state<number | null>(null);
  /** the last fix is older than 30 s */
  stale = $state(false);
  /** the last error (for the button and the messages) */
  error = $state<LocationErrorCode | null>(null);
  compassDenied = $state(false);
  /** asks the map to move to the position (counter changes every time) */
  centreSeq = $state(0);
  /** asks the map to turn back to north */
  northSeq = $state(0);
  /** the GPS is wanted (the user turned location on); it only runs while the page is visible */
  tracking = $state(false);
  /** the GPS watch is running right now */
  watching = $state(false);

  private readonly deps: LocationDeps;
  private watchId: number | null = null;
  private compassOn = false;
  private compassGranted: boolean;
  private readonly smoother = new HeadingSmoother();
  private waiters: Waiter[] = [];
  private staleTimer: ReturnType<typeof setInterval> | null = null;
  private fake: Fix | null = null;
  private fakeHeading: number | null = null;
  private readonly onVisibility = () => this.syncRunning();
  private readonly onOrientation = (e: Event) => this.orientation(e as unknown as OrientationLike);

  constructor(deps: LocationDeps = browserDeps()) {
    this.deps = deps;
    // without a permission API (Android, desktop) the events simply arrive, or never do
    this.compassGranted = !deps.requestCompass;
    deps.doc?.addEventListener('visibilitychange', this.onVisibility);
  }

  private get visible(): boolean {
    return (this.deps.doc?.visibilityState ?? 'visible') === 'visible';
  }

  private now(): number {
    return (this.deps.now ?? Date.now)();
  }

  get compassAvailable(): boolean {
    return this.deps.compassAvailable ?? true;
  }

  /** Locate button tap. Must be called straight from the click handler: iOS asks for the compass only then. */
  tap(): void {
    const step = locateTap(this.mode, { hasFix: !!this.fix, compassDenied: this.compassDenied, compassAvailable: this.compassAvailable });
    if (step.mode === 'searching' || step.mode === 'heading') this.error = null;
    this.apply(step);
  }

  /** The map was panned by hand. */
  userPanned(): void {
    this.apply(locatePan(this.mode));
  }

  /** The map was turned by hand. */
  userRotated(): void {
    this.apply(locateRotate(this.mode));
  }

  /** Compass button: in "follow with heading" it goes back to "follow" (the map turns north). */
  northPressed(): void {
    if (this.mode === 'heading') this.mode = 'follow';
  }

  private apply(step: Step): void {
    this.mode = step.mode;
    for (const a of step.actions) this.run(a);
  }

  private run(a: LocateAction): void {
    if (a === 'start-watch') {
      this.tracking = true;
      this.syncRunning();
    } else if (a === 'stop-watch') {
      this.tracking = false;
      this.syncRunning();
    } else if (a === 'centre') {
      if (this.fix) this.centreSeq++;
    } else if (a === 'north') {
      this.northSeq++;
    } else if (a === 'ask-compass') {
      this.askCompass();
    }
  }

  /** iOS: the permission prompt only appears when asked straight from a tap, so this runs synchronously first. */
  private askCompass(): void {
    if (this.compassGranted) {
      this.syncCompass();
      return;
    }
    let asked: Promise<string>;
    try {
      asked = this.deps.requestCompass!();
    } catch {
      asked = Promise.resolve('denied');
    }
    void asked
      .catch(() => 'denied')
      .then((answer) => {
        if (answer === 'granted') {
          this.compassGranted = true;
          this.syncCompass();
          return;
        }
        this.compassDenied = true;
        if (this.mode === 'heading') this.mode = 'follow';
        this.deps.toast?.(COMPASS_DENIED);
      });
  }

  /**
   * One position for "Start from my location": a fresh known fix at once, else the GPS is started (the dot appears)
   * and the next fix is awaited. Rejects with a LocationError.
   */
  requestFix(timeoutMs = 20_000): Promise<Fix> {
    if (isFresh(this.fix, this.now()) && !this.stale) return Promise.resolve(this.fix);
    return new Promise<Fix>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter((w) => w !== waiter);
        reject(new LocationError('timeout'));
      }, timeoutMs);
      const waiter: Waiter = { resolve, reject: (code) => reject(new LocationError(code)), timer };
      this.waiters.push(waiter);
      if (this.mode === 'denied' || this.mode === 'unavailable') this.mode = 'off';
      this.tracking = true;
      this.syncRunning();
    });
  }

  /** Dev overlay: a fake position (and heading) instead of the GPS; null goes back to the real GPS. */
  setFake(pos: { lat: number; lon: number; heading: number | null } | null): void {
    this.fake = pos ? { lon: pos.lon, lat: pos.lat, accuracy: 10, time: this.now() } : null;
    this.fakeHeading = pos?.heading ?? null;
    this.stopWatch();
    this.syncRunning();
  }

  // --- GPS -------------------------------------------------------------------------------------------------------

  /** Starts or stops the GPS and the compass: running = wanted AND the page is visible. */
  private syncRunning(): void {
    const run = this.tracking && this.visible;
    if (run && this.watchId === null) this.startWatch();
    if (!run && this.watchId !== null) this.stopWatch();
    this.syncCompass();
    this.syncStaleTimer();
  }

  private startWatch(): void {
    if (this.fake) {
      this.watchId = -1;
      this.watching = true;
      const f = { ...this.fake, time: this.now() };
      queueMicrotask(() => {
        this.position(f);
        if (this.fakeHeading !== null) this.setHeading(this.fakeHeading, null);
      });
      return;
    }
    if (this.deps.secure === false) return this.failed('insecure');
    const geo = this.deps.geolocation;
    if (!geo) return this.failed('unsupported');
    this.watchId = geo.watchPosition(
      (p) =>
        this.position({
          lon: p.coords.longitude,
          lat: p.coords.latitude,
          accuracy: p.coords.accuracy,
          time: p.timestamp || this.now(),
          course: p.coords.heading,
        }),
      (err) => this.failed(errorCodeOf(err)),
      WATCH_OPTIONS,
    );
    this.watching = true;
  }

  private stopWatch(): void {
    if (this.watchId !== null && this.watchId >= 0) this.deps.geolocation?.clearWatch(this.watchId);
    this.watchId = null;
    this.watching = false;
  }

  private position(f: Fix): void {
    if (!this.tracking) return;
    this.fix = f;
    this.stale = false;
    this.error = null;
    this.apply(locateFix(this.mode));
    const waiters = this.waiters;
    this.waiters = [];
    for (const w of waiters) {
      clearTimeout(w.timer);
      w.resolve(f);
    }
  }

  private failed(code: LocationErrorCode): void {
    const step = locateError(this.mode, code, !!this.fix);
    const user = this.mode === 'searching';
    if (step.mode === 'denied' || step.mode === 'unavailable') this.error = code;
    this.apply(step);
    const waiters = this.waiters;
    this.waiters = [];
    for (const w of waiters) {
      clearTimeout(w.timer);
      w.reject(code);
    }
    // a "Start from my location" caller shows its own message
    if (user && !waiters.length && (step.mode === 'denied' || step.mode === 'unavailable')) this.deps.toast?.(locationMessage(code));
  }

  private syncStaleTimer(): void {
    const want = this.watching;
    if (want && !this.staleTimer) {
      this.staleTimer = setInterval(() => {
        this.stale = !!this.fix && this.now() - this.fix.time > STALE_MS;
      }, 5_000);
    } else if (!want && this.staleTimer) {
      clearInterval(this.staleTimer);
      this.staleTimer = null;
    }
  }

  // --- compass ---------------------------------------------------------------------------------------------------

  private syncCompass(): void {
    const want = this.watching && this.visible && this.compassGranted && this.compassAvailable && !this.fake;
    const win = this.deps.win;
    if (want && !this.compassOn && win) {
      win.addEventListener('deviceorientationabsolute', this.onOrientation);
      win.addEventListener('deviceorientation', this.onOrientation);
      this.compassOn = true;
    } else if (!want && this.compassOn && win) {
      win.removeEventListener('deviceorientationabsolute', this.onOrientation);
      win.removeEventListener('deviceorientation', this.onOrientation);
      this.compassOn = false;
      this.smoother.reset();
    }
  }

  private orientation(e: OrientationLike): void {
    const r = headingFromEvent(e, this.deps.screenAngle?.() ?? 0);
    if (!r) return;
    this.setHeading(r.heading, r.accuracy);
  }

  private setHeading(raw: number, accuracy: number | null): void {
    const h = this.smoother.push(raw, (this.deps.clock ?? (() => performance.now()))());
    this.headingAccuracy = accuracy;
    if (h !== null) this.heading = h;
  }

  dispose(): void {
    this.tracking = false;
    this.syncRunning();
    this.deps.doc?.removeEventListener('visibilitychange', this.onVisibility);
  }
}

/** The real browser APIs (geolocation, compass events, visibility). */
export function browserDeps(): LocationDeps {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return { geolocation: null, compassAvailable: false };
  const DOE = (window as Window & { DeviceOrientationEvent?: { requestPermission?: () => Promise<string> } }).DeviceOrientationEvent;
  const fineMouse = typeof matchMedia === 'function' && matchMedia('(hover: hover) and (pointer: fine)').matches;
  return {
    geolocation: 'geolocation' in navigator ? navigator.geolocation : null,
    secure: window.isSecureContext,
    doc: document,
    win: window,
    requestCompass: typeof DOE?.requestPermission === 'function' ? () => DOE.requestPermission!() : undefined,
    compassAvailable: !!DOE && !fineMouse,
    screenAngle: () => screen.orientation?.angle ?? 0,
    now: () => Date.now(),
    clock: () => performance.now(),
  };
}
