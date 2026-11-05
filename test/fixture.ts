// Loads an anonymized capture (test/fixtures/capture-a|b) for unit tests. Test-only: uses Node fs.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { promToMetrics } from "../src/common/graph/prometheus";

import type { KubeObjectLike, PodMetrics } from "../src/common/graph/inventory";

const dir = (name: string) => join(import.meta.dirname, "fixtures", name);
const items = (name: string, file: string) =>
  (JSON.parse(readFileSync(join(dir(name), file), "utf8")) as { items: KubeObjectLike[] }).items;
const prom = (name: string, m: string) =>
  JSON.parse(readFileSync(join(dir(name), `prom-${m}.json`), "utf8")) as unknown;

type Capture = "capture-a" | "capture-b";

/** The four raw Prometheus query bodies of a capture. */
export const promBodies = (name: Capture): Record<keyof PodMetrics, unknown> => ({
  cpu: prom(name, "cpu"),
  mem: prom(name, "mem"),
  cpuLim: prom(name, "cpulim"),
  memLim: prom(name, "memlim"),
});

// The core lists a capture serves; list items carry no kind, so the reader must set it from the path.
export const LISTED_KINDS: Record<string, string> = {
  "/apis/apps/v1/deployments": "Deployment",
  "/apis/apps/v1/statefulsets": "StatefulSet",
  "/apis/apps/v1/daemonsets": "DaemonSet",
  "/api/v1/pods": "Pod",
  "/api/v1/services": "Service",
  "/apis/networking.k8s.io/v1/ingresses": "Ingress",
  "/api/v1/namespaces": "Namespace",
};

/** A fake List over a capture: the core lists, without kind and apiVersion; null for anything else (missing CRD). */
export function fixtureList(name: Capture) {
  const { objects } = loadFixture(name);
  return async (path: string) => {
    const kind = LISTED_KINDS[path];
    return kind
      ? objects.filter((o) => o.kind === kind).map(({ kind: _, apiVersion: __, ...rest }) => rest as KubeObjectLike)
      : null;
  };
}

export function loadFixture(name: Capture) {
  const objects = [...items(name, "k8s.json"), ...items(name, "extra.json"), ...items(name, "policies.json")];
  const metrics: PodMetrics = promToMetrics(promBodies(name));
  const flows = readFileSync(join(dir(name), "flows.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map((l) => (JSON.parse(l) as { flow: unknown }).flow)
    .filter(Boolean);
  const raw = JSON.parse(readFileSync(join(dir(name), "cluster.json"), "utf8")) as {
    self: string;
    clusterCidrs: Record<string, string>;
  };
  const cluster = {
    self: raw.self,
    clusterCidrs: Object.fromEntries(Object.entries(raw.clusterCidrs).map(([k, v]) => [k, [v]])),
  };
  return { objects, metrics, flows, cluster };
}
