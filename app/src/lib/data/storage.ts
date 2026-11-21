// Small directory abstraction over the browser storage, so the import pipeline and the local data source can be
// unit-tested in Node with the in-memory version. The OPFS version is in opfs.ts.

export interface FileWriter {
  /** appends the bytes */
  write(chunk: Uint8Array): Promise<void>;
  close(): Promise<void>;
  /** closes without keeping a half-written file usable; the caller removes the directory */
  abort(): Promise<void>;
}

export interface StorageDir {
  readonly name: string;
  /** child directory; null when it does not exist and `create` is false */
  dir(name: string, create?: boolean): Promise<StorageDir | null>;
  /** reads a file; null when it does not exist */
  file(name: string): Promise<File | null>;
  /** creates (or truncates) a file and returns a writer */
  createWriter(name: string): Promise<FileWriter>;
  list(): Promise<{ name: string; kind: 'file' | 'directory' }[]>;
  /** removes a file or a directory with everything inside; no error when missing */
  remove(name: string): Promise<void>;
}

/** Splits "a/b/c.pbf" into directories and the file name; rejects unsafe paths. */
export function splitPath(path: string): { dirs: string[]; name: string } {
  const parts = path.split('/');
  if (!path || parts.some((p) => p === '' || p === '.' || p === '..' || p.includes('\\') || p.includes('\0'))) {
    throw new Error(`Unsafe path "${path}"`);
  }
  return { dirs: parts.slice(0, -1), name: parts[parts.length - 1] };
}

async function walk(root: StorageDir, dirs: string[], create: boolean): Promise<StorageDir | null> {
  let d: StorageDir | null = root;
  for (const name of dirs) {
    d = await d.dir(name, create);
    if (!d) return null;
  }
  return d;
}

export async function readPath(root: StorageDir, path: string): Promise<File | null> {
  const { dirs, name } = splitPath(path);
  const d = await walk(root, dirs, false);
  return d ? d.file(name) : null;
}

export async function writerForPath(root: StorageDir, path: string): Promise<FileWriter> {
  const { dirs, name } = splitPath(path);
  const d = await walk(root, dirs, true);
  return d!.createWriter(name);
}

export async function writeSmallFile(root: StorageDir, path: string, data: string | Uint8Array): Promise<void> {
  const w = await writerForPath(root, path);
  await w.write(typeof data === 'string' ? new TextEncoder().encode(data) : data);
  await w.close();
}

// ---------------------------------------------------------------------------
// in-memory implementation (tests, and a fallback when OPFS is missing)

export class MemoryDir implements StorageDir {
  readonly name: string;
  readonly dirs = new Map<string, MemoryDir>();
  readonly files = new Map<string, File>();
  /** for tests: make the next writes fail after this many bytes */
  failAfterBytes: number | null = null;

  constructor(name = '') {
    this.name = name;
  }

  async dir(name: string, create = false): Promise<StorageDir | null> {
    if (this.files.has(name)) throw new Error(`"${name}" is a file`);
    let d = this.dirs.get(name);
    if (!d && create) {
      d = new MemoryDir(name);
      d.failAfterBytes = this.failAfterBytes;
      this.dirs.set(name, d);
    }
    return d ?? null;
  }

  async file(name: string): Promise<File | null> {
    return this.files.get(name) ?? null;
  }

  async createWriter(name: string): Promise<FileWriter> {
    const parts: Uint8Array[] = [];
    let size = 0;
    const limit = this.failAfterBytes;
    return {
      write: async (chunk) => {
        size += chunk.length;
        if (limit !== null && size > limit) throw new Error('Simulated write error (disk full)');
        parts.push(chunk.slice());
      },
      close: async () => {
        this.files.set(name, new File(parts as BlobPart[], name));
      },
      abort: async () => {},
    };
  }

  async list() {
    return [
      ...[...this.dirs.keys()].map((name) => ({ name, kind: 'directory' as const })),
      ...[...this.files.keys()].map((name) => ({ name, kind: 'file' as const })),
    ];
  }

  async remove(name: string): Promise<void> {
    this.dirs.delete(name);
    this.files.delete(name);
  }
}
