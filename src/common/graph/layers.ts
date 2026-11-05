import type { Layer } from "../store/map-store";
import type { MapEdge, PolicyRef, Snapshot, Thresholds, Workload } from "./types";

export interface ScoreContext {
  thresholds: Thresholds;
  traffic: number;
  prometheus: boolean;
  protectedNs: (ns: string) => boolean;
}

/** 0..1 badness of a workload on one layer; cpu and ram are neutral without Prometheus. */
export function score(w: Workload, layer: Layer, ctx: ScoreContext): number {
  switch (layer) {
    case "cpu":
      return ctx.prometheus ? (w.cpuLim ? w.cpu / w.cpuLim : w.cpu / 0.5) : 0;
    case "ram":
      return ctx.prometheus ? (w.memLim ? w.mem / w.memLim : w.mem / 2 ** 30) : 0;
    case "health":
      return w.ready < w.desired ? 1 : w.restarts >= ctx.thresholds.restarts ? 0.7 : 0;
    case "policy":
      return ctx.protectedNs(w.ns) ? 0 : 1;
    default:
      return ctx.traffic / 2;
  }
}

export function protectedNamespaces(policies: PolicyRef[]): (ns: string) => boolean {
  const all = policies.some((p) => p.kind === "CiliumClusterwideNetworkPolicy");
  const some = new Set(policies.map((p) => p.ns));
  return (ns) => all || some.has(ns);
}

export function linkVerdict(
  e: MapEdge,
  s: Snapshot,
  protectedNs: (ns: string) => boolean,
): "dropped" | "protected" | "default-allow" {
  if (e.rate && e.drops / e.rate > 0.01) return "dropped";
  const ns = s.workloads.find((w) => w.id === e.target)?.ns ?? (e.target.startsWith("ns:") ? e.target.slice(3) : null);
  return ns !== null && protectedNs(ns) ? "protected" : "default-allow";
}
