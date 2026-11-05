// Loads an anonymized capture (test/fixtures/capture-a|b) for unit tests. Test-only: uses Node fs.
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { KubeObjectLike, PodMetrics } from "../src/common/graph/inventory";

const dir = (name: string) => join(import.meta.dirname, "fixtures", name);
const items = (name: string, file: string) =>
  (JSON.parse(readFileSync(join(dir(name), file), "utf8")) as { items: KubeObjectLike[] }).items;
const metric = (name: string, m: string) => {
  const res = JSON.parse(readFileSync(join(dir(name), `prom-${m}.json`), "utf8")) as {
    data: { result: Array<{ metric: { namespace?: string; pod?: string }; value: [number, string] }> };
  };
  return Object.fromEntries(res.data.result.map((r) => [`${r.metric.namespace}/${r.metric.pod}`, Number(r.value[1])]));
};

export function loadFixture(name: "capture-a" | "capture-b") {
  const objects = [...items(name, "k8s.json"), ...items(name, "extra.json"), ...items(name, "policies.json")];
  const metrics: PodMetrics = {
    cpu: metric(name, "cpu"),
    mem: metric(name, "mem"),
    cpuLim: metric(name, "cpulim"),
    memLim: metric(name, "memlim"),
  };
  const flows = readFileSync(join(dir(name), "flows.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map((l) => (JSON.parse(l) as { flow: unknown }).flow)
    .filter(Boolean);
  const cluster = JSON.parse(readFileSync(join(dir(name), "cluster.json"), "utf8")) as {
    self: string;
    clusterCidrs: Record<string, string>;
  };
  return { objects, metrics, flows, cluster };
}
