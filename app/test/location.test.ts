// Phase 6: my location, the Locate button states, compass heading maths, Start from my location, wake lock, touch.
import { afterEach, describe, expect, test, vi } from 'vitest';
import { HeadingSmoother, angleDiff, bearingTarget, headingFromEvent, norm360 } from '../src/lib/location/heading.ts';
import { errorCodeOf, locateError, locateFix, locateLabel, locatePan, locateRotate, locateTap, locationMessage, type LocateMode } from '../src/lib/location/locate.ts';
import { START_LIMITS, checkStart, insertStart, isFresh, startMessage } from '../src/lib/location/start.ts';
import { LocationState, STALE_MS, type LocationDeps } from '../src/lib/stores/location.svelte.ts';
import { WakeLockKeeper, wakeLockSupported } from '../src/lib/wake-lock.ts';
import { blockPageZoom } from '../src/lib/touch.ts';
import { accuracyRadiusAt, locationFeatures, metresPerPixelZ0 } from '../src/lib/map/location-layers.ts';
import { Settings } from '../src/lib/stores/settings.svelte.ts';
import { RoutingEngine } from '../src/lib/worker/engine.ts';
import type { NearestHit } from '../src/lib/worker/engine.ts';
import { plannerJson } from './helpers.ts';

afterEach(() => {
  vi.useRealTimers();
});

describe('heading maths', () => {
  test('angles wrap at north', () => {
    expect(norm360(-10)).toBe(350);
    expect(norm360(725)).toBe(5);
    expect(angleDiff(350, 10)).toBe(20);
    expect(angleDiff(10, 350)).toBe(-20);
    expect(angleDiff(0, 180)).toBe(180);
    expect(angleDiff(90, 90)).toBe(0);
  });

  test('iOS webkitCompassHeading, absolute alpha elsewhere, nothing from relative events', () => {
    expect(headingFromEvent({ alpha: 123, webkitCompassHeading: 42, webkitCompassAccuracy: 10 })).toEqual({ heading: 42, accuracy: 10 });
    expect(headingFromEvent({ alpha: 0, webkitCompassHeading: 42, webkitCompassAccuracy: -1 })?.accuracy).toBeNull();
    // alpha turns counter-clockwise: alpha 90 = facing west = heading 270
    expect(headingFromEvent({ alpha: 90, absolute: true })).toEqual({ heading: 270, accuracy: null });
    expect(headingFromEvent({ alpha: 0, absolute: true })?.heading).toBe(0);
    expect(headingFromEvent({ alpha: 90, absolute: false })).toBeNull();
    expect(headingFromEvent({ alpha: null, absolute: true })).toBeNull();
    // -1 means "no compass value" on iOS
    expect(headingFromEvent({ alpha: null, webkitCompassHeading: -1 })).toBeNull();
    // landscape: the top of the screen is turned by the screen angle
    expect(headingFromEvent({ alpha: null, webkitCompassHeading: 350 }, 90)?.heading).toBe(80);
  });

  test('smoothing goes the short way through north (359 → 0), not around the circle', () => {
    const s = new HeadingSmoother({ factor: 0.5, minDelta: 0, minInterval: 0 });
    expect(s.push(350, 0)).toBe(350);
    const v = s.push(10, 1)!; // half way: 0, not 180
    expect(Math.abs(angleDiff(0, v))).toBeLessThan(1e-9);
    const w = s.push(10, 2)!;
    expect(w).toBeCloseTo(5);
  });

  test('throttle and dead band keep the map still', () => {
    const s = new HeadingSmoother({ factor: 1, minDelta: 2, minInterval: 100 });
    expect(s.push(100, 0)).toBe(100);
    expect(s.push(130, 50)).toBeNull(); // too soon
    expect(s.push(101, 200)).toBeNull(); // too small a change
    expect(s.push(130, 300)).toBe(130);
    // jitter around a steady value does not get through
    const j = new HeadingSmoother();
    const out = [0, 1, 0.5, 359.5, 0.8, 359.2].map((h, i) => j.push(h, i * 200));
    expect(out.filter((x) => x !== null)).toHaveLength(1);
  });

  test('the map turns to the nearest equal bearing', () => {
    expect(bearingTarget(350, 10)).toBe(370);
    expect(bearingTarget(10, 350)).toBe(-10);
    expect(bearingTarget(-170, 170)).toBe(-190);
    expect(bearingTarget(0, 90)).toBe(90);
  });
});

describe('Locate button states (like Apple Maps)', () => {
  const ctx = { hasFix: false, compassDenied: false, compassAvailable: true };

  test('off → searching → centred → follow → heading → off', () => {
    let s = locateTap('off', ctx);
    expect(s).toEqual({ mode: 'searching', actions: ['start-watch'] });
    s = locateFix(s.mode);
    expect(s).toEqual({ mode: 'centred', actions: ['centre'] });
    s = locateTap(s.mode, { ...ctx, hasFix: true });
    expect(s).toEqual({ mode: 'follow', actions: ['centre'] });
    s = locateTap(s.mode, { ...ctx, hasFix: true });
    expect(s).toEqual({ mode: 'heading', actions: ['ask-compass', 'centre'] });
    s = locateTap(s.mode, { ...ctx, hasFix: true });
    expect(s).toEqual({ mode: 'off', actions: ['north'] });
    // the dot is still known: the next tap centres at once
    expect(locateTap('off', { ...ctx, hasFix: true })).toEqual({ mode: 'centred', actions: ['start-watch', 'centre'] });
  });

  test('a tap while searching cancels', () => {
    expect(locateTap('searching', ctx)).toEqual({ mode: 'off', actions: ['stop-watch'] });
  });

  test('without a compass (or refused) follow goes back to off', () => {
    expect(locateTap('follow', { ...ctx, hasFix: true, compassAvailable: false }).mode).toBe('off');
    expect(locateTap('follow', { ...ctx, hasFix: true, compassDenied: true }).mode).toBe('off');
  });

  test('panning stops following; turning stops the heading mode', () => {
    expect(locatePan('follow').mode).toBe('centred');
    expect(locatePan('heading').mode).toBe('centred');
    expect(locatePan('off').mode).toBe('off');
    expect(locateRotate('heading').mode).toBe('follow');
    expect(locateRotate('follow').mode).toBe('follow');
  });

  test('a new fix asks for a centre only the first time (following moves the map by itself)', () => {
    expect(locateFix('searching')).toEqual({ mode: 'centred', actions: ['centre'] });
    expect(locateFix('follow')).toEqual({ mode: 'follow', actions: [] });
    expect(locateFix('heading')).toEqual({ mode: 'heading', actions: [] });
    expect(locateFix('centred').actions).toEqual([]);
    expect(locateFix('off').actions).toEqual([]);
  });

  test('errors: denied stops; a short gap keeps the last fix', () => {
    expect(locateError('searching', 'denied', false)).toEqual({ mode: 'denied', actions: ['stop-watch'] });
    expect(locateError('follow', 'denied', true).mode).toBe('denied');
    expect(locateError('follow', 'timeout', true)).toEqual({ mode: 'follow', actions: [] });
    expect(locateError('searching', 'timeout', false).mode).toBe('unavailable');
    expect(locateError('searching', 'insecure', false).mode).toBe('unavailable');
    // denied / unavailable: a tap tries again
    expect(locateTap('denied', ctx).mode).toBe('searching');
    expect(locateTap('unavailable', ctx).mode).toBe('searching');
  });

  test('labels and messages are plain English', () => {
    const modes: LocateMode[] = ['off', 'searching', 'centred', 'follow', 'heading', 'denied', 'unavailable'];
    expect(modes.map(locateLabel)).toEqual([
      'Show my location',
      'Finding your location',
      'Follow my location',
      'Follow my location and heading',
      'Stop following',
      'Location is off',
      'Location is off',
    ]);
    expect(locationMessage('denied')).toMatch(/Settings › Privacy & Security › Location Services/);
    expect(locationMessage('insecure')).toMatch(/https/);
    expect(locationMessage('unavailable')).toBe("Can't find your location right now.");
    expect([errorCodeOf({ code: 1 }), errorCodeOf({ code: 2 }), errorCodeOf({ code: 3 }), errorCodeOf(null)]).toEqual(['denied', 'unavailable', 'timeout', 'unavailable']);
  });
});

/** A fake browser: geolocation, visibility and orientation events, driven by the test. */
function fakeBrowser(extra: Partial<LocationDeps> = {}) {
  let success: PositionCallback | null = null;
  let failure: PositionErrorCallback | null = null;
  const watches = { started: 0, cleared: 0 };
  const docListeners = new Map<string, () => void>();
  const winListeners = new Map<string, (e: Event) => void>();
  const doc = {
    visibilityState: 'visible' as DocumentVisibilityState,
    addEventListener: (t: string, fn: () => void) => docListeners.set(t, fn),
    removeEventListener: (t: string) => docListeners.delete(t),
  };
  const win = {
    addEventListener: (t: string, fn: (e: Event) => void) => winListeners.set(t, fn),
    removeEventListener: (t: string) => winListeners.delete(t),
  };
  let now = 1_000_000;
  const toasts: string[] = [];
  const deps: LocationDeps = {
    geolocation: {
      watchPosition: (ok, err) => {
        success = ok;
        failure = err ?? null;
        return ++watches.started;
      },
      clearWatch: () => {
        watches.cleared++;
        success = null;
      },
    },
    secure: true,
    doc: doc as never,
    win: win as never,
    compassAvailable: true,
    now: () => now,
    clock: () => now,
    toast: (t) => toasts.push(t),
    ...extra,
  };
  return {
    deps,
    watches,
    toasts,
    doc,
    winListeners,
    tick: (ms: number) => (now += ms),
    fix: (lat: number, lon: number, accuracy = 8) =>
      success?.({ coords: { latitude: lat, longitude: lon, accuracy, heading: null }, timestamp: now } as unknown as GeolocationPosition),
    fail: (code: number) => failure?.({ code } as GeolocationPositionError),
    setVisible: (v: boolean) => {
      doc.visibilityState = v ? 'visible' : 'hidden';
      docListeners.get('visibilitychange')?.();
    },
    orient: (e: Record<string, unknown>) => winListeners.get('deviceorientation')?.(e as unknown as Event),
    get watching() {
      return success !== null;
    },
  };
}

describe('location store', () => {
  test('watches only while the page is visible, restarts when it comes back', () => {
    const b = fakeBrowser();
    const loc = new LocationState(b.deps);
    expect(b.watches.started).toBe(0); // nothing before the first tap
    loc.tap();
    expect(loc.mode).toBe('searching');
    expect(b.watches.started).toBe(1);
    b.fix(47.4, 10.27);
    expect(loc.mode).toBe('centred');
    expect(loc.centreSeq).toBe(1);
    b.setVisible(false);
    expect(b.watches.cleared).toBe(1);
    expect(loc.watching).toBe(false);
    b.setVisible(true);
    expect(b.watches.started).toBe(2);
    expect(loc.watching).toBe(true);
    loc.dispose();
  });

  test('follow → pan by hand → centred; heading → turn by hand → follow; heading → off turns north', () => {
    const b = fakeBrowser();
    const loc = new LocationState(b.deps);
    loc.tap();
    b.fix(47.4, 10.27);
    loc.tap();
    expect(loc.mode).toBe('follow');
    const seq = loc.centreSeq;
    b.fix(47.401, 10.27);
    expect(loc.centreSeq).toBe(seq); // the map follows the fix itself, no extra centre request
    loc.userPanned();
    expect(loc.mode).toBe('centred');
    loc.tap();
    loc.tap();
    expect(loc.mode).toBe('heading');
    loc.userRotated();
    expect(loc.mode).toBe('follow');
    loc.tap();
    loc.tap();
    expect(loc.mode).toBe('off');
    expect(loc.northSeq).toBe(1);
    expect(loc.fix).not.toBeNull(); // the dot stays
  });

  test('denied: clear state and message, the app keeps working', () => {
    const b = fakeBrowser();
    const loc = new LocationState(b.deps);
    loc.tap();
    b.fail(1);
    expect(loc.mode).toBe('denied');
    expect(loc.error).toBe('denied');
    expect(loc.tracking).toBe(false);
    expect(b.toasts[0]).toMatch(/Location is off for this app/);
  });

  test('insecure page and missing API', () => {
    const insecure = fakeBrowser({ secure: false });
    const a = new LocationState(insecure.deps);
    a.tap();
    expect(a.mode).toBe('unavailable');
    expect(a.error).toBe('insecure');
    expect(insecure.toasts[0]).toMatch(/https/);
    const none = fakeBrowser({ geolocation: null });
    const b = new LocationState(none.deps);
    b.tap();
    expect(b.error).toBe('unsupported');
  });

  test('timeout before the first fix → unavailable; after a fix the last position stays', () => {
    const b = fakeBrowser();
    const loc = new LocationState(b.deps);
    loc.tap();
    b.fail(3);
    expect(loc.mode).toBe('unavailable');
    loc.tap(); // try again
    expect(loc.mode).toBe('searching');
    b.fix(47.4, 10.27);
    loc.tap();
    b.fail(3);
    expect(loc.mode).toBe('follow');
    expect(loc.fix).not.toBeNull();
  });

  test('the fix turns stale after 30 s', () => {
    vi.useFakeTimers();
    const b = fakeBrowser();
    const loc = new LocationState(b.deps);
    loc.tap();
    b.fix(47.4, 10.27);
    b.tick(STALE_MS + 1000);
    vi.advanceTimersByTime(5000);
    expect(loc.stale).toBe(true);
    b.fix(47.4, 10.27);
    expect(loc.stale).toBe(false);
    loc.dispose();
  });

  test('compass: asked from the tap (iOS), heading from the events, refused → message and follow', async () => {
    const ask = vi.fn(async () => 'granted');
    const b = fakeBrowser({ requestCompass: ask });
    const loc = new LocationState(b.deps);
    loc.tap();
    b.fix(47.4, 10.27);
    expect(b.winListeners.size).toBe(0); // iOS: no events before permission
    loc.tap(); // follow
    loc.tap(); // heading: asks synchronously inside the tap
    expect(ask).toHaveBeenCalledTimes(1);
    await Promise.resolve();
    await Promise.resolve();
    expect(b.winListeners.has('deviceorientation')).toBe(true);
    b.orient({ alpha: 0, webkitCompassHeading: 90, webkitCompassAccuracy: 10 });
    expect(loc.heading).toBe(90);
    expect(loc.headingAccuracy).toBe(10);
    // page hidden: compass and GPS stop
    b.setVisible(false);
    expect(b.winListeners.size).toBe(0);

    const no = vi.fn(async () => 'denied');
    const c = fakeBrowser({ requestCompass: no });
    const l2 = new LocationState(c.deps);
    l2.tap();
    c.fix(47.4, 10.27);
    l2.tap();
    l2.tap();
    await Promise.resolve();
    await Promise.resolve();
    expect(l2.mode).toBe('follow');
    expect(l2.compassDenied).toBe(true);
    expect(c.toasts).toContain('Compass is off. The map can still follow your position.');
    l2.tap();
    expect(l2.mode).toBe('off');
  });

  test('requestFix: a fresh fix at once, else waits for the GPS; errors reject', async () => {
    const b = fakeBrowser();
    const loc = new LocationState(b.deps);
    const p = loc.requestFix();
    expect(loc.tracking).toBe(true);
    b.fix(47.4, 10.27, 12);
    await expect(p).resolves.toMatchObject({ lat: 47.4, lon: 10.27, accuracy: 12 });
    expect(loc.mode).toBe('off'); // the dot shows, the map is not moved by the button state
    await expect(loc.requestFix()).resolves.toMatchObject({ lat: 47.4 });
    b.tick(START_LIMITS.maxAge + 1);
    const q = loc.requestFix();
    b.fail(1);
    await expect(q).rejects.toThrow(/Location is off/);
    expect(b.toasts).toHaveLength(0); // the caller shows the message, not twice
  });

  test('dev overlay: a fake position replaces the GPS', async () => {
    const b = fakeBrowser();
    const loc = new LocationState(b.deps);
    loc.setFake({ lat: 47.4, lon: 10.2, heading: 45 });
    loc.tap();
    await Promise.resolve();
    expect(b.watches.started).toBe(0);
    expect(loc.fix).toMatchObject({ lat: 47.4, lon: 10.2 });
    expect(loc.heading).toBe(45);
    expect(loc.mode).toBe('centred');
  });
});

describe('Start from my location', () => {
  const hit = (distance: number, names = ['Blue Valley']): NearestHit => ({ position: [10, 47.01, 1800], distance, names, station: false });

  test('limits: too far, not exact, near and far', () => {
    expect(checkStart({ accuracy: 10 }, null)).toMatchObject({ ok: false, reason: 'no-network' });
    const far = checkStart({ accuracy: 10 }, hit(START_LIMITS.maxDistance + 1));
    expect(far).toMatchObject({ ok: false, reason: 'too-far' });
    expect(far.ok || far.message).toMatch(/^You are 401 m from the nearest run or lift/);
    expect(checkStart({ accuracy: 10 }, hit(12_400)).ok || '').toBe('');
    expect((checkStart({ accuracy: 10 }, hit(12_400)) as { message: string }).message).toMatch(/12 km/);
    expect(checkStart({ accuracy: START_LIMITS.maxAccuracy + 1 }, hit(20))).toMatchObject({ ok: false, reason: 'accuracy' });
    const ok = checkStart({ accuracy: START_LIMITS.maxAccuracy }, hit(START_LIMITS.near));
    expect(ok).toMatchObject({ ok: true, far: false, name: 'Blue Valley', point: [10, 47.01] });
    expect(checkStart({ accuracy: 5 }, hit(START_LIMITS.near + 1))).toMatchObject({ ok: true, far: true });
    expect(startMessage(ok as never)).toBe('Start set at Blue Valley');
    expect(startMessage(checkStart({ accuracy: 5 }, hit(200)) as never)).toBe('You are far from the runs. Start set at the nearest lift or run.');
    expect(startMessage(checkStart({ accuracy: 5 }, hit(5, [])) as never)).toBe('Start set at your location');
  });

  test('the start goes in front of the route; a start at the same spot is replaced', () => {
    const a: [number, number] = [10.02, 47.0];
    const b: [number, number] = [10.03, 47.01];
    expect(insertStart([], [10, 47])).toEqual([[10, 47]]);
    expect(insertStart([a], [10, 47])).toEqual([[10, 47], a]);
    expect(insertStart([a, b], [10, 47])).toEqual([[10, 47], a, b]);
    // 10 m away from A: replaced, not doubled
    expect(insertStart([a, b], [10.02, 47.00009])).toEqual([[10.02, 47.00009], b]);
  });

  test('fresh fixes only', () => {
    const f = { lon: 10, lat: 47, accuracy: 5, time: 1000 };
    expect(isFresh(f, 1000 + START_LIMITS.maxAge)).toBe(true);
    expect(isFresh(f, 1001 + START_LIMITS.maxAge)).toBe(false);
    expect(isFresh(null, 0)).toBe(false);
  });

  test('worker nearest with start uses a place a route can leave', async () => {
    const e = new RoutingEngine();
    await e.load('mini', { kind: 'blob', blob: new Blob([plannerJson()]) });
    const endOfBlack = e.nearest([10.0202, 47.0002])!;
    const start = e.nearest([10.0202, 47.0002], { start: true })!;
    expect(endOfBlack.distance).toBe(0);
    expect(start.station || start.names.length > 0).toBe(true);
    expect(() => e.route([[start.position[0], start.position[1]], [10.02, 47.01]])).not.toThrow();
  });
});

describe('map layer for my location', () => {
  test('the accuracy circle has its real size in metres at every zoom', () => {
    const lat = 47.4;
    for (const zoom of [10, 15, 18]) {
      const metresPerPixel = metresPerPixelZ0(lat) / 2 ** zoom;
      expect(accuracyRadiusAt(25, lat, zoom) * metresPerPixel).toBeCloseTo(25, 6);
    }
    const f = locationFeatures({ lon: 10, lat, accuracy: 25, stale: false, heading: 90, narrow: true }).features[0];
    expect(f.properties).toMatchObject({ stale: false, heading: 90, hasHeading: true, cone: 'user-cone-narrow' });
    expect((f.properties as { r0: number }).r0 * 2 ** 15).toBeCloseTo(accuracyRadiusAt(25, lat, 15));
    // more than 2 km: no circle; no heading: no cone
    const g = locationFeatures({ lon: 10, lat, accuracy: 2500, stale: true, heading: null, narrow: false }).features[0];
    expect(g.properties).toMatchObject({ r0: 0, hasHeading: false, stale: true, cone: 'user-cone-wide' });
    expect(locationFeatures(null).features).toHaveLength(0);
  });
});

describe('keep screen on', () => {
  function fakeWakeLock() {
    const listeners = new Map<string, () => void>();
    const doc = {
      visibilityState: 'visible' as DocumentVisibilityState,
      addEventListener: (t: string, fn: () => void) => listeners.set(t, fn),
      removeEventListener: (t: string) => listeners.delete(t),
    };
    const sentinels: { released: boolean; release: () => Promise<void>; onrelease?: () => void }[] = [];
    const wakeLock = {
      request: vi.fn(async () => {
        const s = {
          released: false,
          onrelease: undefined as undefined | (() => void),
          release: async () => {
            s.released = true;
            s.onrelease?.();
          },
          addEventListener: (_t: 'release', fn: () => void) => (s.onrelease = fn),
        };
        sentinels.push(s);
        return s;
      }),
    };
    return { doc, wakeLock, sentinels, visibility: (v: DocumentVisibilityState) => ((doc.visibilityState = v), listeners.get('visibilitychange')?.()) };
  }

  test('asks while wanted, asks again after the page was hidden, releases when switched off', async () => {
    const f = fakeWakeLock();
    const k = new WakeLockKeeper({ wakeLock: f.wakeLock, doc: f.doc as never });
    await k.setWanted(true);
    expect(k.active).toBe(true);
    // the browser releases the lock when the page is hidden
    await f.sentinels[0].release();
    f.visibility('hidden');
    expect(k.active).toBe(false);
    f.visibility('visible');
    await vi.waitFor(() => expect(f.wakeLock.request).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(k.active).toBe(true));
    await k.setWanted(false);
    expect(k.active).toBe(false);
    expect(f.sentinels[1].released).toBe(true);
  });

  test('silent when unsupported or refused', async () => {
    const none = new WakeLockKeeper({});
    expect(none.supported).toBe(false);
    await expect(none.setWanted(true)).resolves.toBeUndefined();
    const refused = new WakeLockKeeper({ wakeLock: { request: async () => Promise.reject(new DOMException('no', 'NotAllowedError')) } });
    await expect(refused.setWanted(true)).resolves.toBeUndefined();
    expect(refused.active).toBe(false);
    expect(wakeLockSupported({})).toBe(false);
    expect(wakeLockSupported({ wakeLock: {} })).toBe(true);
  });

  test('the setting is saved', () => {
    const store = new Map<string, string>();
    const kv = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
    const s = new Settings({ online: false }, kv);
    expect(s.keepAwake).toBe(false);
    s.setKeepAwake(true);
    expect(new Settings({ online: false }, kv).keepAwake).toBe(true);
  });
});

describe('touch', () => {
  test('page pinch gestures (iOS) are cancelled', () => {
    const t = new EventTarget();
    const stop = blockPageZoom(t);
    const e = new Event('gesturestart', { cancelable: true });
    t.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(true);
    stop();
    const e2 = new Event('gesturestart', { cancelable: true });
    t.dispatchEvent(e2);
    expect(e2.defaultPrevented).toBe(false);
  });
});
