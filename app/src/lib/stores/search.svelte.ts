// Search box state (old planner: runSearch / activateItem / the keyboard handling). Local names through the
// routing worker, coordinates and full Google Maps links here, short links through the desktop server (only with
// the capability), "Search online" (Nominatim) only in online mode. Stale answers are ignored.
import type { GeocodeHit, SearchEntry } from '@core/search.ts';
import type { PinData } from '../explore/info-card.ts';
import {
  NO_MATCHES,
  RESOLVING,
  SHORT_LINK_HINT,
  SHORT_LINK_OFFLINE_HINT,
  classifyQuery,
  coordinateItem,
  firstEnabled,
  geocodeItem,
  googleItem,
  message,
  moveActive,
  textItems,
  type GoogleResult,
  type SearchItem,
} from '../search/items.ts';

export interface SearchDeps {
  local: (query: string) => Promise<SearchEntry[]>;
  /** the online-mode switch */
  online: () => boolean;
  /** the browser has a network (navigator.onLine); missing = always */
  network?: () => boolean;
  /** the desktop server can follow Google Maps short links */
  shortLinks: () => boolean;
  resolve: (url: string) => Promise<GoogleResult>;
  geocode: (query: string) => Promise<GeocodeHit[]>;
  /** a result was picked: drop the pin */
  pick: (pin: PinData) => void;
}

export class SearchState {
  query = $state('');
  items = $state.raw<SearchItem[]>([]);
  active = $state(-1);
  footnote = $state<string | null>(null);
  private seq = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly deps: SearchDeps;
  private readonly delay: number;

  constructor(deps: SearchDeps, delay = 150) {
    this.deps = deps;
    this.delay = delay;
  }

  private get network(): boolean {
    return this.deps.network?.() ?? true;
  }

  /** online search may be used: online mode on and a network */
  private get onlineUsable(): boolean {
    return this.deps.online() && this.network;
  }

  private show(items: SearchItem[], footnote: string | null = null): void {
    this.items = items;
    this.active = firstEnabled(items);
    this.footnote = footnote;
  }

  /** Typing: search after a short pause. Pasting: right away (a pasted link resolves and drops its pin). */
  setQuery(text: string, immediate = false): void {
    this.query = text;
    if (this.timer) clearTimeout(this.timer);
    if (immediate) void this.run(true);
    else this.timer = setTimeout(() => void this.run(false), this.delay);
  }

  clear(): void {
    if (this.timer) clearTimeout(this.timer);
    this.seq++;
    this.query = '';
    this.show([]);
  }

  async run(immediate = false): Promise<void> {
    const seq = ++this.seq;
    const q = classifyQuery(this.query);
    if (q.kind === 'empty') return this.show([]);
    if (q.kind === 'coords') return this.show([coordinateItem(q.lat, q.lon)]);
    if (q.kind === 'google') {
      if (q.precise && q.local) return this.show([googleItem({ ...q.local, lat: q.local.lat!, lon: q.local.lon! })]);
      const fallback = q.local?.lat != null ? googleItem({ ...q.local, lat: q.local.lat, lon: q.local.lon! }) : null;
      if (!this.deps.shortLinks()) {
        // PWA: no server to follow the link; use what the link says, or explain
        return this.show(fallback ? [fallback] : [message('This link needs the desktop app', SHORT_LINK_HINT, { error: true })]);
      }
      if (!this.onlineUsable) {
        // following a short link needs the internet (the desktop server asks Google)
        return this.show(fallback ? [fallback] : [message('This link needs internet', SHORT_LINK_OFFLINE_HINT, { error: true })]);
      }
      this.show([RESOLVING]);
      try {
        const r = await this.deps.resolve(q.text);
        if (seq !== this.seq) return;
        const item = googleItem(r);
        this.show([item]);
        if (immediate) this.activate(item);
      } catch (err) {
        if (seq !== this.seq) return;
        this.show(fallback ? [fallback] : [message('Could not resolve this link', err instanceof Error ? err.message : String(err), { error: true })]);
      }
      return;
    }
    let hits: SearchEntry[] = [];
    try {
      hits = await this.deps.local(q.text);
    } catch {
      hits = [];
    }
    if (seq !== this.seq) return;
    const { items, footnote } = textItems(q.text, hits, this.deps.online(), this.network);
    this.show(items, footnote);
  }

  async activate(item: SearchItem | undefined = this.items[this.active]): Promise<void> {
    if (!item || item.disabled) return;
    if (item.online) {
      if (!this.onlineUsable) return;
      const seq = ++this.seq;
      this.show([message('Searching online…', '', { icon: 'loader' })]);
      try {
        const hits = await this.deps.geocode(item.online);
        if (seq !== this.seq) return;
        this.show(hits.length ? hits.map(geocodeItem) : [message('Nothing found online')]);
      } catch (err) {
        if (seq !== this.seq) return;
        this.show([message('Online search failed', err instanceof Error ? err.message : String(err), { error: true })]);
      }
      return;
    }
    if (item.pin) {
      this.show([]);
      this.deps.pick(item.pin);
    }
  }

  move(delta: 1 | -1): void {
    this.active = moveActive(this.items, this.active, delta);
  }

  /** Enter: pick the highlighted row, or search now. */
  enter(): void {
    if (this.timer) clearTimeout(this.timer);
    if (this.items[this.active] && !this.items[this.active].disabled) void this.activate();
    else void this.run(true);
  }
}

export { NO_MATCHES };
