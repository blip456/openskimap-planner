// State of the dev overlay (dev builds only, docs/pwa-plan.md §2.1). The fake GPS position replaces the GPS (LocationState.setFake).
export interface FakePosition {
  lat: number;
  lon: number;
  /** degrees from north, or null */
  heading: number | null;
}

/** Insets of an iPhone with a Dynamic Island (portrait), used to simulate the safe areas. */
export const IPHONE_SAFE_AREA = { top: 59, right: 0, bottom: 34, left: 0 };

export class DevState {
  safeArea = $state(false);
  fakePosition = $state<FakePosition | null>(null);

  /** CSS custom properties for <html>: the layout reads --safe-* (tokens.css) */
  safeAreaStyle(): Record<string, string> {
    if (!this.safeArea) return {};
    const s = IPHONE_SAFE_AREA;
    return { '--safe-top': `${s.top}px`, '--safe-right': `${s.right}px`, '--safe-bottom': `${s.bottom}px`, '--safe-left': `${s.left}px` };
  }

  setFakePosition(text: string, heading: string): string | null {
    const m = text.trim().match(/^(-?\d+(?:\.\d+)?)\s*[,\s]\s*(-?\d+(?:\.\d+)?)$/);
    if (!m) return 'Use "lat, lon", e.g. 47.3481, 10.2160';
    const lat = Number(m[1]);
    const lon = Number(m[2]);
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return 'Out of range';
    const h = heading.trim() === '' ? null : Number(heading);
    if (h !== null && !(h >= 0 && h < 360)) return 'Heading must be 0–359';
    this.fakePosition = { lat, lon, heading: h };
    return null;
  }
}
