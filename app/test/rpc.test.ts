import { describe, expect, test } from 'vitest';
import { expose, transfer, wrap, RpcError } from '../src/lib/rpc/rpc.ts';

class NamedError extends Error {
  override name = 'RouteError';
  code = 'NO_ROUTE';
}

interface TestApi {
  add(a: number, b: number): number;
  slow(ms: number): Promise<string>;
  fail(): never;
  bytes(n: number): Uint8Array;
  sum(buf: ArrayBuffer): number;
  progress(n: number): Promise<number>;
}
interface TestEvents {
  tick: number;
}

function setup() {
  const { port1, port2 } = new MessageChannel();
  const server = expose<TestApi, TestEvents>(
    {
      add: (a, b) => a + b,
      slow: (ms) => new Promise((r) => setTimeout(() => r(`waited ${ms}`), ms)),
      fail: () => {
        throw new NamedError('No route for the leg A → B');
      },
      bytes: (n) => {
        const b = new Uint8Array(n).fill(7);
        return transfer(b, [b.buffer]);
      },
      sum: (buf) => new Uint8Array(buf).reduce((s, x) => s + x, 0),
      progress: async (n) => {
        for (let i = 1; i <= n; i++) server.emit('tick', i);
        return n;
      },
    },
    port2 as unknown as Parameters<typeof expose>[1],
  );
  const client = wrap<TestApi, TestEvents>(port1 as unknown as Parameters<typeof wrap>[0]);
  return { client, close: () => (port1.close(), port2.close()) };
}

describe('rpc', () => {
  test('calls with arguments and results; answers are matched to their calls', async () => {
    const { client, close } = setup();
    const [a, b, c] = await Promise.all([client.call('slow', 30), client.call('add', 2, 3), client.call('slow', 1)]);
    expect([a, b, c]).toEqual(['waited 30', 5, 'waited 1']);
    close();
  });

  test('errors keep their name, message and code', async () => {
    const { client, close } = setup();
    const err = await client.call('fail').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RpcError);
    expect((err as RpcError).name).toBe('RouteError');
    expect((err as RpcError).message).toBe('No route for the leg A → B');
    expect((err as RpcError).code).toBe('NO_ROUTE');
    close();
  });

  test('unknown methods are errors', async () => {
    const { client, close } = setup();
    await expect((client.call as (m: string) => Promise<unknown>)('nope')).rejects.toThrow('Unknown method "nope"');
    close();
  });

  test('transferables move in both directions', async () => {
    const { client, close } = setup();
    const out = await client.call('bytes', 4);
    expect(Array.from(out)).toEqual([7, 7, 7, 7]);
    const buf = new Uint8Array([1, 2, 3]).buffer;
    expect(await client.call('sum', transfer(buf, [buf]))).toBe(6);
    expect(buf.byteLength).toBe(0); // detached: it was moved, not copied
    close();
  });

  test('events reach listeners before the result', async () => {
    const { client, close } = setup();
    const ticks: number[] = [];
    const off = client.on('tick', (n) => ticks.push(n));
    expect(await client.call('progress', 3)).toBe(3);
    expect(ticks).toEqual([1, 2, 3]);
    off();
    await client.call('progress', 1);
    expect(ticks).toEqual([1, 2, 3]);
    close();
  });

  test('dispose rejects pending calls', async () => {
    const { client, close } = setup();
    const p = client.call('slow', 50);
    client.dispose('stopped');
    await expect(p).rejects.toThrow('stopped');
    close();
  });
});
