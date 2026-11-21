// Main-thread side of the routing worker.
import { wrap, type Client } from '../rpc/rpc.ts';
import type { RoutingApi } from './engine.ts';

export type RoutingClient = Client<RoutingApi>;

export function startRoutingWorker(): { client: RoutingClient; terminate(): void } {
  const worker = new Worker(new URL('../../workers/routing.worker.ts', import.meta.url), { type: 'module', name: 'routing' });
  const client = wrap<RoutingApi>(worker);
  return {
    client,
    terminate() {
      client.dispose();
      worker.terminate();
    },
  };
}
