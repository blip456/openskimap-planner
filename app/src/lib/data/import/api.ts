// Messages between the app and the import worker.
import type { ImportProgress, ImportResult } from './pipeline.ts';
import type { WriteMode } from '../opfs.ts';

export interface ImportApi {
  /** copies the ZIP into the storage; resolves when the new data is in use */
  importZip(file: Blob): Promise<ImportResult & { writeMode: WriteMode }>;
  /** stops a running import; the old data stays */
  cancel(): void;
}

export interface ImportEvents {
  progress: ImportProgress;
}
