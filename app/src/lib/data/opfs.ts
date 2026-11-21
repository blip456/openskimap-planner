// StorageDir over the Origin Private File System. Used on the main thread (reading) and in the import worker
// (writing). In a dedicated worker, files are written with a FileSystemSyncAccessHandle: the API iOS Safari
// supports best (createWritable only arrived in Safari 26). Elsewhere it falls back to createWritable.
import type { FileWriter, StorageDir } from './storage.ts';

/**
 * The parts of FileSystemSyncAccessHandle we use (the type is only in the WebWorker lib). Safari before 16.4
 * returned promises from these methods, so the writer awaits them (awaiting a plain value costs nothing).
 */
interface SyncAccessHandle {
  write(buffer: BufferSource, options?: { at?: number }): number | Promise<number>;
  truncate(size: number): void | Promise<void>;
  flush(): void | Promise<void>;
  close(): void | Promise<void>;
}
type SyncCapableHandle = FileSystemFileHandle & { createSyncAccessHandle?: () => Promise<SyncAccessHandle> };

/** Which write API this context uses; reported in the import result (useful when testing on the iPhone). */
export type WriteMode = 'sync-access-handle' | 'writable-stream';

export class OpfsDir implements StorageDir {
  readonly handle: FileSystemDirectoryHandle;
  readonly preferSync: boolean;

  constructor(handle: FileSystemDirectoryHandle, preferSync = true) {
    this.handle = handle;
    this.preferSync = preferSync;
  }

  get name(): string {
    return this.handle.name;
  }

  async dir(name: string, create = false): Promise<StorageDir | null> {
    try {
      return new OpfsDir(await this.handle.getDirectoryHandle(name, { create }), this.preferSync);
    } catch (err) {
      if (!create && err instanceof DOMException && (err.name === 'NotFoundError' || err.name === 'TypeMismatchError')) return null;
      throw err;
    }
  }

  async file(name: string): Promise<File | null> {
    try {
      return await (await this.handle.getFileHandle(name)).getFile();
    } catch (err) {
      if (err instanceof DOMException && (err.name === 'NotFoundError' || err.name === 'TypeMismatchError')) return null;
      throw err;
    }
  }

  writeMode(fh?: FileSystemFileHandle): WriteMode {
    const probe = (fh ?? FileSystemFileHandle.prototype) as SyncCapableHandle;
    return this.preferSync && typeof probe.createSyncAccessHandle === 'function' ? 'sync-access-handle' : 'writable-stream';
  }

  async createWriter(name: string): Promise<FileWriter> {
    const fh = (await this.handle.getFileHandle(name, { create: true })) as SyncCapableHandle;
    if (this.writeMode(fh) === 'sync-access-handle') {
      const access = await fh.createSyncAccessHandle!();
      await access.truncate(0);
      let at = 0;
      return {
        write: async (chunk) => {
          let done = 0;
          // write() may write fewer bytes than asked; loop until the chunk is written
          while (done < chunk.length) {
            const n = await access.write(chunk.subarray(done) as Uint8Array<ArrayBuffer>, { at: at + done });
            if (n <= 0) throw new Error('Could not write to the storage (disk full?)');
            done += n;
          }
          at += chunk.length;
        },
        close: async () => {
          await access.flush();
          await access.close();
        },
        abort: async () => void (await access.close()),
      };
    }
    const stream = await fh.createWritable({ keepExistingData: false });
    return {
      write: (chunk) => stream.write(chunk as Uint8Array<ArrayBuffer>),
      close: () => stream.close(),
      abort: () => stream.abort(),
    };
  }

  async list() {
    const out: { name: string; kind: 'file' | 'directory' }[] = [];
    // entries() is async-iterable in all browsers with OPFS; the DOM lib does not type it in every TS version
    const iter = (this.handle as unknown as { entries(): AsyncIterable<[string, FileSystemHandle]> }).entries();
    for await (const [name, h] of iter) out.push({ name, kind: h.kind });
    return out;
  }

  async remove(name: string): Promise<void> {
    try {
      await this.handle.removeEntry(name, { recursive: true });
    } catch (err) {
      if (err instanceof DOMException && err.name === 'NotFoundError') return;
      throw err;
    }
  }
}

export function hasOpfs(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.storage?.getDirectory === 'function';
}

/** Root folder of the app data inside OPFS. */
export async function opfsDataRoot(preferSync = true): Promise<OpfsDir> {
  const root = await navigator.storage.getDirectory();
  return new OpfsDir(await root.getDirectoryHandle('openskimap', { create: true }), preferSync);
}
