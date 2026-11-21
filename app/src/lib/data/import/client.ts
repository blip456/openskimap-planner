// Main-thread side of the import worker.
import { wrap, type Client } from '../../rpc/rpc.ts';
import type { ImportApi, ImportEvents } from './api.ts';
import type { ImportProgress } from './pipeline.ts';

export function startImport(file: Blob, onProgress: (p: ImportProgress) => void) {
  const worker = new Worker(new URL('../../../workers/import.worker.ts', import.meta.url), { type: 'module', name: 'import' });
  const client: Client<ImportApi, ImportEvents> = wrap(worker);
  const off = client.on('progress', onProgress);
  const done = client.call('importZip', file).finally(() => {
    off();
    client.dispose();
    worker.terminate();
  });
  return { done, cancel: () => void client.call('cancel').catch(() => {}) };
}
