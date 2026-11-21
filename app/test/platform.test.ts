import { describe, expect, test } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { mergeServerCapabilities, staticCapabilities } from '../src/lib/platform/index.ts';
import { ServerDataSource } from '../src/lib/data/server.ts';
import { buildMapStyle } from '../src/lib/map/style.ts';
import { RUN_COLORS, LIFT_COLOR, NORDIC_COLOR, CONNECTION_COLOR } from '@core/ski.ts';
import { SLOPE_CLASSES } from '@core/slope.ts';
import { icons } from '../src/ui/icons.ts';

describe('capabilities', () => {
  test('per build target, without device sniffing', () => {
    expect(staticCapabilities('pwa')).toMatchObject({ importData: true, projectFolderRoutes: false, onlineByDefault: false });
    expect(staticCapabilities('desktop')).toMatchObject({ importData: false, onlineByDefault: true });
    const merged = mergeServerCapabilities(staticCapabilities('desktop'), {
      tileServerUrl: 'http://localhost:8080',
      projectFolderRoutes: true,
      googleShortLinks: true,
      data: null,
    });
    expect(merged).toMatchObject({ tileServerUrl: 'http://localhost:8080', projectFolderRoutes: true, googleShortLinks: true, importData: false });
  });
});

describe('server data source', () => {
  const ds = new ServerDataSource(
    {
      resorts: [{ id: 'r', name: 'R', bbox: [10, 47, 10.3, 47.4], center: [10.1, 47.2] }],
      language: 'de',
      tiles: ['basemap', 'ski', 'terrain'],
      zoom: null,
      builtAt: '2026-11-20T10:00:00Z',
    },
    'http://localhost:5173',
  );
  test('URLs on the desktop server', async () => {
    expect(await ds.plannerData('r')).toEqual({ kind: 'url', url: 'http://localhost:5173/data/planner/r.json' });
    await expect(ds.plannerData('../x')).rejects.toThrow(/Invalid resort/);
    expect(ds.pmtilesSource('basemap')?.getKey()).toBe('basemap');
    expect(ds.pmtilesSource('contours')).toBeNull();
    expect(ds.glyphsUrl()).toBe('http://localhost:5173/data/fonts/{fontstack}/{range}.pbf');
    expect(ds.info.buildDate).toBe('2026-11-20');
  });
  test('style: same pmtiles:// names as the PWA', () => {
    const style = buildMapStyle(ds, ds.info.resorts[0], 'slope');
    expect(JSON.stringify(style)).not.toMatch(/\{(basemap|ski|terrain|contours)\}/);
    expect(style.sprite).toBe('http://localhost:5173/data/sprites/light');
    expect(style.layers.some((l) => l.id === 'ski-runs-slope')).toBe(true);
  });
});

describe('design tokens', () => {
  const css = fs.readFileSync(path.join(import.meta.dirname, '../src/ui/tokens.css'), 'utf8');
  const token = (name: string) => css.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`))?.[1].toLowerCase();

  test('the app uses the designer tokens file unchanged', () => {
    expect(css).toBe(fs.readFileSync(path.join(import.meta.dirname, '../../docs/design/tokens.css'), 'utf8'));
  });

  test('piste and map colours match the core', () => {
    for (const [d, color] of Object.entries(RUN_COLORS)) {
      if (d === 'extreme') continue;
      expect(token(`piste-${d}`), d).toBe(color.toLowerCase());
    }
    expect(token('lift')).toBe(LIFT_COLOR);
    expect(token('nordic')).toBe(NORDIC_COLOR);
    expect(token('connection')).toBe(CONNECTION_COLOR);
    const slopeTokens = ['slope-lt10', 'slope-10-25', 'slope-25-40', 'slope-gt40'].map(token);
    expect(slopeTokens).toEqual(SLOPE_CLASSES.map((c) => c.color.toLowerCase()));
  });
});

describe('icons', () => {
  test('every icon import resolves to a component (Lucide renames icons now and then)', () => {
    for (const [name, c] of Object.entries(icons)) expect(typeof c, name).toBe('function');
  });
});

describe('camera helpers', async () => {
  const { coverZoom, boundsOf, allInside } = await import('../src/lib/map/camera.ts');
  test('cover zoom: the bbox fills the view on both sides', () => {
    const bbox: [number, number, number, number] = [10.07804, 47.29991, 10.37744, 47.43978];
    const portrait = coverZoom(bbox, 390, 844);
    const landscape = coverZoom(bbox, 1280, 800);
    // a portrait phone has to zoom in further than a wide window to fill its height
    expect(portrait).toBeGreaterThan(10);
    expect(portrait).toBeLessThan(13);
    expect(landscape).toBeGreaterThan(portrait);
    // one zoom level up doubles the size
    expect(coverZoom(bbox, 780, 1688) - portrait).toBeCloseTo(1, 5);
  });
  test('bounds and inside check', () => {
    expect(boundsOf([[1, 2], [3, -1], [2, 5]])).toEqual([[1, -1], [3, 5]]);
    expect(boundsOf([])).toBeNull();
    const box = { left: 0, top: 0, right: 10, bottom: 10 };
    expect(allInside([{ x: 1, y: 1 }, { x: 10, y: 10 }], box)).toBe(true);
    expect(allInside([{ x: 1, y: 11 }], box)).toBe(false);
  });
});
