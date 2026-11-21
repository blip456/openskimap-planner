// "Keep screen on while planning" (plan §7, Menu › Appearance): a Screen Wake Lock while the setting is on and the
// app is on screen. The browser releases the lock when the page is hidden, so it is asked again when the page comes
// back. Silent where the API is missing or the browser says no (e.g. low battery mode).

interface Sentinel {
  released: boolean;
  release(): Promise<void>;
  addEventListener?(type: 'release', fn: () => void): void;
}

export interface WakeLockDeps {
  wakeLock?: { request(type: 'screen'): Promise<Sentinel> } | undefined;
  doc?: Pick<Document, 'visibilityState' | 'addEventListener' | 'removeEventListener'>;
}

export const wakeLockSupported = (nav: { wakeLock?: unknown } | undefined = typeof navigator === 'undefined' ? undefined : navigator): boolean =>
  !!nav && typeof nav.wakeLock === 'object' && nav.wakeLock !== null;

export class WakeLockKeeper {
  private wanted = false;
  private sentinel: Sentinel | null = null;
  private pending = false;
  private readonly deps: WakeLockDeps;
  private readonly onVisibility = () => void this.sync();

  constructor(deps: WakeLockDeps = defaultDeps()) {
    this.deps = deps;
    deps.doc?.addEventListener('visibilitychange', this.onVisibility);
  }

  get supported(): boolean {
    return !!this.deps.wakeLock;
  }

  /** The lock is held right now. */
  get active(): boolean {
    return !!this.sentinel && !this.sentinel.released;
  }

  setWanted(on: boolean): Promise<void> {
    this.wanted = on;
    return this.sync();
  }

  private async sync(): Promise<void> {
    const visible = (this.deps.doc?.visibilityState ?? 'visible') === 'visible';
    if (this.wanted && visible) {
      if (this.active || this.pending || !this.deps.wakeLock) return;
      this.pending = true;
      try {
        const s = await this.deps.wakeLock.request('screen');
        // switched off while the request was running
        if (!this.wanted) await s.release().catch(() => {});
        else {
          this.sentinel = s;
          s.addEventListener?.('release', () => {
            if (this.sentinel === s) this.sentinel = null;
          });
        }
      } catch {
        // not allowed (battery saver, page not visible, iOS home screen app on an old iOS): stay quiet
      } finally {
        this.pending = false;
      }
    } else if (!this.wanted && this.sentinel) {
      const s = this.sentinel;
      this.sentinel = null;
      await s.release().catch(() => {});
    }
  }

  dispose(): void {
    this.deps.doc?.removeEventListener('visibilitychange', this.onVisibility);
    this.wanted = false;
    void this.sync();
  }
}

function defaultDeps(): WakeLockDeps {
  if (typeof navigator === 'undefined' || typeof document === 'undefined') return {};
  const nav = navigator as Navigator & { wakeLock?: WakeLockDeps['wakeLock'] };
  return { wakeLock: wakeLockSupported(nav) ? nav.wakeLock : undefined, doc: document };
}
