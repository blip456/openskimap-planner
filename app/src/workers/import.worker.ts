// Import worker: copies a data ZIP into OPFS off the main thread (sync access handles are worker-only).
import { expose } from '../lib/rpc/rpc.ts';
import { importPackage } from '../lib/data/import/pipeline.ts';
import { opfsDataRoot } from '../lib/data/opfs.ts';
import type { ImportApi, ImportEvents } from '../lib/data/import/api.ts';

let controller: AbortController | null = null;

const api: ImportApi = {
  async importZip(file) {
    if (controller) throw new Error('An import is already running');
    controller = new AbortController();
    try {
      const root = await opfsDataRoot(true);
      const result = await importPackage(file, root, {
        signal: controller.signal,
        onProgress: (p) => rpc.emit('progress', p),
        estimate: () => navigator.storage.estimate(),
      });
      return { ...result, writeMode: root.writeMode() };
    } finally {
      controller = null;
    }
  },
  cancel() {
    controller?.abort();
  },
};

const rpc = expose<ImportApi, ImportEvents>(api, self);
