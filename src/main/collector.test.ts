import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadFixture } from "../../test/fixture";
import { flowsToEdges } from "../common/graph/flows";
import { buildInventory } from "../common/graph/inventory";
import { type CollectorDeps, Collectors } from "./collector";
import { ReverseDns } from "./dns";

import type { Tick } from "../common/ipc";

const fx = loadFixture("capture-b");
const inv = buildInventory(fx.objects, fx.metrics);
const ip = {
  self: fx.cluster.self,
  clusterCidrs: fx.cluster.clusterCidrs,
  namedNetworks: [],
  clusterIps: inv.clusterIps,
};
const twoFlows = fx.flows.filter((f) => flowsToEdges([f], inv, ip).edges.length).slice(0, 2);

interface FakeStream {
  target: string;
  opts: object;
  onFlow: (flow: unknown) => void;
  onEnd?: (error?: Error) => void;
  onNodeStatus?: (e: { state: string; nodes: string[]; message: string }) => void;
  cancel: ReturnType<typeof vi.fn>;
}

let ticks: Tick[];
let pfs: Array<{ clusterId: string; close: ReturnType<typeof vi.fn> }>;
let streams: FakeStream[];
let deps: CollectorDeps;
let collectors: Collectors;

const openPortForward = vi.fn<CollectorDeps["openPortForward"]>();

beforeEach(() => {
  vi.useFakeTimers();
  ticks = [];
  pfs = [];
  streams = [];
  openPortForward.mockReset().mockImplementation(async (clusterId) => {
    const pf = { clusterId, localPort: 1, close: vi.fn() };
    pfs.push(pf);
    return pf;
  });
  deps = {
    openPortForward,
    streamFlows: (target, opts, onFlow, onEnd, onNodeStatus) => {
      const cancel = vi.fn();
      streams.push({ target, opts, onFlow, onEnd, onNodeStatus, cancel });
      return cancel;
    },
    dns: new ReverseDns(async () => []),
    broadcast: (tick) => ticks.push(tick),
    now: () => Date.now(),
    setInterval,
    clearInterval,
    setTimeout,
    clearTimeout,
  };
  collectors = new Collectors(deps);
});

afterEach(() => {
  collectors.stopAll();
  vi.useRealTimers();
});

const sub = (clusterId = "c1", subscriber = "s1") => collectors.subscribe({ clusterId, subscriber, inv, ip });

describe("Collectors", () => {
  it("streams, ticks and broadcasts the window's links", async () => {
    expect(sub()).toEqual({ id: "hubble", ok: false, detail: "connecting", fix: null });
    await vi.advanceTimersByTimeAsync(0);
    expect(openPortForward).toHaveBeenCalledWith("c1", "kube-system", "hubble-relay", 80);
    expect(streams[0]?.target).toBe("127.0.0.1:1");
    expect(streams[0]?.opts).toEqual({});
    for (const f of twoFlows) streams[0]?.onFlow(f);
    await vi.advanceTimersByTimeAsync(2500);
    expect(ticks).toHaveLength(1);
    expect(ticks[0]?.clusterId).toBe("c1");
    expect(ticks[0]?.flows?.edges.length).toBeGreaterThan(0);
    expect(ticks[0]?.status).toEqual({ id: "hubble", ok: true, detail: "live", fix: null });
    expect(ticks[0]?.l7).toBe(false);
    expect(collectors.current("c1")).toBe(ticks[0]?.flows);
    expect(collectors.first("c1")).toBe(ticks[0]?.flows);
  });

  it("lists the clusters with a live collector", () => {
    sub("c1");
    sub("c2");
    collectors.unsubscribe("c1", "s1");
    expect(collectors.running()).toEqual(["c2"]);
  });

  it("reports l7 once a flow carried it", async () => {
    sub();
    await vi.advanceTimersByTimeAsync(0);
    streams[0]?.onFlow({ ...(twoFlows[0] as object), l7: { type: "REQUEST" } });
    await vi.advanceTimersByTimeAsync(2500);
    expect(ticks[0]?.l7).toBe(true);
  });

  it("keeps one port-forward per cluster and closes it with the last subscriber", async () => {
    sub("c1", "a");
    sub("c1", "b");
    sub("c2", "a");
    await vi.advanceTimersByTimeAsync(0);
    expect(openPortForward).toHaveBeenCalledTimes(2);
    const [c1, c2] = pfs;
    collectors.unsubscribe("c1", "a");
    expect(c1?.close).not.toHaveBeenCalled();
    collectors.unsubscribe("c1", "b");
    expect(c1?.close).toHaveBeenCalled();
    expect(streams[0]?.cancel).toHaveBeenCalled();
    expect(c2?.close).not.toHaveBeenCalled();
    expect(collectors.current("c1")).toBeNull();
  });

  it("closes a cluster whose subscribers stop renewing their lease", async () => {
    sub();
    await vi.advanceTimersByTimeAsync(175_000);
    expect(pfs[0]?.close).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(pfs[0]?.close).toHaveBeenCalled();
    const n = ticks.length;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(ticks).toHaveLength(n);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps a cluster whose subscriber renews its lease", async () => {
    sub();
    await vi.advanceTimersByTimeAsync(170_000);
    sub();
    await vi.advanceTimersByTimeAsync(170_000);
    expect(pfs[0]?.close).not.toHaveBeenCalled();
  });

  it("reconnects with backoff and keeps the window", async () => {
    sub();
    await vi.advanceTimersByTimeAsync(0);
    for (const f of twoFlows) streams[0]?.onFlow(f);
    await vi.advanceTimersByTimeAsync(2500);
    openPortForward.mockImplementationOnce(() => new Promise(() => {}));
    streams[0]?.onEnd?.(new Error("Connection dropped"));
    expect(pfs[0]?.close).toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1999);
    expect(openPortForward).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(openPortForward).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(500);
    const last = ticks.at(-1);
    expect(last?.status.ok).toBe(false);
    expect(last?.status.detail).toBe("Connection dropped");
    expect(last?.flows?.edges.length).toBeGreaterThan(0);
  });

  it("backs off longer on repeated failures and treats a closed stream as one", async () => {
    sub();
    await vi.advanceTimersByTimeAsync(0);
    streams[0]?.onEnd?.();
    expect(sub().detail).toBe("Relay closed the stream");
    await vi.advanceTimersByTimeAsync(2000);
    expect(openPortForward).toHaveBeenCalledTimes(2);
    streams[1]?.onEnd?.();
    await vi.advanceTimersByTimeAsync(4999);
    expect(openPortForward).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(openPortForward).toHaveBeenCalledTimes(3);
  });

  it("names the missing permission", async () => {
    openPortForward.mockRejectedValue(
      new Error(
        'kubectl port-forward exited with 1: Error from server (Forbidden): pods "hubble-relay-x" is forbidden: User "u" cannot create resource "pods/portforward"',
      ),
    );
    sub();
    await vi.advanceTimersByTimeAsync(2500);
    expect(ticks[0]?.status.ok).toBe(false);
    expect(ticks[0]?.status.detail).toBe("port-forward denied");
    expect(ticks[0]?.status.fix).toContain("pods/portforward");
    expect(sub().fix).toContain("pods/portforward");
  });

  it("explains Relay not found and TLS before any flow", async () => {
    openPortForward.mockRejectedValueOnce(new Error('Error from server (NotFound): services "hubble-relay" not found'));
    sub();
    await vi.advanceTimersByTimeAsync(0);
    expect(sub().detail).toBe("Hubble Relay not found in kube-system");
    await vi.advanceTimersByTimeAsync(2000);
    streams[0]?.onEnd?.(new Error("14 UNAVAILABLE: Protocol error"));
    expect(sub()).toEqual({ id: "hubble", ok: false, detail: "TLS enabled, client certs not readable", fix: null });
  });

  it("survives a stream that throws when it starts", async () => {
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    deps.streamFlows = () => {
      throw new Error("ENOENT: hubble-proto/observer/observer.proto");
    };
    sub();
    await vi.advanceTimersByTimeAsync(0);
    process.off("unhandledRejection", unhandled);
    expect(unhandled).not.toHaveBeenCalled();
    expect(sub()).toEqual({
      id: "hubble",
      ok: false,
      detail: "ENOENT: hubble-proto/observer/observer.proto",
      fix: null,
    });
    expect(pfs[0]?.close).toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2000);
    expect(openPortForward).toHaveBeenCalledTimes(2);
  });

  it("counts the nodes Relay reports unavailable in the status", async () => {
    sub();
    await vi.advanceTimersByTimeAsync(0);
    streams[0]?.onNodeStatus?.({ state: "NODE_UNAVAILABLE", nodes: ["n1", "n2"], message: "" });
    expect(sub()).toEqual({ id: "hubble", ok: true, detail: "live · 2 nodes unavailable", fix: null });
    streams[0]?.onNodeStatus?.({ state: "NODE_CONNECTED", nodes: ["n1"], message: "" });
    expect(sub().detail).toBe("live · 1 nodes unavailable");
    streams[0]?.onNodeStatus?.({ state: "NODE_GONE", nodes: ["n2"], message: "" });
    expect(sub()).toEqual({ id: "hubble", ok: true, detail: "live", fix: null });
  });

  it("restarts the stream, not the port-forward, after NODE_ERROR", async () => {
    sub();
    await vi.advanceTimersByTimeAsync(0);
    streams[0]?.onNodeStatus?.({ state: "NODE_ERROR", nodes: ["n1"], message: "boom" });
    expect(streams[0]?.cancel).toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1999);
    expect(streams).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(streams).toHaveLength(2);
    expect(openPortForward).toHaveBeenCalledOnce();
    expect(pfs[0]?.close).not.toHaveBeenCalled();
  });

  it("restarts a stream that delivers no flow for idleMs", async () => {
    collectors = new Collectors(deps, { idleMs: 10_000 });
    sub();
    await vi.advanceTimersByTimeAsync(0);
    streams[0]?.onFlow(twoFlows[0]);
    await vi.advanceTimersByTimeAsync(7500);
    expect(streams).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(2500);
    expect(ticks.at(-1)?.status).toEqual({ id: "hubble", ok: false, detail: "no flows for 10 s", fix: null });
    expect(streams[0]?.cancel).toHaveBeenCalled();
    expect(streams).toHaveLength(2);
    expect(pfs[0]?.close).not.toHaveBeenCalled();
    streams[1]?.onFlow(twoFlows[0]);
    await vi.advanceTimersByTimeAsync(2500);
    expect(ticks.at(-1)?.status).toEqual({ id: "hubble", ok: true, detail: "live", fix: null });
  });

  it("logs a tick that throws and runs the next one", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    collectors.subscribe({ clusterId: "c1", subscriber: "s1", inv: null as never, ip });
    await vi.advanceTimersByTimeAsync(0);
    streams[0]?.onFlow(twoFlows[0]);
    await vi.advanceTimersByTimeAsync(2500);
    expect(error).toHaveBeenCalledWith(expect.stringContaining("[service-map] tick for c1 failed"));
    expect(ticks).toHaveLength(0);
    sub();
    await vi.advanceTimersByTimeAsync(2500);
    expect(ticks).toHaveLength(1);
    error.mockRestore();
  });

  it("reports the hubble status of a cluster", async () => {
    sub();
    await vi.advanceTimersByTimeAsync(0);
    expect(collectors.status("c1")).toEqual({ id: "hubble", ok: true, detail: "live", fix: null });
    expect(collectors.status("c2")).toBeNull();
  });

  it("closes a port-forward that resolves after the collector stopped", async () => {
    let resolve!: (pf: { localPort: number; close: () => void }) => void;
    openPortForward.mockImplementationOnce(() => new Promise((r) => (resolve = r)));
    sub();
    collectors.unsubscribe("c1", "s1");
    const close = vi.fn();
    resolve({ localPort: 1, close });
    await vi.advanceTimersByTimeAsync(0);
    expect(close).toHaveBeenCalled();
    expect(streams).toHaveLength(0);
  });
});
