import type { KubeObjectLike, PodMetrics } from "./inventory";

export interface PromService {
  ns: string;
  name: string;
  port: number;
}

const NAMES = [
  "prometheus-server",
  "prometheus-operated",
  "kube-prometheus-stack-prometheus",
  "prometheus-k8s",
  "prometheus",
];

export const PROM_QUERIES: Record<keyof PodMetrics, string> = {
  cpu: 'sum by (namespace,pod) (rate(container_cpu_usage_seconds_total{container!=""}[5m]))',
  mem: 'sum by (namespace,pod) (container_memory_working_set_bytes{container!=""})',
  cpuLim: 'sum by (namespace,pod) (kube_pod_container_resource_limits{resource="cpu"})',
  memLim: 'sum by (namespace,pod) (kube_pod_container_resource_limits{resource="memory"})',
};

export function findPrometheus(services: KubeObjectLike[]): PromService | null {
  const svcs = services.filter((s) => s.kind === "Service");
  const s =
    NAMES.map((n) => svcs.find((x) => x.metadata.name === n)).find(Boolean) ??
    svcs.find((x) => x.metadata.labels?.["app.kubernetes.io/name"] === "prometheus");
  if (!s) return null;
  const ports: Array<{ name?: string; port: number }> = s.spec?.ports ?? [];
  const port =
    ports.find((p) => p.name === "http" || p.name === "web")?.port ??
    ports.find((p) => p.port === 9090)?.port ??
    ports.find((p) => p.port === 80)?.port ??
    ports[0]?.port;
  return port === undefined ? null : { ns: s.metadata.namespace ?? "", name: s.metadata.name, port };
}

export const promPath = (p: PromService) =>
  `/api/v1/namespaces/${p.ns}/services/${p.name}:${p.port}/proxy/api/v1/query`;

interface PromBody {
  status?: string;
  data?: { result?: Array<{ metric?: { namespace?: string; pod?: string }; value?: [number, string] }> };
}

const parse = (body: unknown): Record<string, number> => {
  const b = body as PromBody | undefined;
  if (b?.status !== "success") return {};
  const out: Record<string, number> = {};
  for (const r of b.data?.result ?? []) {
    const v = Number(r.value?.[1]);
    if (r.metric?.namespace && r.metric.pod && Number.isFinite(v)) out[`${r.metric.namespace}/${r.metric.pod}`] = v;
  }
  return out;
};

export function promToMetrics(results: Partial<Record<keyof PodMetrics, unknown>>): PodMetrics {
  return {
    cpu: parse(results.cpu),
    mem: parse(results.mem),
    cpuLim: parse(results.cpuLim),
    memLim: parse(results.memLim),
  };
}
