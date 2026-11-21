// Storage screen logic (Menu › Data, PWA): the size of each part of the imported data, the browser's storage
// estimate and the "persistent storage" status. Pure functions + a small wrapper around navigator.storage, so it
// can be tested with a fake.
import type { ManifestFile } from '@core/data-package.ts';
import type { ImportErrorCode } from './import/pipeline.ts';

export interface DataPart {
  id: 'basemap' | 'ski' | 'terrain' | 'contours' | 'planner' | 'assets' | 'other';
  label: string;
  bytes: number;
}

const PART_LABELS: Record<DataPart['id'], string> = {
  basemap: 'Base map',
  ski: 'Runs and lifts',
  terrain: 'Terrain (3D, hillshading)',
  contours: 'Contour lines',
  planner: 'Route planner data',
  assets: 'Map fonts and symbols',
  other: 'Other files',
};

function partOf(path: string): DataPart['id'] {
  const tile = /^tiles\/(basemap|ski|terrain|contours)\.pmtiles$/.exec(path);
  if (tile) return tile[1] as DataPart['id'];
  if (path.startsWith('planner/')) return 'planner';
  if (path.startsWith('fonts/') || path.startsWith('sprites/')) return 'assets';
  return 'other';
}

/** Size per part of the data, in a fixed order (map, terrain, runs, …); parts without files are left out. */
export function dataParts(files: readonly Pick<ManifestFile, 'path' | 'size'>[]): DataPart[] {
  const sums = new Map<DataPart['id'], number>();
  for (const f of files) sums.set(partOf(f.path), (sums.get(partOf(f.path)) ?? 0) + f.size);
  const order: DataPart['id'][] = ['basemap', 'terrain', 'ski', 'contours', 'planner', 'assets', 'other'];
  return order.filter((id) => sums.has(id)).map((id) => ({ id, label: PART_LABELS[id], bytes: sums.get(id)! }));
}

/** The parts of navigator.storage we use (StorageManager; a fake in tests). */
export interface StorageApi {
  estimate?: () => Promise<{ usage?: number; quota?: number }>;
  persisted?: () => Promise<boolean>;
  persist?: () => Promise<boolean>;
}

export interface StorageStatus {
  /** bytes used by this site (all storage, not only the data), null when unknown */
  usage: number | null;
  /** bytes this site may use, null when unknown */
  quota: number | null;
  /** true: the browser will not delete the data on its own; null: the browser cannot tell */
  persisted: boolean | null;
}

export function storageApi(): StorageApi | null {
  return typeof navigator !== 'undefined' && navigator.storage ? navigator.storage : null;
}

export async function readStorageStatus(api: StorageApi | null = storageApi()): Promise<StorageStatus> {
  const out: StorageStatus = { usage: null, quota: null, persisted: null };
  if (!api) return out;
  try {
    const e = await api.estimate?.();
    if (e) {
      out.usage = typeof e.usage === 'number' ? e.usage : null;
      out.quota = typeof e.quota === 'number' ? e.quota : null;
    }
  } catch {
    // unknown
  }
  try {
    if (api.persisted) out.persisted = await api.persisted();
  } catch {
    out.persisted = null;
  }
  return out;
}

/** Asks the browser to keep the data (navigator.storage.persist). Returns the new state (null: not supported). */
export async function requestPersist(api: StorageApi | null = storageApi()): Promise<boolean | null> {
  if (!api?.persist) return null;
  try {
    if (api.persisted && (await api.persisted())) return true;
    return await api.persist();
  } catch {
    return false;
  }
}

/** Free space, or null when unknown. */
export const freeBytes = (s: StorageStatus): number | null => (s.usage != null && s.quota != null ? Math.max(0, s.quota - s.usage) : null);

/** Share of the quota in use, 0…1 (null when unknown). */
export const usedShare = (s: StorageStatus): number | null => (s.usage != null && s.quota ? Math.min(1, s.usage / s.quota) : null);

/** Plain-English text for the protection row and its footer. */
export function persistText(persisted: boolean | null): { value: string; note: string } {
  if (persisted === true) return { value: 'On', note: 'The browser keeps this data. It is only removed when you delete it or remove the app.' };
  if (persisted === false) {
    return {
      value: 'Off',
      note:
        'If the iPhone runs low on space, iOS may delete this data. You can import the file again then. ' +
        'Tip: add the app to the Home Screen and open it from there; iOS keeps the data of Home Screen apps.',
    };
  }
  return { value: 'Unknown', note: 'This browser does not say if it keeps the data.' };
}

/** A user-facing import error: title + message (the message comes from the import worker). */
export interface ImportFailure {
  code: ImportErrorCode;
  message: string;
}

export function importFailureTitle(code: ImportErrorCode): string {
  switch (code) {
    case 'not-data':
      return 'Wrong file';
    case 'damaged':
      return 'The file is damaged';
    case 'no-space':
      return 'Not enough space';
    default:
      return 'Import failed';
  }
}

/** Turns anything the import threw (an RpcError keeps name, message and code) into an ImportFailure. */
export function toImportFailure(err: unknown): ImportFailure {
  const e = (err ?? {}) as { name?: string; message?: string; code?: unknown };
  const message = typeof e.message === 'string' && e.message ? e.message : String(err);
  const known: ImportErrorCode[] = ['not-data', 'damaged', 'no-space', 'other'];
  if (e.name === 'ImportError' && known.includes(e.code as ImportErrorCode)) return { code: e.code as ImportErrorCode, message };
  if (e.name === 'QuotaExceededError' || e.code === 22) return { code: 'no-space', message: 'Not enough space. Free some space and try again.' };
  return { code: 'other', message };
}
