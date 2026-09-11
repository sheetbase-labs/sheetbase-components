import { useEffect } from "react";

/**
 * Host-owned load/save boundary shared by schema graphs, rule lists and search specs.
 * Table presentation already has a specialised adapter; explorer has chart-session state.
 * This generic contract is the common shape those specialised adapters follow.
 */
export interface PersistenceAdapter<T> {
  /** Return a promise when the state must be fetched from a server. */
  load(key: string): T | PromiseLike<T | undefined> | undefined;
  save(key: string, state: T): void | PromiseLike<void>;
}

export function createMemoryAdapter<T>(store: Map<string, T> = new Map()): PersistenceAdapter<T> {
  return {
    load(key) {
      return store.get(key);
    },
    save(key, state) {
      store.set(key, state);
    },
  };
}

export type PersistenceFetchLike = (input: string, init?: RequestInit) => Promise<Pick<Response, "ok" | "status" | "json">>;

/**
 * `GET {baseUrl}?key=` (404 = nothing saved) / `PUT {baseUrl}` with
 * `{ key, state }` — the host-endpoint protocol the table and explorer HTTP
 * adapters already speak. `label` customises the error text.
 */
export function createHttpAdapter<T>(baseUrl: string, fetcher: PersistenceFetchLike = globalThis.fetch.bind(globalThis), label = "Persistence"): PersistenceAdapter<T> {
  return {
    async load(key) {
      const response = await fetcher(`${baseUrl}?key=${encodeURIComponent(key)}`);
      if (response.status === 404) return undefined;
      if (!response.ok) throw new Error(`${label} load failed (${response.status})`);
      return (await response.json()) as T;
    },
    async save(key, state) {
      const response = await fetcher(baseUrl, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ key, state }) });
      if (!response.ok) throw new Error(`${label} save failed (${response.status})`);
    },
  };
}

export function createLocalStorageAdapter<T>(storage?: Storage): PersistenceAdapter<T> {
  const target = storage ?? (typeof localStorage === "undefined" ? undefined : localStorage);
  return {
    load(key) {
      if (!target) return undefined;
      try {
        const value = target.getItem(key);
        return value ? (JSON.parse(value) as T) : undefined;
      } catch {
        return undefined;
      }
    },
    save(key, state) {
      if (!target) return;
      try {
        target.setItem(key, JSON.stringify(state));
      } catch {
        // Persistence is optional; a full quota must never break editing.
      }
    },
  };
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return typeof value === "object" && value !== null && "then" in value && typeof value.then === "function";
}

/** Sync hosts only; async loads should apply later via the controlled `value` path. */
export function loadInitialState<T>(
  key: string | undefined,
  adapter: PersistenceAdapter<T> | undefined,
  fallback: T,
): T {
  if (!key || !adapter) return fallback;
  try {
    const loaded = adapter.load(key);
    if (loaded === undefined || isThenable(loaded)) return fallback;
    return loaded;
  } catch {
    return fallback;
  }
}

/** Idle-scheduled save; never blocks interaction. No-ops without a key or adapter. */
export function useIdleSave<T>(
  key: string | undefined,
  state: T,
  adapter: PersistenceAdapter<T> | undefined,
): void {
  useEffect(() => {
    if (!key || !adapter || typeof window === "undefined") return;
    const save = () => {
      try {
        adapter.save(key, state);
      } catch (error) {
        console.error("Persistence save failed", error);
      }
    };
    if (typeof window.requestIdleCallback === "function") {
      const schedule = window.requestIdleCallback(save, { timeout: 500 });
      return () => window.cancelIdleCallback(schedule);
    }
    const timer = globalThis.setTimeout(save, 0);
    return () => globalThis.clearTimeout(timer);
  }, [adapter, key, state]);
}
