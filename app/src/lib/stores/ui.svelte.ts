// Which sheet is open (Route · Saved · Map), and the transient toast.
export type SheetId = 'route' | 'saved' | 'map';

export class UiState {
  sheet = $state<SheetId | null>(null);
  toast = $state<string | null>(null);
  private toastTimer: ReturnType<typeof setTimeout> | null = null;

  /** Tab tap: opens its sheet, or closes it when it is already open (spec §4.2). */
  toggleSheet(id: SheetId): void {
    this.sheet = this.sheet === id ? null : id;
  }

  openSheet(id: SheetId): void {
    this.sheet = id;
  }

  closeSheet(): void {
    this.sheet = null;
  }

  showToast(text: string, ms = 3000): void {
    this.toast = text;
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => (this.toast = null), ms);
  }
}
