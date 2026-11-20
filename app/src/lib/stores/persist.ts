// Tiny localStorage helper (no-op where storage is missing, e.g. in unit tests).
export interface KeyValue {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function defaultStorage(): KeyValue | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null; // blocked storage (private mode, sandbox)
  }
}

export function loadJson<T extends object>(kv: KeyValue | null, key: string, fallback: T): T {
  try {
    const raw = kv?.getItem(key);
    return raw ? { ...fallback, ...(JSON.parse(raw) as Partial<T>) } : fallback;
  } catch {
    return fallback;
  }
}

export function saveJson(kv: KeyValue | null, key: string, value: unknown): void {
  try {
    kv?.setItem(key, JSON.stringify(value));
  } catch {
    // full or blocked: settings are not essential
  }
}
