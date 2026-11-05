import { describe, expect, it } from "vitest";
import { loadFixture } from "../../../test/fixture";
import { loadK8sSnapshot } from "./k8s-source";

import type { KubeObjectLike } from "../../common/graph/inventory";

const fx = loadFixture("capture-b");
// A list response carries no kind on its items; loadK8sSnapshot must set it from the path.
const core: Record<string, string> = {
  "/apis/apps/v1/deployments": "Deployment",
  "/apis/apps/v1/statefulsets": "StatefulSet",
  "/apis/apps/v1/daemonsets": "DaemonSet",
  "/api/v1/pods": "Pod",
  "/api/v1/services": "Service",
  "/apis/networking.k8s.io/v1/ingresses": "Ingress",
  "/api/v1/namespaces": "Namespace",
};
const fakeList = async (path: string) => {
  const kind = core[path];
  return kind
    ? fx.objects.filter((o) => o.kind === kind).map(({ kind: _, apiVersion: __, ...rest }) => rest as KubeObjectLike)
    : null;
};

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
      ...Object.keys(core),
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
