import { isDatabaseName, lbExposure, lbProvider, PUBLIC_ENDPOINT_ANNOTATION } from "./classify";

import type { LoadBalancer, PodInfo, PolicyRef, Route, Workload, WorkloadKind } from "./types";

// raw Kubernetes JSON; each reader below picks only the fields it needs
type Any = any;

export interface KubeObjectLike {
  kind: string;
  apiVersion?: string;
  metadata: {
    name: string;
    namespace?: string;
    labels?: Record<string, string>;
    annotations?: Record<string, string>;
    ownerReferences?: Array<{ kind: string; name: string }>;
  };
  spec?: Any;
  status?: Any;
}

/** Pod metrics keyed "ns/pod": CPU cores, memory bytes, and limits. */
export interface PodMetrics {
  cpu: Record<string, number>;
  mem: Record<string, number>;
  cpuLim: Record<string, number>;
  memLim: Record<string, number>;
}

export interface Inventory {
  namespaces: string[];
  workloads: Workload[];
  routes: Route[];
  loadBalancers: LoadBalancer[];
  policies: PolicyRef[];
  podToWorkload: Record<string, string>;
  /** workload id → DNS name of a Service in front of it */
  serviceDns: Record<string, string>;
  /** "<workloadId>|<pod port>" → DNS name of the Service exposing that port */
  serviceDnsByPort: Record<string, string>;
  /** Service ClusterIP → Service */
  clusterIps: Record<string, { ns: string; name: string }>;
}

export const SYSTEM_NAMESPACES = new Set(["kube-system", "kube-node-lease", "kube-public", "cilium-secrets"]);
const POLICY_KINDS = new Set(["NetworkPolicy", "CiliumNetworkPolicy", "CiliumClusterwideNetworkPolicy"]);

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const matches = (selector: Record<string, string>, labels: Record<string, string> = {}) =>
  Object.entries(selector).every(([k, v]) => labels[k] === v);

export function buildInventory(
  objects: KubeObjectLike[],
  metrics: PodMetrics,
  opts: { lbPublic?: Record<string, string> } = {},
): Inventory {
  const of = (kind: string) => objects.filter((o) => o.kind === kind);
  const kbClusters = new Map(
    of("Cluster")
      .filter((o) => o.apiVersion?.includes("kubeblocks"))
      .map((o) => [`${o.metadata.namespace}/${o.metadata.name}`, o]),
  );
  const workloads = new Map<string, Workload>();
  const add = (o: KubeObjectLike, kind: WorkloadKind, fields: Partial<Workload>) => {
    const ns = o.metadata.namespace ?? "";
    if (SYSTEM_NAMESPACES.has(ns)) return;
    const id = `${ns}/${o.metadata.name}`;
    workloads.set(id, {
      id,
      ns,
      name: o.metadata.name,
      kind,
      release: null,
      chart: null,
      image: "",
      desired: 1,
      ready: 0,
      db: false,
      labels: o.metadata.labels ?? {},
      pods: [],
      restarts: 0,
      cpu: 0,
      mem: 0,
      cpuLim: null,
      memLim: null,
      ...fields,
    });
  };

  for (const kind of ["Deployment", "StatefulSet", "DaemonSet"] as const) {
    for (const o of of(kind)) {
      const image =
        String(o.spec?.template?.spec?.containers?.[0]?.image ?? "")
          .split("/")
          .pop() ?? "";
      const labels = o.metadata.labels ?? {};
      add(o, kind, {
        release: o.metadata.annotations?.["meta.helm.sh/release-name"] ?? labels["app.kubernetes.io/instance"] ?? null,
        chart: labels["helm.sh/chart"] ?? null,
        image,
        desired: o.spec?.replicas ?? o.status?.desiredNumberScheduled ?? 1,
        ready: o.status?.readyReplicas ?? o.status?.numberReady ?? 0,
        db: isDatabaseName(`${o.metadata.name} ${image}`),
      });
    }
  }
  for (const o of of("InstanceSet")) {
    const labels = o.metadata.labels ?? {};
    const release = labels["app.kubernetes.io/instance"] ?? null;
    const cluster = kbClusters.get(`${o.metadata.namespace}/${release}`);
    add(o, "KubeBlocks", {
      release,
      chart: cluster?.spec?.componentSpecs?.[0]?.componentDef ?? null,
      image: labels["apps.kubeblocks.io/component-name"] ?? "",
      desired: o.spec?.replicas ?? 1,
      ready: o.status?.readyReplicas ?? 0,
      db: true,
    });
  }

  // Pods → their workload (ReplicaSet "<deployment>-<hash>" folds into the Deployment); Job and bare pods map to nothing.
  const podToWorkload: Record<string, string> = {};
  const podLabels = new Map<string, Record<string, string>>();
  const containerPorts = new Map<string, Record<string, number>>();
  for (const p of of("Pod")) {
    const ns = p.metadata.namespace ?? "",
      key = `${ns}/${p.metadata.name}`;
    podLabels.set(key, p.metadata.labels ?? {});
    const owner = p.metadata.ownerReferences?.[0];
    if (!owner) continue;
    const ownerName = owner.kind === "ReplicaSet" ? owner.name.replace(/-[a-z0-9]+$/, "") : owner.name;
    const w = workloads.get(`${ns}/${ownerName}`);
    if (!w) continue;
    podToWorkload[key] = w.id;
    const ports: Record<string, number> = {};
    for (const c of p.spec?.containers ?? [])
      for (const port of c.ports ?? []) if (port.name) ports[port.name] = port.containerPort;
    containerPorts.set(w.id, { ...containerPorts.get(w.id), ...ports });
    const info: PodInfo = {
      name: p.metadata.name,
      phase: p.status?.phase ?? "Unknown",
      restarts: sum((p.status?.containerStatuses ?? []).map((s: Any) => s.restartCount ?? 0)),
      cpu: metrics.cpu[key] ?? 0,
      mem: metrics.mem[key] ?? 0,
      cpuLim: metrics.cpuLim[key] ?? null,
      memLim: metrics.memLim[key] ?? null,
    };
    w.pods.push(info);
  }
  for (const w of workloads.values()) {
    w.restarts = sum(w.pods.map((p) => p.restarts));
    w.cpu = sum(w.pods.map((p) => p.cpu));
    w.mem = sum(w.pods.map((p) => p.mem));
    const all = (k: "cpuLim" | "memLim") =>
      w.pods.length && w.pods.every((p) => p[k] != null) ? sum(w.pods.map((p) => p[k]!)) : null;
    w.cpuLim = all("cpuLim");
    w.memLim = all("memLim");
  }

  // Services → workload (selector on pod labels), DNS names by port, ClusterIPs.
  const svcToWorkload: Record<string, string> = {};
  const serviceDns: Record<string, string> = {},
    serviceDnsByPort: Record<string, string> = {};
  const clusterIps: Record<string, { ns: string; name: string }> = {};
  for (const s of of("Service")) {
    const ns = s.metadata.namespace ?? "",
      name = s.metadata.name,
      dns = `${name}.${ns}.svc.cluster.local`;
    const ip = s.spec?.clusterIP;
    if (ip && ip !== "None") clusterIps[ip] = { ns, name };
    const selector = s.spec?.selector as Record<string, string> | undefined;
    if (!selector || SYSTEM_NAMESPACES.has(ns)) continue;
    const wid = Object.entries(podToWorkload).find(
      ([pod, w]) => pod.startsWith(`${ns}/`) && workloads.has(w) && matches(selector, podLabels.get(pod)),
    )?.[1];
    if (!wid) continue;
    svcToWorkload[`${ns}/${name}`] = wid;
    serviceDns[wid] ??= dns;
    for (const sp of s.spec?.ports ?? []) {
      const target = typeof sp.targetPort === "string" ? containerPorts.get(wid)?.[sp.targetPort] : sp.targetPort;
      for (const port of [sp.port, target]) if (typeof port === "number") serviceDnsByPort[`${wid}|${port}`] = dns;
    }
  }

  const routes: Route[] = [];
  for (const r of of("HTTPRoute")) {
    const ns = r.metadata.namespace ?? "";
    if (SYSTEM_NAMESPACES.has(ns)) continue;
    const parent = r.spec?.parentRefs?.[0];
    for (const rule of r.spec?.rules ?? []) {
      for (const b of rule.backendRefs ?? []) {
        routes.push({
          ns,
          name: r.metadata.name,
          kind: "HTTPRoute",
          gateway: parent ? `${parent.namespace ?? ns}/${parent.name}` : null,
          host: r.spec?.hostnames?.[0] ?? null,
          path: rule.matches?.[0]?.path?.value ?? "/",
          service: b.name,
          port: b.port ?? null,
          target: svcToWorkload[`${ns}/${b.name}`] ?? null,
        });
      }
    }
  }
  for (const i of of("Ingress")) {
    const ns = i.metadata.namespace ?? "";
    if (SYSTEM_NAMESPACES.has(ns)) continue;
    for (const rule of i.spec?.rules ?? []) {
      for (const p of rule.http?.paths ?? []) {
        const svc = p.backend?.service;
        if (!svc) continue;
        routes.push({
          ns,
          name: i.metadata.name,
          kind: "Ingress",
          gateway: null,
          host: rule.host ?? null,
          path: p.path ?? "/",
          service: svc.name,
          port: svc.port?.number ?? null,
          target: svcToWorkload[`${ns}/${svc.name}`] ?? null,
        });
      }
    }
  }

  const loadBalancers: LoadBalancer[] = [];
  for (const s of of("Service").filter((o) => o.spec?.type === "LoadBalancer")) {
    const ingress: Array<{ ip?: string; hostname?: string }> = s.status?.loadBalancer?.ingress ?? [];
    const ips = ingress.map((x) => x.ip ?? x.hostname ?? "").filter(Boolean);
    const annotations = s.metadata.annotations ?? {};
    const publicEndpoint =
      annotations[PUBLIC_ENDPOINT_ANNOTATION] ?? opts.lbPublic?.[`${s.metadata.namespace}/${s.metadata.name}`] ?? null;
    loadBalancers.push({
      kind: "Service",
      ns: s.metadata.namespace ?? "",
      name: s.metadata.name,
      ips,
      ports: (s.spec?.ports ?? []).map((p: Any) => ({
        name: p.name ?? null,
        port: p.port,
        protocol: p.protocol ?? "TCP",
      })),
      provider: lbProvider(
        annotations,
        ingress.map((x) => x.hostname ?? "").filter(Boolean),
        s.spec?.loadBalancerClass,
      ),
      exposure: lbExposure(ips, publicEndpoint),
      publicEndpoint,
      target: svcToWorkload[`${s.metadata.namespace}/${s.metadata.name}`] ?? null,
    });
  }
  for (const g of of("Gateway")) {
    const ips: string[] = (g.status?.addresses ?? []).map((a: Any) => a.value);
    const fronting = loadBalancers.find((l) => l.ips.some((ip) => ips.includes(ip)));
    loadBalancers.push({
      kind: "Gateway",
      ns: g.metadata.namespace ?? "",
      name: g.metadata.name,
      ips,
      ports: (g.spec?.listeners ?? []).map((l: Any) => ({
        name: l.name ?? null,
        port: l.port,
        protocol: l.protocol,
        hostname: l.hostname ?? null,
      })),
      provider: fronting?.provider ?? g.spec?.gatewayClassName ?? "Gateway",
      exposure: fronting?.exposure ?? lbExposure(ips, null),
      publicEndpoint: fronting?.publicEndpoint ?? null,
      target: null,
    });
  }

  const policies: PolicyRef[] = objects
    .filter((o) => POLICY_KINDS.has(o.kind))
    .map((o) => ({ kind: o.kind, ns: o.metadata.namespace ?? null, name: o.metadata.name }));
  const all = [...workloads.values()];
  return {
    namespaces: [
      ...new Set([
        ...all.map((w) => w.ns),
        ...of("Namespace")
          .map((o) => o.metadata.name)
          .filter((n) => !SYSTEM_NAMESPACES.has(n)),
      ]),
    ].sort(),
    workloads: all,
    routes,
    loadBalancers,
    policies,
    podToWorkload,
    serviceDns,
    serviceDnsByPort,
    clusterIps,
  };
}
