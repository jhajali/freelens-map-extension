import { describe, expect, it } from "vitest";
import { loadFixture } from "../../../test/fixture";
import { aliases } from "./anonymize";
import { flowsToEdges, toSnapshot } from "./flows";
import { buildInventory } from "./inventory";

const fx = loadFixture("capture-b");
const inv = buildInventory(fx.objects, fx.metrics);
const s = toSnapshot(
  inv,
  flowsToEdges(fx.flows, inv, {
    self: fx.cluster.self,
    clusterCidrs: fx.cluster.clusterCidrs,
    namedNetworks: [],
    clusterIps: inv.clusterIps,
  }),
  "dev",
  fx.cluster.clusterCidrs,
);

describe("aliases", () => {
  it("are stable per snapshot: two instances agree, whatever order names are asked in", () => {
    const a = aliases(s),
      b = aliases(s);
    const ws = s.workloads.map((w) => w.id);
    const first = ws.map((id) => a("svc", id));
    expect([...ws].reverse().map((id) => b("svc", id))).toEqual([...first].reverse());
    expect(a("ns", s.namespaces[0]!)).toBe(b("ns", s.namespaces[0]!));
  });

  it("are distinct and say what they stand for", () => {
    const a = aliases(s);
    const ws = s.workloads.map((w) => a(w.db ? "db" : "svc", w.id));
    expect(new Set(ws).size).toBe(s.workloads.length);
    const db = s.workloads.find((w) => w.db)!;
    expect(a("svc", db.id)).toMatch(/^db-\d+$/);
    expect(a("db", db.id)).toBe(a("svc", db.id));
    expect(a("svc", s.workloads.find((w) => !w.db)!.id)).toMatch(/^svc-\d+$/);
    const ns = s.namespaces.map((n) => a("ns", n));
    expect(new Set(ns).size).toBe(s.namespaces.length);
    expect(ns.every((n) => /^namespace-\d+$/.test(n))).toBe(true);
    expect(a("cluster", s.cluster)).toBe("cluster-1");
    expect(a("release", s.workloads.find((w) => w.release)!.release!)).toMatch(/^release-\d+$/);
    expect(a("net", "office")).toBe("net-1");
    expect(a("host", "shop.example.com")).toMatch(/^host-\d+$/);
    expect(a("ip", "10.0.0.1")).toMatch(/^ip-\d+$/);
    expect(a("path", "/api/orders")).toMatch(/^path-\d+$/);
    expect(a("ip", "10.0.0.1")).not.toBe(a("ip", "10.0.0.2"));
  });

  it("keep the root path", () => {
    expect(aliases(s)("path", "/")).toBe("/");
  });
});
