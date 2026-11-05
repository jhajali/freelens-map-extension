// The real names a snapshot holds, for the tests that check that anonymized output shows none of them. Test-only.
import { shortName } from "../src/common/graph/view";

import type { Snapshot } from "../src/common/graph/types";

/** Real label values that are also words of the label keys (apps.kubeblocks.io/…) or of the UI ("Helm releases"). */
export const GENERIC = ["Helm", "ui", "kubeblocks", "apps"];

/** Every name in the snapshot, longest first so that a failure names the whole string, and those of GENERIC that occur. */
export function realStrings(s: Snapshot): { names: string[]; generic: string[] } {
  const real = [
    s.cluster,
    ...s.namespaces,
    ...Object.keys(s.clusterCidrs),
    ...s.workloads.flatMap((w) => [
      w.id,
      w.name,
      shortName(w),
      w.release,
      w.chart,
      ...Object.values(w.labels),
      ...w.pods.map((p) => p.name),
    ]),
    ...s.routes.flatMap((r) => [r.name, r.host, r.path, r.service, r.gateway]),
    ...s.loadBalancers.flatMap((l) => [l.name, l.publicEndpoint, ...l.ips, ...l.ports.map((p) => p.hostname)]),
    ...s.edges.flatMap((e) => e.samples.flatMap((x) => [x.srcIp, x.dstIp, x.srcPod, x.dstPod, x.dns])),
    ...s.policies.map((p) => p.name),
  ];
  const all = new Set(real.filter((x): x is string => !!x && x !== "/"));
  return {
    names: [...all].filter((x) => !GENERIC.includes(x)).sort((a, b) => b.length - a.length),
    generic: GENERIC.filter((g) => all.has(g)),
  };
}
