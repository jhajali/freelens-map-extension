import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fixtureList, loadFixture, promBodies } from "../../../test/fixture";
import { flowsToEdges } from "../../common/graph/flows";
import { buildInventory } from "../../common/graph/inventory";
import { PROM_QUERIES } from "../../common/graph/prometheus";
import {
  BASELINE,
  CIDRS,
  type SourceStatus,
  SUBSCRIBE,
  type SubscribeRequest,
  TICK,
  type Tick,
  UNSUBSCRIBE,
} from "../../common/ipc";
import { type ClusterSettings, DEFAULT_RECORD } from "../../common/store/map-store";
import { type LiveDeps, LiveMap, type LiveState } from "./live-map";

const fx = loadFixture("capture-b");
const bodies = promBodies("capture-b");
const inv = buildInventory(fx.objects, fx.metrics);
const flows = flowsToEdges(fx.flows, inv, {
  self: fx.cluster.self,
  clusterCidrs: fx.cluster.clusterCidrs,
  namedNetworks: [],
  clusterIps: inv.clusterIps,
});
const hubbleOk: SourceStatus = { id: "hubble", ok: true, detail: "hubble-relay", fix: null };
const hubbleDown: SourceStatus = { id: "hubble", ok: false, detail: "no Hubble Relay", fix: "enable Hubble" };

// the queue drains in a few dozen hops; every fake answers synchronously
const flush = async () => {
  for (let i = 0; i < 50; i++) await Promise.resolve();
};

function setup(
  over: Partial<LiveDeps> = {},
  subscribe: SourceStatus = hubbleOk,
  settings: ClusterSettings = DEFAULT_RECORD.settings,
) {
  const listeners = new Set<(...args: any[]) => void>();
  const invoke = vi.fn(async (channel: string, ...args: unknown[]): Promise<any> => {
    if (channel === SUBSCRIBE) return subscribe;
    if (channel === CIDRS) return { [args[0] as string]: args[1], other: ["10.200.0.0/24"] };
    if (channel === BASELINE) return null;
    return undefined;
  });
  const deps: LiveDeps = {
    list: fixtureList("capture-b"),
    query: async (_path, q) =>
      bodies[(Object.keys(PROM_QUERIES) as Array<keyof typeof PROM_QUERIES>).find((k) => PROM_QUERIES[k] === q)!],
    invoke,
    listen: (channel, fn) => {
      expect(channel).toBe(TICK);
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    setInterval,
    clearInterval,
    ...over,
  };
  const states: LiveState[] = [];
  const map = new LiveMap("id-1", fx.cluster.self, deps, () => settings);
  map.start((s) => states.push(s));
  const emit = (tick: Partial<Tick>) => {
    for (const fn of listeners) fn({ clusterId: "id-1", flows, status: hubbleOk, truncated: 0, l7: true, ...tick });
  };
  const last = () => states[states.length - 1]!;
  const source = (id: string) => last().sources.find((s) => s.id === id)!;
  return { map, deps, invoke, listeners, emit, states, last, source };
}

describe("LiveMap", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("reaches the Hubble + Prometheus level and draws the tick's links", async () => {
    const { emit, last, source, invoke, states } = setup();
    await flush();
    emit({});
    await flush();
    expect(last().level).toBe("Hubble + Prometheus");
    expect(last().snapshot?.edges).toHaveLength(171);
    expect(last().snapshot?.workloads.some((w) => w.cpu > 0)).toBe(true);
    // a workload counts as sampled when one of its pods has a sample
    const ws = last().snapshot!.workloads;
    expect(ws.filter((w) => last().sampled.cpu.has(w.id))).toEqual(
      ws.filter((w) => w.pods.some((p) => `${w.ns}/${p.name}` in fx.metrics.cpu)),
    );
    expect(last().sampled.cpu.size).toBeGreaterThan(0);
    expect(last().sampled.cpu.size).toBeLessThan(ws.length);
    expect(last().snapshot?.clusterCidrs.other).toEqual(["10.200.0.0/24"]);
    expect(source("kubernetes")).toMatchObject({ ok: true, detail: "objects listed" });
    expect(source("prometheus")).toMatchObject({ ok: true, detail: "observability/prometheus-server" });
    expect(invoke.mock.calls.filter(([c]) => c === BASELINE)).toEqual([[BASELINE, "id-1"]]);
    // every emitted state is a new object
    expect(new Set(states).size).toBe(states.length);
  });

  it("falls back to Kubernetes only and says why", async () => {
    const { last, source } = setup(
      { query: () => Promise.reject(new Error('services "prometheus-server" is forbidden: no')) },
      hubbleDown,
    );
    await flush();
    expect(last().level).toBe("Kubernetes only");
    expect(source("prometheus")).toMatchObject({ ok: false, detail: "service proxy denied" });
    expect(source("prometheus").fix).toContain("services/proxy");
    expect(source("hubble")).toEqual(hubbleDown);
    expect(last().snapshot?.edges).toEqual([]);
  });

  it("says when there is no Prometheus service", async () => {
    const list = fixtureList("capture-b");
    const { source } = setup({
      list: async (p) =>
        p === "/api/v1/services"
          ? ((await list(p)) ?? []).filter((o) => !o.metadata.name.startsWith("prometheus"))
          : list(p),
    });
    await flush();
    expect(source("prometheus")).toMatchObject({ ok: false, detail: "no Prometheus service found" });
  });

  it("uses the Prometheus override instead of discovery", async () => {
    const paths: string[] = [];
    const { source } = setup({ query: async (p) => (paths.push(p), bodies.cpu) }, hubbleOk, {
      ...DEFAULT_RECORD.settings,
      prometheus: { ns: "mon", name: "thanos", port: 9091 },
    });
    await flush();
    expect(paths.length).toBeGreaterThan(0);
    expect(paths.every((p) => p.includes("mon") && p.includes("thanos") && p.includes("9091"))).toBe(true);
    expect(source("prometheus").detail).toBe("mon/thanos");
  });

  it("sends named networks with the subscription", async () => {
    const settings = {
      ...DEFAULT_RECORD.settings,
      namedNetworks: [{ cidr: "192.0.2.0/24", name: "office" }],
      relay: { ns: "obs", svc: "relay", port: 4245 },
    };
    const { invoke } = setup({}, hubbleOk, settings);
    await flush();
    const req = invoke.mock.calls.find(([c]) => c === SUBSCRIBE)![1] as SubscribeRequest;
    expect(req.ip.namedNetworks).toEqual(settings.namedNetworks);
    expect(req.relay).toEqual(settings.relay);
  });

  it("reports a failed objects load on the kubernetes source", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { source } = setup({ list: () => Promise.reject(new Error("boom")) });
    await flush();
    expect(source("kubernetes").ok).toBe(false);
    expect(source("kubernetes").detail).toContain("boom");
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("keeps a good kubernetes status when only the CIDRS call fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const list = fixtureList("capture-b");
    const node = { metadata: { name: "n1" }, status: { addresses: [{ type: "InternalIP", address: "10.0.0.5" }] } };
    const { invoke, source } = setup({ list: async (p) => (p === "/api/v1/nodes" ? [node as never] : list(p)) });
    const answer = invoke.getMockImplementation()!;
    invoke.mockImplementation(async (c, ...a) =>
      c === CIDRS ? Promise.reject(new Error("no main")) : answer(c, ...a),
    );
    await flush();
    expect(source("kubernetes")).toMatchObject({ ok: true, detail: "objects listed" });
    warn.mockRestore();
  });

  it("keeps the last good metrics when Prometheus fails", async () => {
    let fail = false;
    const good = (q: string) =>
      bodies[(Object.keys(PROM_QUERIES) as Array<keyof typeof PROM_QUERIES>).find((k) => PROM_QUERIES[k] === q)!];
    const { last, source } = setup({
      query: async (_p, q) => (fail ? Promise.reject(new Error("connection reset")) : good(q)),
    });
    await flush();
    expect(source("prometheus").ok).toBe(true);
    fail = true;
    await vi.advanceTimersByTimeAsync(30_000);
    expect(source("prometheus")).toMatchObject({ ok: false });
    expect(last().snapshot?.workloads.some((w) => w.cpu > 0)).toBe(true);
  });

  it("survives a throw inside a timer callback", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const list = fixtureList("capture-b");
    // ports that are not a list make findPrometheus throw
    const broken = { kind: "Service", metadata: { name: "prometheus-server", namespace: "m" }, spec: { ports: {} } };
    const { last, source } = setup({
      list: async (p) => (p === "/api/v1/services" ? [broken as never] : list(p)),
    });
    await flush();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(source("prometheus").ok).toBe(false);
    expect(last().snapshot).not.toBeNull();
    warn.mockRestore();
  });

  it("emits nothing for results that arrive after stop", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    const list = fixtureList("capture-b");
    const { map, states } = setup({ list: async (p) => (await gate, list(p)) });
    map.stop();
    release();
    await flush();
    expect(states).toHaveLength(0);

    let releaseQuery: () => void = () => {};
    const queryGate = new Promise<void>((r) => (releaseQuery = r));
    const second = setup({ query: async (_p, q) => (await queryGate, bodies.cpu ?? q) });
    await flush();
    const n = second.states.length;
    second.map.stop();
    releaseQuery();
    await flush();
    expect(second.states).toHaveLength(n);
  });

  it("starts again cleanly on the same deps after a stop", async () => {
    const { map, deps } = setup();
    await flush();
    map.stop();
    const again = new LiveMap("id-1", fx.cluster.self, deps, () => DEFAULT_RECORD.settings);
    const states: LiveState[] = [];
    again.start((s) => states.push(s));
    await flush();
    expect(states[states.length - 1]?.level).toBe("Hubble + Prometheus");
    again.stop();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("names the lists it cannot read and says when there is no Prometheus", async () => {
    const list = fixtureList("capture-b");
    const { last, source } = setup({
      list: async (p) => (p === "/api/v1/pods" || p === "/api/v1/services" ? null : list(p)),
    });
    await flush();
    expect(source("kubernetes")).toEqual({
      id: "kubernetes",
      ok: false,
      detail: "2 lists not readable",
      fix: 'needs "list" on pods, services',
    });
    expect(source("prometheus")).toEqual({ id: "prometheus", ok: false, detail: "services not readable", fix: null });
    expect(last().level).toBe("Hubble only");
  });

  it("asks for L7 visibility and reports truncated rates", async () => {
    const { emit, source, last } = setup();
    await flush();
    emit({ l7: false, truncated: 12 });
    expect(source("hubble")).toEqual({
      id: "hubble",
      ok: true,
      detail: "hubble-relay · 12 flows over the cap, rates partial",
      fix: "enable L7 visibility for HTTP codes and latency",
    });
    expect(last()).toMatchObject({ l7: false, truncated: 12 });
  });

  it("ignores ticks of other clusters", async () => {
    const { emit, states, last } = setup();
    await flush();
    const n = states.length;
    emit({ clusterId: "id-2" });
    expect(states).toHaveLength(n);
    expect(last().snapshot?.edges).toEqual([]);
  });

  it("keeps its own baseline once the window is 5 minutes", async () => {
    const { emit, last } = setup();
    await flush();
    emit({ flows: { ...flows, windowSec: 60 } });
    await flush();
    expect(last()).toMatchObject({ baseline: null, baselineLabel: "none yet" });
    const at = "2026-11-05T09:07:00Z";
    emit({ flows: { ...flows, windowSec: 300, capturedAt: at } });
    await flush();
    const hhmm = new Date(at).toTimeString().slice(0, 5);
    expect(last().baselineLabel).toBe(`since ${hhmm} (map opened)`);
    expect(last().baseline?.edges).toHaveLength(171);
    // the first such tick stays the baseline
    emit({ flows: { ...flows, edges: [], windowSec: 300, capturedAt: "2026-11-05T09:20:00Z" } });
    await flush();
    expect(last().baselineLabel).toBe(`since ${hhmm} (map opened)`);
    expect(last().baseline?.edges).toHaveLength(171);
    expect(last().snapshot?.edges).toHaveLength(0);
  });

  it("asks main again after 5 minutes", async () => {
    const { emit, last, invoke } = setup();
    await flush();
    emit({ flows: { ...flows, windowSec: 300 } });
    await flush();
    const asks = () => invoke.mock.calls.filter(([c]) => c === BASELINE).length;
    expect(asks()).toBe(1);
    const at = "2026-11-05T08:00:00Z";
    const answer = invoke.getMockImplementation()!;
    invoke.mockImplementation(async (c, ...a) =>
      c === BASELINE
        ? { flows: { ...flows, edges: flows.edges.slice(0, 5), capturedAt: at }, source: "snapshot" }
        : answer(c, ...a),
    );
    await vi.advanceTimersByTimeAsync(300_000);
    expect(asks()).toBe(2);
    // main's snapshot wins over the map's own
    expect(last().baselineLabel).toBe(`snapshot from ${new Date(at).toTimeString().slice(0, 5)}`);
    expect(last().baseline?.edges).toHaveLength(5);
  });

  it("prefers its own baseline over main's since-opened", async () => {
    const { emit, last, invoke } = setup();
    const answer = invoke.getMockImplementation()!;
    invoke.mockImplementation(async (c, ...a) =>
      c === BASELINE
        ? {
            flows: { ...flows, edges: flows.edges.slice(0, 5), capturedAt: "2026-11-05T08:00:00Z" },
            source: "since-opened",
          }
        : answer(c, ...a),
    );
    await flush();
    emit({ flows: { ...flows, windowSec: 60 } });
    await flush();
    // without its own, main's since-opened is used
    expect(last().baseline?.edges).toHaveLength(5);
    const at = "2026-11-05T09:07:00Z";
    emit({ flows: { ...flows, windowSec: 300, capturedAt: at } });
    await flush();
    expect(last().baselineLabel).toBe(`since ${new Date(at).toTimeString().slice(0, 5)} (map opened)`);
    expect(last().baseline?.edges).toHaveLength(171);
  });

  it("renews its lease and unsubscribes on stop", async () => {
    const { map, invoke, listeners } = setup();
    await flush();
    const subscribes = () => invoke.mock.calls.filter(([c]) => c === SUBSCRIBE);
    const n = subscribes().length;
    expect(n).toBeGreaterThan(0);
    expect(subscribes()[0]![1]).toMatchObject({ clusterId: "id-1", ip: { self: fx.cluster.self, namedNetworks: [] } });
    await vi.advanceTimersByTimeAsync(20_000);
    expect(subscribes().length).toBeGreaterThan(n);
    const subscriber = (subscribes()[0]![1] as { subscriber: string }).subscriber;
    map.stop();
    expect(invoke).toHaveBeenCalledWith(UNSUBSCRIBE, "id-1", subscriber);
    expect(listeners.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});
