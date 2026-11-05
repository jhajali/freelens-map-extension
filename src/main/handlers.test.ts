import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BASELINE, CIDRS, SUBSCRIBE, UNSUBSCRIBE } from "../common/ipc";
import { type Collectors } from "./collector";
import { registerHandlers } from "./handlers";
import { MapStore } from "./store";

import type { FlowsResult } from "../common/graph/flows";
import type { SubscribeRequest } from "../common/ipc";

const flows = (n: number, edges: unknown[] = []) => ({ edges, n }) as unknown as FlowsResult;

let dir: string;
let store: MapStore;
let handlers: Map<string, (event: unknown, ...args: any[]) => unknown>;
const ipc = { handle: (channel: string, fn: (event: unknown, ...args: any[]) => unknown) => handlers.set(channel, fn) };
const call = (channel: string, ...args: unknown[]) => handlers.get(channel)?.({}, ...args);

const fake = (over: Partial<Record<keyof Collectors, unknown>> = {}) =>
  ({
    subscribe: vi.fn(() => ({ id: "hubble", ok: true, detail: "live", fix: null })),
    unsubscribe: vi.fn(),
    current: () => null,
    first: () => null,
    running: () => [],
    status: () => ({ id: "hubble", ok: true, detail: "live", fix: null }),
    ...over,
  }) as unknown as Collectors;

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  dir = await mkdtemp(join(tmpdir(), "handlers-"));
  store = new MapStore(dir);
  handlers = new Map();
});

afterEach(async () => {
  vi.useRealTimers();
  await rm(dir, { recursive: true, force: true });
});

describe("registerHandlers", () => {
  it("forwards subscribe and unsubscribe", () => {
    const c = fake();
    registerHandlers(ipc, c, Promise.resolve(store));
    const req = { clusterId: "c1", subscriber: "s" } as SubscribeRequest;
    expect(call(SUBSCRIBE, req)).toMatchObject({ id: "hubble", ok: true });
    call(UNSUBSCRIBE, "c1", "s");
    expect(c.unsubscribe).toHaveBeenCalledWith("c1", "s");
  });

  it("answers the baseline from disk first, then from the session's first tick", async () => {
    const first = flows(1);
    registerHandlers(ipc, fake({ first: (id: string) => (id === "c1" ? first : null) }), Promise.resolve(store));
    expect(await call(BASELINE, "c1")).toEqual({ flows: first, source: "since-opened" });
    await store.saveSnapshot("c1", flows(2));
    expect(await call(BASELINE, "c1")).toEqual({ flows: flows(2), source: "snapshot" });
    expect(await call(BASELINE, "c2")).toBeNull();
  });

  it("saves a snapshot of every running cluster on the timer", async () => {
    const cur: Record<string, FlowsResult | null> = { a: flows(1, [{}]), b: flows(2, [{}]), c: null };
    registerHandlers(
      ipc,
      fake({ running: () => ["a", "b", "c"], current: (id: string) => cur[id] }),
      Promise.resolve(store),
    );
    await vi.advanceTimersByTimeAsync(300_000);
    await vi.waitFor(async () => {
      expect(await readdir(join(dir, "a", "snapshots"))).toHaveLength(1);
      expect(await readdir(join(dir, "b", "snapshots"))).toHaveLength(1);
    });
    await expect(readdir(join(dir, "c"))).rejects.toThrow();
  });

  it("saves no snapshot of a cluster with no link or no live Hubble", async () => {
    const cur: Record<string, FlowsResult> = { a: flows(1), b: flows(2, [{}]) };
    registerHandlers(
      ipc,
      fake({
        running: () => ["a", "b"],
        current: (id: string) => cur[id],
        status: (id: string) => ({ id: "hubble", ok: id !== "b", detail: "x", fix: null }),
      }),
      Promise.resolve(store),
    );
    const save = vi.spyOn(store, "saveSnapshot");
    await vi.advanceTimersByTimeAsync(300_000);
    expect(save).not.toHaveBeenCalled();
    await expect(readdir(dir)).resolves.toEqual([]);
  });

  it("answers subscribe while the store is still pending", async () => {
    registerHandlers(ipc, fake(), new Promise(() => {}));
    expect(call(SUBSCRIBE, { clusterId: "c1", subscriber: "s" })).toMatchObject({ ok: true });
  });

  it("logs a failed snapshot and keeps the timer running", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const failing = { saveSnapshot: vi.fn().mockRejectedValue(new Error("disk full")) } as unknown as MapStore;
    registerHandlers(ipc, fake({ running: () => ["a"], current: () => flows(1, [{}]) }), Promise.resolve(failing));
    await vi.advanceTimersByTimeAsync(600_000);
    expect(failing.saveSnapshot).toHaveBeenCalledTimes(2);
    expect(err).toHaveBeenCalledWith(expect.stringContaining("[service-map] snapshot for a failed: Error: disk full"));
    err.mockRestore();
  });

  it("stops the timer when disposed", async () => {
    const dispose = registerHandlers(ipc, fake(), Promise.resolve(store));
    dispose();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("returns the merged CIDR cache", async () => {
    registerHandlers(ipc, fake(), Promise.resolve(store));
    await call(CIDRS, "a", ["10.0.0.0/24"]);
    expect(await call(CIDRS, "b", ["10.1.0.0/24"])).toEqual({ a: ["10.0.0.0/24"], b: ["10.1.0.0/24"] });
  });
});
