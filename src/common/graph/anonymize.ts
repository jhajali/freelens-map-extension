// Stable stand-in names for a snapshot, for screenshots and exports that must not show the cluster's real names.
import type { Snapshot } from "./types";

export type AliasKind =
  | "ns"
  | "svc"
  | "db"
  | "release"
  | "cluster"
  | "net"
  | "host"
  | "ip"
  | "path"
  | "pod"
  | "chart"
  | "label"
  | "obj";
export type Alias = (kind: AliasKind, real: string) => string;

export const realNames: Alias = (_, real) => real;

const PREFIX: Record<AliasKind, string> = {
  ns: "namespace",
  svc: "svc",
  db: "db",
  release: "release",
  cluster: "cluster",
  net: "net",
  host: "host",
  ip: "ip",
  path: "path",
  pod: "pod",
  chart: "chart",
  label: "label",
  obj: "obj",
};

/** Aliases numbered in the snapshot's sorted order, so the same snapshot always gets the same ones; names it lacks get the next number. */
export function aliases(s: Snapshot): Alias {
  const dbs = new Set(s.workloads.filter((w) => w.db).map((w) => w.id));
  const seen = new Map<string, string>();
  const count = new Map<string, number>();
  const alias: Alias = (kind, real) => {
    if (kind === "path" && (real === "" || real === "/")) return real;
    // a workload is one name whether asked for as a service or a database
    const prefix = kind === "svc" || kind === "db" ? (dbs.has(real) ? "db" : "svc") : PREFIX[kind];
    const key = `${kind === "db" ? "svc" : kind}\0${real}`;
    let v = seen.get(key);
    if (!v) {
      const n = (count.get(prefix) ?? 0) + 1;
      count.set(prefix, n);
      seen.set(key, (v = `${prefix}-${n}`));
    }
    return v;
  };
  const samples = s.edges.flatMap((e) => e.samples);
  const seed: Array<[AliasKind, Array<string | null | undefined>]> = [
    ["cluster", [s.cluster]],
    ["cluster", Object.keys(s.clusterCidrs)],
    ["ns", [...s.namespaces, ...s.workloads.map((w) => w.ns)]],
    ["svc", s.workloads.map((w) => w.id)],
    ["release", s.workloads.map((w) => w.release)],
    ["chart", s.workloads.map((w) => w.chart)],
    [
      "pod",
      [...s.workloads.flatMap((w) => w.pods.map((p) => p.name)), ...samples.flatMap((x) => [x.srcPod, x.dstPod])],
    ],
    ["label", s.workloads.flatMap((w) => Object.values(w.labels))],
    [
      "host",
      [...s.routes.map((r) => r.host), ...s.loadBalancers.map((l) => l.publicEndpoint), ...samples.map((x) => x.dns)],
    ],
    ["path", s.routes.map((r) => r.path)],
    ["ip", [...s.loadBalancers.flatMap((l) => l.ips), ...samples.flatMap((x) => [x.srcIp, x.dstIp])]],
  ];
  for (const [kind, xs] of seed)
    for (const x of [...new Set(xs.filter((v): v is string => !!v))].sort()) alias(kind, x);
  return alias;
}
