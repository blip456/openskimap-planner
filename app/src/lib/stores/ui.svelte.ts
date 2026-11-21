// Which sheet is open (Route · Saved · Map) and at which detent, the toast, and short-lived map feedback that
// the sheets ask for (highlighted steps, the profile cursor, "zoom to this part").
export type SheetId = 'route' | 'saved' | 'map';
export type Detent = 'medium' | 'large';
/** Sub-pages of the Route sheet */
export type RoutePage = 'main' | 'settings' | 'speeds';
/** Pages of the settings menu (spec §3.5) */
export type MenuPage = 'root' | 'resort' | 'data' | 'backup' | 'appearance' | 'gpx' | 'about';

export interface ToastData {
  text: string;
  action?: { label: string; run: () => void };
}

type Line = readonly (readonly [number, number, number?])[];

export class UiState {
  sheet = $state<SheetId | null>(null);
  detent = $state<Detent>('medium');
  /** top of the open sheet in px once it has settled (map padding follows it); null when closed */
  sheetTop = $state<number | null>(null);
  routePage = $state<RoutePage>('main');
  /** Saved sheet: Edit mode (delete buttons before each row) */
  savedEdit = $state(false);
  toast = $state.raw<ToastData | null>(null);
  /** route steps highlighted on the map (hovered leg or step) */
  highlight = $state.raw<Line[] | null>(null);
  /** [lon, lat] of the point under the finger/mouse on the gradient profile */
  profileCursor = $state.raw<[number, number] | null>(null);
  /** asks the map to show these coordinates (id changes every time) */
  fitRequest = $state.raw<{ id: number; coords: Line; maxZoom?: number; onlyIfHidden?: boolean; keepZoom?: boolean } | null>(null);
  /** panel layout: floating left panel instead of sheets and tab bar. Desktop (≥ 900 px wide) and the landscape
   * phone (height < 500, spec §3.10) */
  wide = $state(false);
  /** landscape phone: panel layout with touch-sized map buttons (spec §3.10) */
  landscape = $state(false);
  /** desktop: the left panel is hidden (panel button in the map toolbar) */
  panelHidden = $state(false);
  /** iPhone: the search field above the keyboard is open */
  searchOpen = $state(false);
  /** asks the desktop search field to take the focus (⌘K); id changes every time */
  focusSearch = $state(0);
  menuOpen = $state(false);
  menuPage = $state<MenuPage>('root');
  /** map bearing / pitch (compass button) */
  bearing = $state(0);
  pitch = $state(0);
  /** route point row to flash in the Route sheet (iPhone: tap on a marker) */
  flashPoint = $state.raw<{ index: number; id: number } | null>(null);
  private toastTimer: ReturnType<typeof setTimeout> | null = null;
  private highlightTimer: ReturnType<typeof setTimeout> | null = null;
  private seq = 0;

  /** Tab tap: opens its sheet, or closes it when it is already open (spec §4.2). Another tab keeps the detent. */
  toggleSheet(id: SheetId): void {
    if (this.sheet === id) this.closeSheet();
    else this.openSheet(id);
  }

  openSheet(id: SheetId, detent?: Detent): void {
    if (this.sheet !== id && id === 'route') this.routePage = 'main';
    this.sheet = id;
    if (detent) this.detent = detent;
  }

  closeSheet(): void {
    this.sheet = null;
    this.sheetTop = null;
    this.detent = 'medium';
  }

  showToast(text: string, options: { ms?: number; action?: ToastData['action'] } = {}): void {
    this.toast = { text, action: options.action };
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => (this.toast = null), options.ms ?? (options.action ? 6000 : 3000));
  }

  hideToast(): void {
    this.toast = null;
  }

  /** Highlight lines on the map; `ms` removes it again after a while (tap on a step). */
  setHighlight(lines: Line[] | null, ms?: number): void {
    if (this.highlightTimer) clearTimeout(this.highlightTimer);
    this.highlightTimer = null;
    this.highlight = lines;
    if (lines && ms) this.highlightTimer = setTimeout(() => (this.highlight = null), ms);
  }

  /** Shows these coordinates on the map. `onlyIfHidden`: only when they are (partly) hidden; `maxZoom`: zoom limit;
   * `keepZoom`: never zoom in (only pan, or zoom out when needed). */
  fitTo(coords: Line, options: { maxZoom?: number; onlyIfHidden?: boolean; keepZoom?: boolean } = {}): void {
    if (coords.length) this.fitRequest = { id: ++this.seq, coords, ...options };
  }

  openMenu(page: MenuPage = 'root'): void {
    this.menuPage = page;
    this.menuOpen = true;
  }

  closeMenu(): void {
    this.menuOpen = false;
    this.menuPage = 'root';
  }

  flash(index: number): void {
    this.flashPoint = { index, id: ++this.seq };
  }
}

/**
 * Where toasts (and the update prompt) appear. Normally under the top row of map buttons. On the phone, a menu or a
 * sheet at the large detent covers the top of the screen with its title, so they go above the tab bar instead.
 */
export function toastPlacement(s: { wide: boolean; menuOpen: boolean; sheetOpen: boolean; detent: Detent }): 'top' | 'low' {
  if (s.wide) return 'top';
  return s.menuOpen || (s.sheetOpen && s.detent === 'large') ? 'low' : 'top';
}

/**
 * Which layout a window gets (spec §3.10, §3.11): desktop panel from 900 px wide; a phone on its side (height < 500,
 * wider than high, any width) gets the left panel, with touch-sized map buttons; everything else the iPhone layout.
 */
export function layoutFor(width: number, height: number): { wide: boolean; landscape: boolean } {
  // height first: a big iPhone on its side is 932 × 430 and must get the landscape layout too
  const landscape = height < 500 && width > height;
  return { wide: width >= 900 || landscape, landscape };
}
