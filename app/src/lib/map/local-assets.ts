// localdata:// requests (fonts and sprites from the imported data). No MapLibre import: unit-tested in Node.
import type { DataSource } from '../data/types.ts';
import { LOCAL_PROTOCOL } from '../data/local.ts';

/** Resolves a localdata:// request to bytes. Missing glyph ranges get an empty answer (the ZIP only has the
 * ranges the labels need), so MapLibre draws no glyphs there instead of logging errors. */
export async function loadLocalAsset(ds: DataSource | null, url: string, type: string | undefined): Promise<ArrayBuffer | object | string> {
  const path = decodeURIComponent(url.slice(`${LOCAL_PROTOCOL}://`.length).split(/[?#]/)[0]);
  const isFont = path.startsWith('fonts/');
  let blob: Blob | null = null;
  if (ds?.readAsset) {
    if (isFont) {
      // "fonts/A,B/0-255.pbf": use the first stack that exists
      const m = path.match(/^fonts\/(.+)\/(\d+-\d+\.pbf)$/);
      for (const stack of m ? m[1].split(',') : []) {
        blob = await ds.readAsset(`fonts/${stack.trim()}/${m![2]}`);
        if (blob) break;
      }
    } else {
      blob = await ds.readAsset(path);
    }
  }
  if (!blob) {
    if (isFont) return new ArrayBuffer(0);
    throw new Error(`${url} not found in the imported data`);
  }
  if (type === 'json') return JSON.parse(await blob.text()) as object;
  if (type === 'string') return blob.text();
  return blob.arrayBuffer();
}

