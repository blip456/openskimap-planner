import fs from 'node:fs';
import { PMTiles } from 'pmtiles';

class FileSource {
  constructor(file) {
    this.file = file;
    this.handle = null;
  }

  getKey() {
    return this.file;
  }

  async getBytes(offset, length) {
    this.handle ??= await fs.promises.open(this.file, 'r');
    const buf = Buffer.alloc(length);
    const { bytesRead } = await this.handle.read(buf, 0, length, offset);
    return { data: buf.buffer.slice(buf.byteOffset, buf.byteOffset + bytesRead) };
  }

  async close() {
    await this.handle?.close();
    this.handle = null;
  }
}

export function openPMTiles(file) {
  const source = new FileSource(file);
  const archive = new PMTiles(source);
  archive.close = () => source.close();
  return archive;
}
