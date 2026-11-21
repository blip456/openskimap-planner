// Which sheet is open (Route · Saved · Map) and at which detent, the toast, and short-lived map feedback that
// the sheets ask for (highlighted steps, the profile cursor, "zoom to this part").
export type SheetId = 'route' | 'saved' | 'map';
export type Detent = 'medium' | 'large';
/** Sub-pages of the Route sheet */
export type RoutePage = 'main' | 'settings' | 'speeds';

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
  fitRequest = $state.raw<{ id: number; coords: Line } | null>(null);
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

  fitTo(coords: Line): void {
    if (coords.length) this.fitRequest = { id: ++this.seq, coords };
  }

  flash(index: number): void {
    this.flashPoint = { index, id: ++this.seq };
  }
}
