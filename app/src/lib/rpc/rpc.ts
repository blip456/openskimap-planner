// Tiny typed request/response RPC over postMessage (workers, MessagePorts).
// - errors cross the boundary with their name and message (and `code` when present),
// - values can carry transferables (`transfer(value, [buffer])`), in both directions,
// - the worker side can push events (progress) to the caller with `emit`.

/** Anything with postMessage + message events: Worker, DedicatedWorkerGlobalScope, MessagePort. */
export interface Endpoint {
  postMessage(message: unknown, transfer: Transferable[]): void;
  addEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
  removeEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
  start?: () => void;
}

/**
 * Constraint for an API: every member is a function. Arguments and results must be structured-cloneable.
 * Written as a mapped type so plain interfaces (without an index signature) fit.
 */
// `any[]` (not unknown[]): parameters are contravariant, so only any[] accepts every concrete signature.
export type Api<A> = { [K in keyof A]: (...args: any[]) => unknown };
/** Event name → payload type. */
export type Events<E> = { [K in keyof E]: unknown };

const TRANSFER = Symbol('transfer');
interface WithTransfer<T> {
  [TRANSFER]: true;
  value: T;
  list: Transferable[];
}

/** Wraps a value so its buffers are moved instead of copied. */
export function transfer<T>(value: T, list: Transferable[]): T {
  return { [TRANSFER]: true, value, list } as WithTransfer<T> as unknown as T;
}

function unwrap(v: unknown): { value: unknown; list: Transferable[] } {
  if (v && typeof v === 'object' && TRANSFER in v) {
    const w = v as WithTransfer<unknown>;
    return { value: w.value, list: w.list };
  }
  return { value: v, list: [] };
}

interface CallMsg {
  rpc: 'call';
  id: number;
  method: string;
  args: unknown[];
}
interface ResultMsg {
  rpc: 'result';
  id: number;
  ok: boolean;
  value?: unknown;
  error?: SerializedError;
}
interface EventMsg {
  rpc: 'event';
  name: string;
  data: unknown;
}
type Msg = CallMsg | ResultMsg | EventMsg;

export interface SerializedError {
  name: string;
  message: string;
  code?: string;
  stack?: string;
}

/** Error re-thrown on the calling side; keeps the original name (e.g. "RouteError") and message. */
export class RpcError extends Error {
  code?: string;
  remoteStack?: string;
  constructor(e: SerializedError) {
    super(e.message);
    this.name = e.name;
    this.code = e.code;
    this.remoteStack = e.stack;
  }
}

function serializeError(err: unknown): SerializedError {
  if (err instanceof Error) {
    const code = (err as Error & { code?: unknown }).code;
    return { name: err.name, message: err.message, code: typeof code === 'string' ? code : undefined, stack: err.stack };
  }
  return { name: 'Error', message: String(err) };
}

const isMsg = (d: unknown): d is Msg => typeof d === 'object' && d !== null && 'rpc' in d;

/** Worker side: answers calls with the methods of `api`. Returns `emit` for events and a function to stop. */
export function expose<A extends Api<A>, E extends Events<E> = Record<string, unknown>>(
  api: A,
  endpoint: Endpoint,
): { emit<K extends keyof E & string>(name: K, data: E[K]): void; dispose(): void } {
  const onMessage = async (event: MessageEvent) => {
    const msg = event.data as unknown;
    if (!isMsg(msg) || msg.rpc !== 'call') return;
    const fn = (api as Record<string, unknown>)[msg.method];
    let reply: ResultMsg;
    let list: Transferable[] = [];
    try {
      if (typeof fn !== 'function') throw new Error(`Unknown method "${msg.method}"`);
      const result = await (fn as (...a: unknown[]) => unknown).apply(api, msg.args);
      const u = unwrap(result);
      list = u.list;
      reply = { rpc: 'result', id: msg.id, ok: true, value: u.value };
    } catch (err) {
      reply = { rpc: 'result', id: msg.id, ok: false, error: serializeError(err) };
    }
    endpoint.postMessage(reply, list);
  };
  endpoint.addEventListener('message', onMessage);
  endpoint.start?.();
  return {
    emit(name, data) {
      const u = unwrap(data);
      endpoint.postMessage({ rpc: 'event', name, data: u.value } satisfies EventMsg, u.list);
    },
    dispose: () => endpoint.removeEventListener('message', onMessage),
  };
}

type Result<F> = F extends (...args: never[]) => infer R ? Awaited<R> : never;
type Params<F> = F extends (...args: infer P) => unknown ? P : never;

export interface Client<A extends Api<A>, E extends Events<E> = Record<string, unknown>> {
  call<K extends keyof A & string>(method: K, ...args: Params<A[K]>): Promise<Result<A[K]>>;
  on<K extends keyof E & string>(name: K, listener: (data: E[K]) => void): () => void;
  /** rejects all pending calls (e.g. after terminating the worker) */
  dispose(reason?: string): void;
}

/** Caller side. Arguments may be wrapped with `transfer()`. */
export function wrap<A extends Api<A>, E extends Events<E> = Record<string, unknown>>(endpoint: Endpoint): Client<A, E> {
  let nextId = 1;
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  const listeners = new Map<string, Set<(data: unknown) => void>>();

  const onMessage = (event: MessageEvent) => {
    const msg = event.data as unknown;
    if (!isMsg(msg)) return;
    if (msg.rpc === 'event') {
      for (const l of listeners.get(msg.name) ?? []) l(msg.data);
      return;
    }
    if (msg.rpc !== 'result') return;
    const p = pending.get(msg.id);
    if (!p) return;
    pending.delete(msg.id);
    if (msg.ok) p.resolve(msg.value);
    else p.reject(new RpcError(msg.error ?? { name: 'Error', message: 'Unknown error' }));
  };
  endpoint.addEventListener('message', onMessage);
  endpoint.start?.();

  return {
    call(method, ...args) {
      const id = nextId++;
      const list: Transferable[] = [];
      const plain = (args as unknown[]).map((a) => {
        const u = unwrap(a);
        list.push(...u.list);
        return u.value;
      });
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
        try {
          endpoint.postMessage({ rpc: 'call', id, method, args: plain } satisfies CallMsg, list);
        } catch (err) {
          pending.delete(id);
          reject(err instanceof Error ? err : new Error(String(err)));
        }
      });
    },
    on(name, listener) {
      let set = listeners.get(name);
      if (!set) listeners.set(name, (set = new Set()));
      const l = listener as (data: unknown) => void;
      set.add(l);
      return () => set.delete(l);
    },
    dispose(reason = 'Worker stopped') {
      endpoint.removeEventListener('message', onMessage);
      for (const p of pending.values()) p.reject(new Error(reason));
      pending.clear();
    },
  };
}
