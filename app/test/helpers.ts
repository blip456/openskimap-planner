// Builds a small data ZIP like `npm run build:pwa-map-data` writes (STORE entries + manifest with SHA-256).
import { makeZip } from '@core/zip.ts';
import { createSha256 } from '@core/sha256.ts';
import miniResort from '../../packages/core/test/fixtures/mini-resort.json';

export const sha256 = (text: string): string => {
  const h = createSha256();
  h.update(new TextEncoder().encode(text));
  return h.digestHex();
};

export interface TestZipOptions {
  /** change the bytes of one file after the manifest is written (checksum mismatch) */
  corrupt?: string;
  /** leave one file out of the ZIP (still in the manifest) */
  omit?: string;
  formatVersion?: number;
  /** bigger tile files, to test chunked copying */
  tileSize?: number;
}

export function plannerJson(): string {
  return JSON.stringify(miniResort);
}

export function testZipFiles(options: TestZipOptions = {}): { name: string; text: string }[] {
  const tile = (n: string) => `PMTiles:${n}:`.padEnd(options.tileSize ?? 64, n[0]);
  const files = [
    { name: 'planner/resorts.json', text: JSON.stringify([{ id: 'mini', name: 'Mini resort', bbox: [9.99, 46.99, 10.11, 47.02], center: [10.05, 47.0] }]) },
    { name: 'planner/mini.json', text: plannerJson() },
    { name: 'tiles/ski.pmtiles', text: tile('ski') },
    { name: 'tiles/basemap.pmtiles', text: tile('basemap') },
    { name: 'tiles/terrain.pmtiles', text: tile('terrain') },
    { name: 'fonts/Noto Sans Regular/0-255.pbf', text: 'glyphs-regular' },
    { name: 'fonts/Noto Sans Medium/0-255.pbf', text: 'glyphs-medium' },
    { name: 'sprites/light.json', text: '{"icon":{"x":0,"y":0,"width":1,"height":1,"pixelRatio":1}}' },
    { name: 'sprites/light.png', text: 'png-bytes' },
  ];
  return files;
}

export function testZip(options: TestZipOptions = {}): Blob {
  const files = testZipFiles(options);
  const manifest = {
    formatVersion: options.formatVersion ?? 1,
    buildDate: '2026-11-20',
    source: {},
    zoom: { terrain: 12, basemap: 12, ski: 16 },
    language: 'de',
    resorts: [{ id: 'mini', name: 'Mini resort', bbox: [9.99, 46.99, 10.11, 47.02], center: [10.05, 47.0], planner: 'planner/mini.json' }],
    files: files.map((f) => ({ path: f.name, size: new TextEncoder().encode(f.text).length, sha256: sha256(f.text) })),
  };
  const entries = files
    .filter((f) => f.name !== options.omit)
    .map((f) => (f.name === options.corrupt ? { ...f, text: f.text.slice(0, -1) + 'X' } : f));
  return makeZip([{ name: 'manifest.json', text: JSON.stringify(manifest) }, ...entries], new Date(2026, 10, 20));
}
