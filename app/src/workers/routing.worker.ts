// Routing worker: all route, search and info-card work happens here, off the main thread.
import { expose } from '../lib/rpc/rpc.ts';
import { RoutingEngine } from '../lib/worker/engine.ts';

const engine = new RoutingEngine();
expose(engine, self);
