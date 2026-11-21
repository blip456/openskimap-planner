import { describe, expect, test } from 'vitest';
import { importPackage, ImportCancelled, ImportError, type ImportProgress } from '../src/lib/data/import/pipeline.ts';
import { MemoryDir, readPath } from '../src/lib/data/storage.ts';
import { findActivePackage, listPackageDirs } from '../src/lib/data/package-store.ts';
import { openLocalDataSource } from '../src/lib/data/local.ts';
import { loadLocalAsset } from '../src/lib/map/local-assets.ts';
import { buildMapStyle } from '../src/lib/map/style.ts';
import { plannerJson, testZip } from './helpers.ts';

let clock = 1_000_000;
const now = () => ++clock;

async function freshImport(root = new MemoryDir()) {
  const result = await importPackage(testZip(), root, { now });
  return { root, result };
}

describe('import pipeline', () => {
  test('copies every file, checks it, and makes the package active', async () => {
    const progress: ImportProgress[] = [];
    const root = new MemoryDir();
    const result = await importPackage(testZip({ tileSize: 5000 }), root, { now, chunkSize: 1024, onProgress: (p) => progress.push(p) });
    expect(result.manifest.resorts[0].id).toBe('mini');
    const active = await findActivePackage(root);
    expect(active?.name).toBe(result.packageName);
    expect(await (await readPath(active!.dir, 'planner/mini.json'))!.text()).toBe(plannerJson());
    expect((await readPath(active!.dir, 'tiles/basemap.pmtiles'))!.size).toBe(5000);
    expect(await (await readPath(active!.dir, 'fonts/Noto Sans Regular/0-255.pbf'))!.text()).toBe('glyphs-regular');
    // progress: checking → copying (growing) → finishing
    expect(progress[0].phase).toBe('checking');
    expect(progress.at(-1)!.phase).toBe('finishing');
    const copied = progress.filter((p) => p.phase === 'copying').map((p) => p.bytesDone);
    expect(copied).toEqual([...copied].sort((a, b) => a - b));
    expect(progress.at(-1)!.bytesDone).toBe(progress.at(-1)!.bytesTotal);
  });

  test('a second import replaces the first and removes the old folder', async () => {
    const { root, result: first } = await freshImport();
    const second = await importPackage(testZip(), root, { now });
    expect(second.packageName > first.packageName).toBe(true);
    expect(await listPackageDirs(root)).toEqual([second.packageName]);
  });

  test('a damaged file stops the import and keeps the old data', async () => {
    const { root, result: first } = await freshImport();
    const err = await importPackage(testZip({ corrupt: 'tiles/ski.pmtiles' }), root, { now }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ImportError);
    expect((err as Error).message).toBe('The file is damaged (tiles/ski.pmtiles). Build it again and try again.');
    expect((await findActivePackage(root))?.name).toBe(first.packageName);
    expect(await listPackageDirs(root)).toEqual([first.packageName]);
  });

  test('a write error (disk full) keeps the old data', async () => {
    const { root, result: first } = await freshImport();
    root.failAfterBytes = 100;
    // the simulated "disk full" write error becomes a clear "not enough space" error (phase 5)
    const err = await importPackage(testZip({ tileSize: 5000 }), root, { now }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ImportError);
    expect((err as ImportError).code).toBe('no-space');
    expect((err as Error).message).toMatch(/^Not enough space/);
    root.failAfterBytes = null;
    expect((await findActivePackage(root))?.name).toBe(first.packageName);
    expect(await listPackageDirs(root)).toEqual([first.packageName]);
  });

  test('cancel keeps the old data', async () => {
    const { root, result: first } = await freshImport();
    const controller = new AbortController();
    const p = importPackage(testZip({ tileSize: 20000 }), root, {
      now,
      chunkSize: 1000,
      signal: controller.signal,
      onProgress: (pr) => {
        if (pr.bytesDone > 3000) controller.abort();
      },
    });
    await expect(p).rejects.toBeInstanceOf(ImportCancelled);
    expect((await findActivePackage(root))?.name).toBe(first.packageName);
  });

  test('an interrupted import (no marker) is never used and is cleaned up by the next import', async () => {
    const { root, result: first } = await freshImport();
    const broken = (await root.dir('pkg-99999999999999', true))!;
    await (await broken.createWriter('manifest.json')).close();
    expect((await findActivePackage(root))?.name).toBe(first.packageName);
    // the unfinished folder is removed before the new import starts, so the name can be reused
    const next = await importPackage(testZip(), root, { now: () => 99999999999999 });
    expect(await listPackageDirs(root)).toEqual([next.packageName]);
    expect((await findActivePackage(root))?.name).toBe(next.packageName);
  });

  test('clear messages for wrong files', async () => {
    const root = new MemoryDir();
    await expect(importPackage(new Blob(['hello, not a zip at all, just text']), root)).rejects.toThrow('This is not a data file for this app.');
    await expect(importPackage(testZip({ formatVersion: 99 }), root)).rejects.toThrow(/format 99/);
    await expect(importPackage(testZip({ omit: 'tiles/ski.pmtiles' }), root)).rejects.toThrow(/incomplete.*tiles\/ski\.pmtiles/);
    expect(await listPackageDirs(root)).toEqual([]);
  });

  test('not enough space is reported before copying', async () => {
    const root = new MemoryDir();
    await expect(importPackage(testZip({ tileSize: 3 * 1048576 }), root, { estimate: async () => ({ quota: 1048576, usage: 0 }) })).rejects.toThrow(
      /Not enough space\. Free \d+ MB and try again\./,
    );
    expect(await listPackageDirs(root)).toEqual([]);
  });
});

describe('local data source', () => {
  test('opens the imported package', async () => {
    const { root } = await freshImport();
    const ds = (await openLocalDataSource(root))!;
    expect(ds.info.resorts.map((r) => r.id)).toEqual(['mini']);
    expect(ds.info.language).toBe('de');
    expect(ds.info.tiles).toEqual(['ski', 'basemap', 'terrain']); // no contours in the test ZIP
    const input = await ds.plannerData('mini');
    expect(input.kind).toBe('blob');
    expect(input.kind === 'blob' && (await input.blob.text())).toBe(plannerJson());
    const src = ds.pmtilesSource('basemap')!;
    expect(src.getKey()).toBe('basemap');
    const bytes = await src.getBytes(0, 7);
    expect(new TextDecoder().decode(bytes.data)).toBe('PMTiles');
    expect(ds.pmtilesSource('contours')).toBeNull();
  });

  test('no data → null', async () => {
    expect(await openLocalDataSource(new MemoryDir())).toBeNull();
  });

  test('localdata:// fonts and sprites; missing glyph ranges are empty', async () => {
    const { root } = await freshImport();
    const ds = (await openLocalDataSource(root))!;
    const font = (await loadLocalAsset(ds, 'localdata://fonts/Noto%20Sans%20Medium/0-255.pbf', 'arrayBuffer')) as ArrayBuffer;
    expect(new TextDecoder().decode(font)).toBe('glyphs-medium');
    const stack = (await loadLocalAsset(ds, 'localdata://fonts/Noto Sans Bold,Noto Sans Regular/0-255.pbf', 'arrayBuffer')) as ArrayBuffer;
    expect(new TextDecoder().decode(stack)).toBe('glyphs-regular');
    expect(((await loadLocalAsset(ds, 'localdata://fonts/Noto Sans Medium/8192-8447.pbf', 'arrayBuffer')) as ArrayBuffer).byteLength).toBe(0);
    expect(await loadLocalAsset(ds, 'localdata://sprites/light.json', 'json')).toEqual({ icon: { x: 0, y: 0, width: 1, height: 1, pixelRatio: 1 } });
    await expect(loadLocalAsset(ds, 'localdata://sprites/light@2x.png', 'image')).rejects.toThrow(/not found/);
    await expect(loadLocalAsset(ds, 'localdata://planner/mini.json', 'json')).rejects.toThrow(/not found/);
    await expect(loadLocalAsset(ds, 'localdata://sprites/../planner/mini.json', 'json')).rejects.toThrow(/not found/);
  });

  test('the map style points at pmtiles://<name> and the local fonts and sprite', async () => {
    const { root } = await freshImport();
    const ds = (await openLocalDataSource(root))!;
    const style = buildMapStyle(ds, ds.info.resorts[0]);
    const urls = Object.values(style.sources).map((s) => ('url' in s ? s.url : null));
    expect(urls).toEqual(['pmtiles://basemap', 'pmtiles://ski', 'pmtiles://terrain']);
    expect(style.glyphs).toBe('localdata://fonts/{fontstack}/{range}.pbf');
    expect(style.sprite).toBe('localdata://sprites/light');
    expect(style.layers.some((l) => l.type === 'hillshade')).toBe(true);
    expect(style.layers.some((l) => l.id.startsWith('contours'))).toBe(false);
  });
});
