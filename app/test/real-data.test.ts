// Import + routing worker start on the real data ZIP (build/pwa/*.zip). Skips when `npm run build:pwa-data`
// has not run. Prints the timings (Node; the browser numbers are logged by the app and the smoke tests).
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { importPackage } from '../src/lib/data/import/pipeline.ts';
import { MemoryDir } from '../src/lib/data/storage.ts';
import { openLocalDataSource } from '../src/lib/data/local.ts';
import { RoutingEngine } from '../src/lib/worker/engine.ts';

const dir = path.join(import.meta.dirname, '../../build/pwa');
const zip = fs.existsSync(dir) ? fs.readdirSync(dir).filter((n) => n.endsWith('.zip')).sort().at(-1) : undefined;

describe.skipIf(!zip)('real data ZIP', () => {
  test('imports, checks every SHA-256, and the routing engine starts from it', { timeout: 60_000 }, async () => {
    const file = path.join(dir, zip!);
    const blob = new Blob([fs.readFileSync(file)]);
    const root = new MemoryDir();
    const result = await importPackage(blob, root);
    console.info(`[real data] import of ${zip} (${(result.bytes / 1048576).toFixed(1)} MB) in ${result.ms} ms (Node, in memory)`);
    const ds = (await openLocalDataSource(root))!;
    expect(ds.info.tiles).toContain('terrain');
    const resort = ds.info.resorts[0];
    const engine = new RoutingEngine();
    const info = await engine.load(resort.id, await ds.plannerData(resort.id));
    console.info(`[real data] routing engine start: ${JSON.stringify(info.timings)}`);
    expect(info.precomputed).toEqual({ searchIndex: true, skiAreas: true });
    expect(info.timings.totalMs).toBeLessThan(1000);
    expect(engine.search('Nebelhorn').length).toBeGreaterThan(0);
  });
});
