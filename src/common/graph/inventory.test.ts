import { describe, expect, it } from "vitest";
import { loadFixture } from "../../../test/fixture";
import { buildInventory, type KubeObjectLike } from "./inventory";

const { objects, metrics } = loadFixture("capture-b");
const inv = buildInventory(objects, metrics);
const byId = new Map(inv.workloads.map((w) => [w.id, w]));

describe("buildInventory on a real (anonymized) cluster", () => {
  it("finds every workload, KubeBlocks databases included", () => {
    expect(inv.workloads).toHaveLength(77);
    const kb = inv.workloads.filter((w) => w.kind === "KubeBlocks");
    expect(kb).toHaveLength(18);
    for (const w of kb) expect(w.db && w.release !== null).toBe(true);
  });

  it("maps ReplicaSet pods to their Deployment", () => {
    const dep = inv.workloads.find((w) => w.kind === "Deployment" && w.pods.length > 0)!;
    expect(inv.podToWorkload[`${dep.ns}/${dep.pods[0]!.name}`]).toBe(dep.id);
  });

  it("leaves out system namespaces", () => {
    for (const ns of ["kube-system", "kube-node-lease", "kube-public", "cilium-secrets"]) {
      expect(inv.namespaces).not.toContain(ns);
      expect(inv.workloads.some((w) => w.ns === ns)).toBe(false);
    }
  });

  it("reads HTTPRoutes, keeping a route whose backend has no pods as broken", () => {
    expect(inv.routes).toHaveLength(24);
    const broken = inv.routes.filter((r) => r.target === null);
    expect(broken.length).toBeGreaterThan(0);
    expect(broken.some((r) => byId.get(`${r.ns}/${r.service}`)?.ready === 0)).toBe(true);
  });

  it("finds the LoadBalancer services and the gateway behind the same IP", () => {
    const svc = inv.loadBalancers.filter((l) => l.kind === "Service"),
      gw = inv.loadBalancers.filter((l) => l.kind === "Gateway");
    expect([svc.length, gw.length]).toEqual([2, 1]);
    expect(gw[0]!.provider).toBe(svc.find((s) => s.ips.some((ip) => gw[0]!.ips.includes(ip)))!.provider);
    expect(inv.loadBalancers.every((l) => l.exposure === "internal")).toBe(true);
  });

  it("makes a LoadBalancer public when it declares a public endpoint", () => {
    const lb = objects.find((o) => o.kind === "Service" && o.spec?.type === "LoadBalancer")!;
    const annotated: KubeObjectLike = {
      ...lb,
      metadata: { ...lb.metadata, annotations: { "servicemap.freelens.io/public-endpoint": "203.0.113.9" } },
    };
    const result = buildInventory([...objects.filter((o) => o !== lb), annotated], metrics).loadBalancers.find(
      (l) => l.name === lb.metadata.name,
    )!;
    expect([result.exposure, result.publicEndpoint]).toEqual(["public", "203.0.113.9"]);
  });

  it("works on a cluster without Gateway API or KubeBlocks", () => {
    const plain = buildInventory(
      objects.filter((o) => !["HTTPRoute", "Gateway", "InstanceSet", "Cluster"].includes(o.kind)),
      metrics,
    );
    expect(plain.workloads).toHaveLength(59);
    expect(plain.routes).toHaveLength(0);
  });

  it("keeps namespaces that have no workloads, but not system ones", () => {
    const ns = (name: string): KubeObjectLike => ({ kind: "Namespace", metadata: { name } });
    const x = buildInventory([...objects, ns("empty"), ns("kube-system")], metrics);
    expect(x.namespaces).toContain("empty");
    expect(x.namespaces).not.toContain("kube-system");
  });

  it("ignores pods with no controller or owned by a Job", () => {
    const pod = (name: string, owner?: string): KubeObjectLike => ({
      kind: "Pod",
      metadata: { name, namespace: "default", ...(owner ? { ownerReferences: [{ kind: owner, name: "x" }] } : {}) },
      spec: {},
      status: { phase: "Running" },
    });
    const result = buildInventory([...objects, pod("bare"), pod("migrate-abc", "Job")], metrics);
    expect(result.workloads).toHaveLength(77);
    expect(result.podToWorkload["default/bare"]).toBeUndefined();
  });
});
