// Reads the Kubernetes objects of a cluster into a Snapshot without traffic (the "Kubernetes only" data level).
import { Renderer } from "@freelensapp/extensions";
import { toSnapshot } from "../../common/graph/flows";
import { buildInventory, type KubeObjectLike } from "../../common/graph/inventory";

import type { Snapshot } from "../../common/graph/types";

/** Lists one resource; null when the API is not served (missing CRD) or not allowed (RBAC). */
export type List = (apiPath: string) => Promise<KubeObjectLike[] | null>;

// [path, apiVersion, kind]; list items carry no kind of their own
const LISTS: Array<[string, string, string]> = [
  ["/apis/apps/v1/deployments", "apps/v1", "Deployment"],
  ["/apis/apps/v1/statefulsets", "apps/v1", "StatefulSet"],
  ["/apis/apps/v1/daemonsets", "apps/v1", "DaemonSet"],
  ["/api/v1/pods", "v1", "Pod"],
  ["/api/v1/services", "v1", "Service"],
  ["/api/v1/namespaces", "v1", "Namespace"],
  ["/apis/networking.k8s.io/v1/ingresses", "networking.k8s.io/v1", "Ingress"],
  ["/apis/gateway.networking.k8s.io/v1/httproutes", "gateway.networking.k8s.io/v1", "HTTPRoute"],
  ["/apis/gateway.networking.k8s.io/v1/gateways", "gateway.networking.k8s.io/v1", "Gateway"],
  ["/apis/apps.kubeblocks.io/v1/clusters", "apps.kubeblocks.io/v1", "Cluster"],
  ["/apis/networking.k8s.io/v1/networkpolicies", "networking.k8s.io/v1", "NetworkPolicy"],
  ["/apis/cilium.io/v2/ciliumnetworkpolicies", "cilium.io/v2", "CiliumNetworkPolicy"],
  ["/apis/cilium.io/v2/ciliumclusterwidenetworkpolicies", "cilium.io/v2", "CiliumClusterwideNetworkPolicy"],
];
// always served: when one of these returns nothing, the user may not read it
const CORE = new Set(LISTS.slice(0, 6).map(([p]) => p));
// KubeBlocks moved InstanceSet to its own group in 1.0; older releases serve the alpha one
const INSTANCE_SETS: Array<[string, string]> = [
  ["/apis/workloads.kubeblocks.io/v1/instancesets", "workloads.kubeblocks.io/v1"],
  ["/apis/apps.kubeblocks.io/v1alpha1/instancesets", "apps.kubeblocks.io/v1alpha1"],
];

/** The snapshot, plus the core lists that could not be read (RBAC); a missing CRD is not reported. */
export async function loadK8sSnapshot(cluster: string, list: List): Promise<Snapshot & { unreadable: string[] }> {
  const read = async (path: string, apiVersion: string, kind: string) =>
    (await list(path))?.map((o) => ({ ...o, apiVersion, kind })) ?? null;
  const lists = await Promise.all(LISTS.map(([p, v, k]) => read(p, v, k)));
  const unreadable = LISTS.filter(([p], i) => CORE.has(p) && !lists[i]).map(([p]) => p);
  let sets: KubeObjectLike[] | null = null;
  for (const [p, v] of INSTANCE_SETS) if ((sets = await read(p, v, "InstanceSet"))) break;
  const objects = [...lists, sets].flatMap((l) => l ?? []);
  const inv = buildInventory(objects, { cpu: {}, mem: {}, cpuLim: {}, memLim: {} });
  return {
    ...toSnapshot(inv, { edges: [], windowSec: 0, capturedAt: new Date().toISOString() }, cluster, {}),
    unreadable,
  };
}

/** The real list, through the host's Kubernetes API proxy for the cluster. */
export function clusterList(clusterId: string): List {
  const api = Renderer.K8sApi.KubeJsonApi.forCluster(clusterId);
  return async (path) => {
    try {
      return ((await api.get(path)) as unknown as { items: KubeObjectLike[] }).items;
    } catch (err) {
      // shortcut: any failure reads as "not served"; M2's Data menu reports the exact missing permission
      console.warn(`[service-map] ${path}: ${String(err)}`);
      return null;
    }
  };
}
