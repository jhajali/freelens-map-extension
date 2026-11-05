import { describe, expect, it } from "vitest";
import { loadFixture } from "../../../test/fixture";
import { flowsToEdges, toSnapshot } from "./flows";
import { buildInventory } from "./inventory";
import { DEFAULT_THRESHOLDS, NO_FILTERS, type Snapshot } from "./types";
import { aggregate, diff, pipeline, scope, shortName } from "./view";

function snapshot(name: "capture-a" | "capture-b"): Snapshot {
  const fx = loadFixture(name),
    fxb = loadFixture("capture-b");
  const inv = buildInventory(fxb.objects, fxb.metrics);
  const ctx = {
    self: fxb.cluster.self,
    clusterCidrs: fxb.cluster.clusterCidrs,
    namedNetworks: [],
    clusterIps: inv.clusterIps,
  };
  return toSnapshot(inv, flowsToEdges(fx.flows, inv, ctx), fxb.cluster.self, fxb.cluster.clusterCidrs);
}
const s = snapshot("capture-b"),
  baseline = snapshot("capture-a");
const rates = s.edges.map((e) => e.flowsPerSec);
const nsOf = (n: number) => s.namespaces.find((ns) => s.workloads.filter((w) => w.ns === ns).length === n)!;
const shop = nsOf(12);
const own = new Set(s.workloads.filter((w) => w.ns === shop).map((w) => w.id));

describe("view model", () => {
  it("cluster view shows namespaces and outside nodes only, never self-links", () => {
    const edges = aggregate(s, null, rates, NO_FILTERS);
    for (const e of edges) {
      expect(e.source).not.toBe(e.target);
      for (const id of [e.source, e.target]) expect(id).toMatch(/^(ns:|cluster:|lan$|internet$|world$|internal$)/);
    }
  });

  it("n+1 keeps only links touching the namespace's own workloads, plus the entry path", () => {
    const n1 = scope(aggregate(s, shop, rates, NO_FILTERS), s, shop, 1);
    for (const e of n1)
      expect(own.has(e.source) || own.has(e.target) || ["lan", "internet"].includes(e.source)).toBe(true);
    expect(scope(aggregate(s, shop, rates, NO_FILTERS), s, shop, 0).length).toBeGreaterThan(n1.length);
  });

  it("draws a route to a backend with no ready pods as a broken synthetic link", () => {
    const route = s.routes.find((r) => r.ns === shop && r.target === null)!;
    const e = aggregate(s, shop, rates, NO_FILTERS).find((x) => x.target === `${shop}/${route.service}`)!;
    expect(e.synthetic).toBe(true);
    expect(e.routes[0]!.path).toBe(route.path);
    expect(s.workloads.find((w) => w.id === e.target)!.ready).toBe(0);
  });

  it("hides DNS when the protocol filter says so", () => {
    const f = { ...NO_FILTERS, apps: new Set(["DNS"]) };
    for (const e of aggregate(s, null, rates, f)) expect([...e.apps.keys()]).not.toContain("DNS");
  });

  it("Problems keeps every restarting workload", () => {
    const f = { ...NO_FILTERS, problems: true };
    const { keep } = pipeline(s, shop, rates, f, 1, DEFAULT_THRESHOLDS);
    for (const w of s.workloads.filter((x) => x.ns === shop && x.restarts >= 1)) expect(keep!.has(w.id)).toBe(true);
  });

  it("Exposed at cluster view stays downstream of entry points and never reaches egress", () => {
    const { edges } = pipeline(s, null, rates, { ...NO_FILTERS, exposed: true }, 1, DEFAULT_THRESHOLDS);
    expect(edges.length).toBeGreaterThan(0);
    for (const e of edges) expect(["world", "internal"]).not.toContain(e.target);
  });

  it("Changes finds new and gone links against a baseline, and nothing against itself", () => {
    const d = diff(
      aggregate(s, null, rates, NO_FILTERS),
      aggregate(
        baseline,
        null,
        baseline.edges.map((e) => e.flowsPerSec),
        NO_FILTERS,
      ),
    );
    expect(d.some((e) => e.change === "new")).toBe(true);
    expect(d.some((e) => e.change === "gone")).toBe(true);
    const same = aggregate(s, null, rates, NO_FILTERS);
    expect(diff(same, same)).toEqual([]);
  });

  it("drops the release prefix from card names", () => {
    const w = { ...s.workloads[0]!, name: "shop-mongodb-mongodb", release: "shop-mongodb" };
    expect(shortName(w)).toBe("mongodb");
    expect(shortName({ ...w, release: null })).toBe("shop-mongodb-mongodb");
  });

  it("works without any flows (Kubernetes-only)", () => {
    const k8sOnly = { ...s, edges: [] };
    const edges = aggregate(k8sOnly, null, [], NO_FILTERS);
    expect(edges.every((e) => e.synthetic)).toBe(true);
  });

  it("an empty namespace yields no links", () => expect(scope([], s, "no-such-ns", 1)).toEqual([]));

  it("draws Ingress routes on a cluster without Gateway API", () => {
    const ingressOnly = {
      ...s,
      edges: [],
      loadBalancers: s.loadBalancers.filter((l) => l.kind !== "Gateway"),
      routes: s.routes.map((r) => ({ ...r, kind: "Ingress" as const, gateway: null })),
    };
    const cluster = aggregate(ingressOnly, null, [], NO_FILTERS).filter((e) => e.routes.length);
    expect(cluster.length).toBeGreaterThan(0);
    for (const e of cluster) expect(e.source).toBe("ingress");
    const inShop = aggregate(ingressOnly, shop, [], NO_FILTERS).filter((e) => e.routes.length);
    expect(inShop.some((e) => e.source === "ingress" && own.has(e.target))).toBe(true);
  });

  it("draws each HTTPRoute from its own Gateway", () => {
    const gw = s.loadBalancers.find((l) => l.kind === "Gateway")!;
    const route = s.routes.find((r) => r.ns === shop && r.target)!;
    const two = {
      ...s,
      edges: [],
      loadBalancers: [
        ...s.loadBalancers,
        { ...gw, ns: "edge", name: "public", ips: ["203.0.113.9"], exposure: "public" as const },
      ],
      routes: s.routes.map((r) => (r === route ? { ...r, gateway: "edge/public" } : r)),
    };
    const cluster = aggregate(two, null, [], NO_FILTERS);
    expect(cluster.find((e) => e.source === "ns:edge" && e.target === `ns:${shop}`)?.routes).toContainEqual({
      ...route,
      gateway: "edge/public",
    });
    expect(cluster.some((e) => e.source === "internet" && e.target === "ns:edge")).toBe(true);
    expect(cluster.some((e) => e.source === `ns:${gw.ns}` && e.routes.length)).toBe(true);
    const inShop = aggregate(two, shop, [], NO_FILTERS);
    expect(inShop.some((e) => e.source === "gateway:edge" && e.target === route.target)).toBe(true);
  });
});
