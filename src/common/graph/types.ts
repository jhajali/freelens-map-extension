// Shared graph model. Pure data: no Freelens, React, mobx or Node imports — used by renderer, main and tests.
export type WorkloadKind = "Deployment" | "StatefulSet" | "DaemonSet" | "KubeBlocks";
export interface PodInfo {
  name: string;
  phase: string;
  restarts: number;
  cpu: number;
  mem: number;
  cpuLim: number | null;
  memLim: number | null;
}
export interface Workload {
  id: string;
  ns: string;
  name: string;
  kind: WorkloadKind;
  release: string | null;
  chart: string | null;
  image: string;
  desired: number;
  ready: number;
  db: boolean;
  labels: Record<string, string>;
  pods: PodInfo[];
  restarts: number;
  cpu: number;
  mem: number;
  cpuLim: number | null;
  memLim: number | null;
}
export interface Route {
  ns: string;
  name: string;
  kind: "HTTPRoute" | "Ingress";
  gateway: string | null;
  host: string | null;
  path: string;
  service: string;
  port: number | null;
  target: string | null;
}
export interface LbPort {
  name: string | null;
  port: number;
  protocol: string;
  hostname?: string | null;
}
export interface LoadBalancer {
  kind: "Service" | "Gateway";
  ns: string;
  name: string;
  ips: string[];
  ports: LbPort[];
  provider: string;
  exposure: "public" | "internal";
  publicEndpoint: string | null;
  target: string | null;
}
/** workload id "ns/name" | "@internet:<ip|fqdn>" | "@internal:<cidr>" | "@cluster:<name>" | "@host" | "@kube-apiserver" | "@<namespace>" */
export type Endpoint = string;
export interface Sample {
  srcIp: string;
  srcPod: string | null;
  dstIp: string;
  dstPod: string | null;
  port: number | null;
  count: number;
  dns: string | null;
}
export interface RawEdge {
  src: Endpoint;
  dst: Endpoint;
  proto: string;
  port: number | null;
  app: string;
  flowsPerSec: number;
  connsPerSec: number;
  dropRate: number;
  samples: Sample[];
}
export interface PolicyRef {
  kind: string;
  ns: string | null;
  name: string;
}
export interface Snapshot {
  cluster: string;
  capturedAt: string;
  windowSec: number;
  namespaces: string[];
  workloads: Workload[];
  routes: Route[];
  loadBalancers: LoadBalancer[];
  edges: RawEdge[];
  policies: PolicyRef[];
  clusterCidrs: Record<string, string>;
}
/** null = cluster view, a namespace name = namespace view, "@clusters" = all clusters. */
export type View = null | string;
export type Direction = "all" | "inbound" | "outbound" | "internal";
export interface Filters {
  hiddenNs: Set<string>;
  labels: Array<[string, string | null]>;
  apps: Set<string>;
  kinds: Set<string>;
  direction: Direction;
  minRate: number;
  hideIdle: boolean;
  infra: boolean;
  problems: boolean;
  exposed: boolean;
  dbs: boolean;
  drops: boolean;
  changes: boolean;
}
export interface Thresholds {
  cpu: number;
  ram: number;
  restarts: number;
}
export const DEFAULT_THRESHOLDS: Thresholds = { cpu: 85, ram: 85, restarts: 1 };
export interface MapEdge {
  id: string;
  source: string;
  target: string;
  rate: number;
  drops: number;
  base: number;
  bdrops: number;
  apps: Map<string, number>;
  routes: Route[];
  lbs: LoadBalancer[];
  samples: Sample[];
  idx: number[];
  synthetic: boolean;
  change?: "new" | "gone";
}
export const NO_FILTERS: Filters = {
  hiddenNs: new Set(),
  labels: [],
  apps: new Set(),
  kinds: new Set(),
  direction: "all",
  minRate: 0,
  hideIdle: false,
  infra: false,
  problems: false,
  exposed: false,
  dbs: false,
  drops: false,
  changes: false,
};
