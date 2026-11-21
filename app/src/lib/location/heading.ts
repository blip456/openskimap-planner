// Compass heading maths (plan §7, spec §2.25): read the heading from a DeviceOrientation event, smooth it without
// jumping at north (359° → 0°), and throttle the updates so the map does not shake.

/** Angle in [0, 360). */
export const norm360 = (a: number): number => ((a % 360) + 360) % 360;

/** Shortest signed turn from `from` to `to`, in (-180, 180]. angleDiff(350, 10) = 20, angleDiff(10, 350) = -20. */
export function angleDiff(from: number, to: number): number {
  const d = norm360(to - from);
  return d > 180 ? d - 360 : d;
}

/** The fields of a DeviceOrientationEvent the app reads (iOS adds the webkit ones). */
export interface OrientationLike {
  alpha: number | null;
  absolute?: boolean;
  webkitCompassHeading?: number;
  webkitCompassAccuracy?: number;
}

export interface HeadingReading {
  /** degrees clockwise from north of the top of the screen */
  heading: number;
  /** ± degrees (iOS only); null when unknown */
  accuracy: number | null;
}

/**
 * Heading of the top of the screen. iOS: `webkitCompassHeading` (already clockwise from north). Other browsers:
 * `alpha` of an absolute event (counter-clockwise, so 360 − alpha). `screenAngle` is `screen.orientation.angle`
 * (0 in portrait). Returns null for events without a usable compass value (relative `alpha` only).
 */
export function headingFromEvent(e: OrientationLike, screenAngle = 0): HeadingReading | null {
  const wch = e.webkitCompassHeading;
  if (typeof wch === 'number' && Number.isFinite(wch) && wch >= 0) {
    const acc = e.webkitCompassAccuracy;
    return { heading: norm360(wch + screenAngle), accuracy: typeof acc === 'number' && acc >= 0 ? acc : null };
  }
  if (e.absolute && typeof e.alpha === 'number' && Number.isFinite(e.alpha)) {
    return { heading: norm360(360 - e.alpha + screenAngle), accuracy: null };
  }
  return null;
}

/**
 * Smooths raw compass values on the circle (exponential smoothing along the shortest turn) and only lets a value
 * through when it moved at least `minDelta` degrees and `minInterval` ms passed since the last one.
 */
export class HeadingSmoother {
  private value: number | null = null;
  private emitted: number | null = null;
  private lastAt = -Infinity;
  private readonly factor: number;
  private readonly minDelta: number;
  private readonly minInterval: number;

  constructor(options: { factor?: number; minDelta?: number; minInterval?: number } = {}) {
    this.factor = options.factor ?? 0.35;
    this.minDelta = options.minDelta ?? 2;
    this.minInterval = options.minInterval ?? 100;
  }

  /** Adds a raw value; returns the new smoothed heading to show, or null when nothing needs to change. */
  push(raw: number, now: number): number | null {
    const r = norm360(raw);
    this.value = this.value === null ? r : norm360(this.value + this.factor * angleDiff(this.value, r));
    if (this.emitted !== null) {
      if (now - this.lastAt < this.minInterval) return null;
      if (Math.abs(angleDiff(this.emitted, this.value)) < this.minDelta) return null;
    }
    this.emitted = this.value;
    this.lastAt = now;
    return this.value;
  }

  reset(): void {
    this.value = null;
    this.emitted = null;
    this.lastAt = -Infinity;
  }
}

/**
 * Map bearing to turn to so the heading points up, as the nearest equivalent angle to the current bearing
 * (current 350, heading 10 → 370, not −340: the map turns 20° through north instead of 340° the long way).
 */
export function bearingTarget(current: number, heading: number): number {
  return current + angleDiff(current, heading);
}
