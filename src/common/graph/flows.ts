import { appForPort, classifyIp, type IpContext, isPrivateIp } from "./classify";
import { type Inventory, SYSTEM_NAMESPACES } from "./inventory";

import type { Endpoint, RawEdge, Sample, Snapshot } from "./types";

// Hubble flow as produced by `hubble observe -o jsonpb` or the gRPC client (keepCase): only the fields read here.
interface FlowEndpoint {
  namespace?: string;
  pod_name?: string;
  labels?: string[];
}
interface HubbleFlow {
  time?: string;
  verdict?: string;
  is_reply?: boolean;
  Type?: string;
  IP?: { source?: string; destination?: string };
  l4?: Record<string, { destination_port?: number; flags?: Record<string, boolean> }>;
  source?: FlowEndpoint;
  destination?: FlowEndpoint;
  source_names?: string[];
  destination_names?: string[];
}

export type FlowInventory = Pick<Inventory, "podToWorkload" | "serviceDns" | "serviceDnsByPort" | "clusterIps">;

export interface FlowsResult {
  edges: RawEdge[];
  windowSec: number;
  capturedAt: string;
}

const NODE_IDENTITIES = new Set(["reserved:host", "reserved:remote-node", "reserved:health"]);

function endpoint(e: FlowEndpoint = {}, ip: string, names: string[], inv: FlowInventory, ctx: IpContext): Endpoint {
  if (e.namespace && e.pod_name) {
    const wid = inv.podToWorkload[`${e.namespace}/${e.pod_name}`];
    if (wid) return wid;
    return SYSTEM_NAMESPACES.has(e.namespace) ? `@${e.namespace}` : `${e.namespace}/${e.pod_name}`;
  }
  const labels = e.labels ?? [];
  if (labels.includes("reserved:kube-apiserver")) return "@kube-apiserver";
  // no identity and no namespace: Hubble saw it on the node itself
  if (!e.namespace && (!labels.length || labels.some((l) => NODE_IDENTITIES.has(l)))) return "@host";
  // world, world-ipv4/-ipv6 (dual stack), ingress (Cilium's Envoy) and anything unknown: the IP says where it is
  const ep = classifyIp(ip, ctx);
  return ep.startsWith("@internet:") && names[0] ? `@internet:${names[0]}` : ep;
}

/** Aggregates Hubble flows into links keyed (source, target, protocol, port), with rates over the flows' time span. */
export function flowsToEdges(
  flows: unknown[],
  inv: FlowInventory,
  ctx: IpContext,
  opts: {
    reverseDns?: (ip: string) => string | null;
    sampleLimit?: number;
    counts?: number[];
    windowSec?: number;
    capturedAt?: string;
  } = {},
): FlowsResult {
  const acc = new Map<
    string,
    {
      src: string;
      dst: string;
      proto: string;
      port: number | null;
      flows: number;
      conns: number;
      drops: number;
      samples: Map<string, Sample>;
    }
  >();
  let t0 = Infinity,
    t1 = -Infinity;
  for (const [i, raw] of flows.entries()) {
    const w = opts.counts?.[i] ?? 1;
    const f = raw as HubbleFlow;
    if (!f || f.is_reply) continue;
    const t = Date.parse(f.time ?? "");
    if (!Number.isNaN(t)) {
      t0 = Math.min(t0, t);
      t1 = Math.max(t1, t);
    }
    const proto = Object.keys(f.l4 ?? {})[0] ?? "?";
    const l4 = f.l4?.[proto];
    const port = l4?.destination_port ?? null;
    const srcIp = f.IP?.source ?? "",
      dstIp = f.IP?.destination ?? "";
    const src = endpoint(f.source, srcIp, f.source_names ?? [], inv, ctx);
    const dst = endpoint(f.destination, dstIp, f.destination_names ?? [], inv, ctx);
    if (src === dst || (src === "@host" && dst === "@host")) continue;
    const key = `${src}|${dst}|${proto}|${port}`;
    let e = acc.get(key);
    if (!e) acc.set(key, (e = { src, dst, proto, port, flows: 0, conns: 0, drops: 0, samples: new Map() }));
    e.flows += w;
    if (l4?.flags?.SYN && !l4.flags.ACK) e.conns += w;
    if (f.verdict === "DROPPED") e.drops += w;
    const sk = `${srcIp}|${f.source?.pod_name ?? ""}|${dstIp}|${f.destination?.pod_name ?? ""}|${port}`;
    const s = e.samples.get(sk);
    if (s) s.count += w;
    else
      e.samples.set(sk, {
        srcIp,
        srcPod: f.source?.pod_name ?? null,
        dstIp,
        dstPod: f.destination?.pod_name ?? null,
        port,
        count: w,
        dns: null,
      });
  }
  const windowSec = opts.windowSec ?? (Number.isFinite(t0) ? Math.max(Math.round((t1 - t0) / 1000), 1) : 1);
  const dnsFor = (dst: string, s: Sample): string | null => {
    const svc = inv.clusterIps[s.dstIp];
    return (
      inv.serviceDnsByPort[`${dst}|${s.port}`] ??
      inv.serviceDns[dst] ??
      (svc ? `${svc.name}.${svc.ns}.svc.cluster.local` : null) ??
      (!isPrivateIp(s.dstIp) && opts.reverseDns ? opts.reverseDns(s.dstIp) : null)
    );
  };
  const edges: RawEdge[] = [];
  for (const e of acc.values()) {
    if (e.src === "@host" && e.port === null) continue; // node health/ICMP noise
    const samples = [...e.samples.values()]
      .sort((a, b) => b.count - a.count)
      .slice(0, opts.sampleLimit ?? 6)
      .map((s) => ({ ...s, dns: dnsFor(e.dst, s) }));
    edges.push({
      src: e.src,
      dst: e.dst,
      proto: e.proto,
      port: e.port,
      app: appForPort(e.proto, e.port),
      flowsPerSec: Math.round((e.flows / windowSec) * 100) / 100,
      connsPerSec: Math.round((e.conns / windowSec) * 1000) / 1000,
      dropRate: Math.round((e.drops / e.flows) * 10000) / 10000,
      samples,
    });
  }
  const capturedAt = opts.capturedAt ?? new Date(Number.isFinite(t0) ? t0 : 0).toISOString();
  return { edges, windowSec, capturedAt };
}

/** The normalized graph the map draws: inventory + links. */
export function toSnapshot(
  inv: Inventory,
  flows: FlowsResult,
  cluster: string,
  clusterCidrs: Record<string, string[]>,
): Snapshot {
  return {
    cluster,
    capturedAt: flows.capturedAt,
    windowSec: flows.windowSec,
    namespaces: inv.namespaces,
    workloads: inv.workloads,
    routes: inv.routes,
    loadBalancers: inv.loadBalancers,
    edges: flows.edges,
    policies: inv.policies,
    clusterCidrs,
  };
}
