import type { Endpoint } from "./types";

const PORTS: Record<number, string> = {
  5432: "PostgreSQL",
  27017: "MongoDB",
  6379: "Redis",
  3306: "MySQL",
  9092: "Kafka",
  5672: "AMQP",
  443: "HTTPS",
  8443: "HTTPS",
  80: "HTTP",
  8080: "HTTP",
  9000: "HTTP",
  53: "DNS",
  9200: "Elasticsearch",
  4222: "NATS",
  7687: "Bolt",
  4317: "OTLP gRPC",
  4318: "OTLP HTTP",
};
const DATA_APPS = new Set([
  "PostgreSQL",
  "MongoDB",
  "Redis",
  "MySQL",
  "Kafka",
  "Bolt",
  "AMQP",
  "Elasticsearch",
  "NATS",
  "TCP/6432",
  "TCP/8123",
  "TCP/9200",
]);
const DB_RE =
  /postgres|mongo|redis|mysql|maria|kafka|elastic|opensearch|rabbit|clickhouse|minio|nats|etcd|valkey|neo4j/i;

export const PUBLIC_ENDPOINT_ANNOTATION = "servicemap.freelens.io/public-endpoint";

/** Protocol shown on a link: well-known port name, else "<proto>/<port>", else the bare protocol (ICMP). */
export function appForPort(proto: string, port: number | null): string {
  if (port == null) return proto;
  return PORTS[port] ?? `${proto}/${port}`;
}

/** Link color family: blue web/API, teal databases/caches/queues, gray everything else. */
export function familyOf(app: string): "web" | "data" | "other" {
  if (DATA_APPS.has(app)) return "data";
  if (/HTTP|gRPC|OTLP/.test(app) || /^TCP\/(80|443|8080|3000|8000)$/.test(app)) return "web";
  return "other";
}

/** A workload is a database when its name or image says so; database UIs ("…-ui") are not. */
export function isDatabaseName(nameAndImage: string): boolean {
  const name = nameAndImage.split(/\s+/)[0] ?? "";
  return DB_RE.test(nameAndImage) && !name.endsWith("-ui");
}

export interface IpContext {
  self: string;
  clusterCidrs: Record<string, string>;
  namedNetworks: Array<{ cidr: string; name: string }>;
  clusterIps: Record<string, { ns: string; name: string }>;
}

const v4 = (ip: string) => ip.split(".").reduce((a, o) => a * 256 + Number(o), 0);
export function inCidr(ip: string, cidr: string): boolean {
  if (!ip.includes(".") || !cidr.includes(".")) return false;
  const [net, bits] = cidr.split("/");
  const size = 2 ** (32 - Number(bits));
  return Math.floor(v4(ip) / size) === Math.floor(v4(net!) / size);
}
export function isPrivateIp(ip: string): boolean {
  if (ip.includes(":")) return /^(f[cd]|fe[89ab])/i.test(ip) || ip === "::1";
  const [a, b] = ip.split(".").map(Number) as [number, number];
  return (
    a === 10 ||
    a === 127 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127)
  );
}

/** First four groups of an IPv6 address, trailing zero groups dropped: fd00::1 -> "fd00". */
function v6Prefix64(ip: string): string {
  const [head = "", tail = ""] = ip.split("::");
  const h = head ? head.split(":") : [],
    t = tail ? tail.split(":") : [];
  const groups = [...h, ...Array(8 - h.length - t.length).fill("0"), ...t]
    .slice(0, 4)
    .map((g) => g.replace(/^0+(?=.)/, ""));
  while (groups.length > 1 && groups[groups.length - 1] === "0") groups.pop();
  return groups.join(":");
}

/** Endpoint for an IP that is not a pod: this cluster's nodes, another known cluster, a Service VIP, internal or Internet. */
export function classifyIp(ip: string, ctx: IpContext): Endpoint {
  const svc = ctx.clusterIps[ip];
  if (svc) return `@${svc.ns}`;
  for (const [name, cidr] of Object.entries(ctx.clusterCidrs))
    if (inCidr(ip, cidr)) return name === ctx.self ? "@host" : `@cluster:${name}`;
  if (!isPrivateIp(ip)) return `@internet:${ip}`;
  if (ip.includes(":")) return `@internal:${v6Prefix64(ip)}::/64`;
  return `@internal:${ip.split(".").slice(0, 3).join(".")}.0/24`;
}

const PROVIDERS: Array<[string, string]> = [
  ["scw-loadbalancer", "Scaleway LB"],
  ["aws-load-balancer", "AWS ELB"],
  ["elb.amazonaws.com", "AWS ELB"],
  ["cloud.google.com", "GCP LB"],
  ["azure-load-balancer", "Azure LB"],
  ["metallb", "MetalLB"],
  ["lbipam.cilium.io", "Cilium LB-IPAM"],
];
export function lbProvider(
  annotations: Record<string, string>,
  hostnames: string[],
  loadBalancerClass?: string | null,
): string {
  const hay = [...Object.keys(annotations), ...hostnames].join(" ");
  return PROVIDERS.find(([needle]) => hay.includes(needle))?.[1] ?? loadBalancerClass ?? "Cilium LB-IPAM";
}

/** Public when any address is public or a hostname, or when a public endpoint is declared for it. */
export function lbExposure(addresses: string[], publicEndpoint: string | null): "public" | "internal" {
  if (publicEndpoint) return "public";
  return addresses.some((a) => !/^[\d.:a-f]+$/i.test(a) || !isPrivateIp(a)) ? "public" : "internal";
}
