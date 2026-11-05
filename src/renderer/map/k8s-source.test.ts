import { describe, expect, it } from "vitest";
import { fixtureList, LISTED_KINDS } from "../../../test/fixture";
import { loadK8sObjects, loadK8sSnapshot } from "./k8s-source";

import type { KubeObjectLike } from "../../common/graph/inventory";

const fakeList = fixtureList("capture-b");
const core = Object.keys(LISTED_KINDS);

describe("loadK8sSnapshot", () => {
  it("builds the map without Gateway API, KubeBlocks or Cilium CRDs", async () => {
    const s = await loadK8sSnapshot("c1", fakeList);
    expect(s.workloads).toHaveLength(59);
    expect(s.edges).toEqual([]);
    expect(s.cluster).toBe("c1");
  });

  it("asks for every list the map reads", async () => {
    const asked: string[] = [];
    await loadK8sSnapshot("c1", async (p) => (asked.push(p), null));
    for (const p of [
      ...core,
      "/api/v1/nodes",
      "/apis/gateway.networking.k8s.io/v1/httproutes",
      "/apis/gateway.networking.k8s.io/v1/gateways",
      "/apis/workloads.kubeblocks.io/v1/instancesets",
      "/apis/apps.kubeblocks.io/v1alpha1/instancesets",
      "/apis/apps.kubeblocks.io/v1/clusters",
      "/apis/networking.k8s.io/v1/networkpolicies",
      "/apis/cilium.io/v2/ciliumnetworkpolicies",
      "/apis/cilium.io/v2/ciliumclusterwidenetworkpolicies",
    ])
      expect(asked).toContain(p);
  });

  it("reports the core lists it could not read, not the missing CRDs", async () => {
    const s = await loadK8sSnapshot("c1", async (p) => (p === "/api/v1/pods" ? null : fakeList(p)));
    expect(s.unreadable).toEqual(["/api/v1/pods"]);
    expect((await loadK8sSnapshot("c1", fakeList)).unreadable).toEqual([]);
  });
});

describe("loadK8sObjects", () => {
  it("returns the nodes apart, with their kind, and never reports them unreadable", async () => {
    const node = {
      metadata: { name: "n1" },
      status: { addresses: [{ type: "InternalIP", address: "10.0.0.5" }] },
    } as KubeObjectLike;
    const r = await loadK8sObjects(async (p) => (p === "/api/v1/nodes" ? [node] : fakeList(p)));
    expect(r.nodes).toEqual([{ ...node, apiVersion: "v1", kind: "Node" }]);
    expect(r.objects.some((o) => o.kind === "Node")).toBe(false);
    expect(r.unreadable).toEqual([]);
    const noNodes = await loadK8sObjects(fakeList);
    expect(noNodes.nodes).toEqual([]);
    expect(noNodes.unreadable).toEqual([]);
  });
});
