import { describe, expect, test } from 'vitest';
import { RoutingEngine } from '../src/lib/worker/engine.ts';
import { buildSearchIndex } from '@core/search.ts';
import miniResort from '../../packages/core/test/fixtures/mini-resort.json';
import { plannerJson } from './helpers.ts';

const blobInput = (text = plannerJson()) => ({ kind: 'blob' as const, blob: new Blob([text]) });

describe('routing engine (worker logic)', () => {
  test('load reports sizes and timings; builds the search index when it is not precomputed', async () => {
    const e = new RoutingEngine();
    const info = await e.load('mini', blobInput());
    expect(info.nodes).toBeGreaterThan(0);
    expect(info.edges).toBeGreaterThan(0);
    expect(info.precomputed).toEqual({ searchIndex: false, skiAreas: false });
    expect(info.timings.totalMs).toBeGreaterThanOrEqual(0);
  });

  test('uses a precomputed search index', async () => {
    const e = new RoutingEngine();
    const withIndex = JSON.stringify({ ...miniResort, searchIndex: buildSearchIndex(miniResort as never) });
    const info = await e.load('mini', blobInput(withIndex));
    expect(info.precomputed.searchIndex).toBe(true);
  });

  test('loads from a URL with the injected fetch', async () => {
    const e = new RoutingEngine({ fetch: async () => new Response(plannerJson()) });
    expect((await e.load('mini', { kind: 'url', url: 'http://x/mini.json' })).name).toBe('Mini resort');
    const bad = new RoutingEngine({ fetch: async () => new Response('nope', { status: 404 }) });
    await expect(bad.load('mini', { kind: 'url', url: 'http://x' })).rejects.toThrow('(404)');
  });

  test('route, search, feature, nearest, ski areas', async () => {
    const e = new RoutingEngine();
    await e.load('mini', blobInput());
    const top: [number, number] = [10, 47.01];
    const bottom: [number, number] = [10.0003, 47.0003];
    const r = e.route([top, bottom]);
    expect(r.summary.distance).toBeGreaterThan(100);
    expect(r.steps.length).toBeGreaterThan(0);
    expect(r.gpx).toMatch(/^<\?xml/);
    expect(e.search('blue').map((h) => h.name)).toContain('1 Blue Valley'); // runs are named with their piste number
    expect(e.search('blue')[0]).not.toHaveProperty('norm');
    expect(e.feature('run-blue')?.type).toBe('run');
    expect(e.feature('nope')).toBeNull();
    const near = e.nearest([10.0001, 47.0101])!;
    expect(near.distance).toBeLessThan(50);
    expect(near.names).toContain('Blue Valley');
    expect(Array.isArray(e.skiAreas().areas)).toBe(true);
  });

  test('route errors carry the router message', async () => {
    const e = new RoutingEngine();
    await e.load('mini', blobInput());
    expect(() => e.route([[10, 47.01], [11, 48]])).toThrow(/from the nearest run or lift/);
  });

  test('calls before load fail clearly', () => {
    expect(() => new RoutingEngine().search('x')).toThrow('No resort loaded');
  });
});
