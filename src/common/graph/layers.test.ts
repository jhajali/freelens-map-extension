import { describe, expect, it } from "vitest";
import { linkVerdict, protectedNamespaces, score } from "./layers";
import { DEFAULT_THRESHOLDS } from "./types";

import type { MapEdge, Snapshot, Workload } from "./types";

const w = (o: Partial<Workload> = {}): Workload =>
  ({
    id: "a/x",
    ns: "a",
    desired: 1,
    ready: 1,
    restarts: 0,
    cpu: 0,
    mem: 0,
    cpuLim: null,
    memLim: null,
    ...o,
  }) as Workload;
const ctx = (o = {}) => ({
  thresholds: DEFAULT_THRESHOLDS,
  traffic: 0,
  prometheus: true,
  protectedNs: () => false,
  ...o,
});

describe("score", () => {
  it("cpu against its limit, else against 0.5 cores", () => {
    expect(score(w({ cpu: 0.425, cpuLim: 0.5 }), "cpu", ctx())).toBeCloseTo(0.85);
    expect(score(w({ cpu: 0.25 }), "cpu", ctx())).toBeCloseTo(0.5);
  });
  it("ram against its limit, else against 1 GiB", () => {
    expect(score(w({ mem: 512, memLim: 1024 }), "ram", ctx())).toBeCloseTo(0.5);
    expect(score(w({ mem: 2 ** 29 }), "ram", ctx())).toBeCloseTo(0.5);
  });
  it("cpu and ram are neutral without Prometheus", () => {
    expect(score(w({ cpu: 9, mem: 2 ** 40 }), "cpu", ctx({ prometheus: false }))).toBe(0);
    expect(score(w({ cpu: 9, mem: 2 ** 40 }), "ram", ctx({ prometheus: false }))).toBe(0);
  });
  it("health: 1 not ready, 0.7 restarting, else 0", () => {
    const r = DEFAULT_THRESHOLDS.restarts;
    expect(score(w({ ready: 0 }), "health", ctx())).toBe(1);
    expect(score(w({ restarts: r }), "health", ctx())).toBe(0.7);
    expect(score(w(), "health", ctx())).toBe(0);
  });
  it("traffic is flows/s over 2", () => {
    expect(score(w(), "traffic", ctx({ traffic: 1.5 }))).toBeCloseTo(0.75);
  });
  it("policy: 0 protected, 1 default-allow", () => {
    expect(score(w(), "policy", ctx({ protectedNs: (n: string) => n === "a" }))).toBe(0);
    expect(score(w(), "policy", ctx())).toBe(1);
  });
});

describe("protectedNamespaces", () => {
  it("a namespaced policy protects its namespace only", () => {
    const p = protectedNamespaces([{ kind: "NetworkPolicy", ns: "a", name: "p" }]);
    expect([p("a"), p("b")]).toEqual([true, false]);
  });
  it("a clusterwide policy protects every namespace", () => {
    const p = protectedNamespaces([{ kind: "CiliumClusterwideNetworkPolicy", ns: null, name: "p" }]);
    expect(p("anything")).toBe(true);
  });
  it("no policies protect nothing", () => expect(protectedNamespaces([])("a")).toBe(false));
});

describe("linkVerdict", () => {
  const s = { workloads: [w({ id: "a/x", ns: "a" }), w({ id: "b/y", ns: "b" })] } as Snapshot;
  const e = (o: Partial<MapEdge>) => ({ source: "a/x", target: "b/y", rate: 1, drops: 0, ...o }) as MapEdge;
  const prot = (ns: string) => ns === "b";
  it("dropped over 1% drops", () => expect(linkVerdict(e({ drops: 0.5 }), s, prot)).toBe("dropped"));
  it("protected when the target namespace is", () => expect(linkVerdict(e({}), s, prot)).toBe("protected"));
  it("default-allow otherwise", () => expect(linkVerdict(e({ target: "a/x" }), s, prot)).toBe("default-allow"));
});
