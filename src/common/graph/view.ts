import { inCidr } from "./classify";

import type {
  Endpoint,
  Filters,
  LoadBalancer,
  MapEdge,
  RawEdge,
  Route,
  Snapshot,
  Thresholds,
  View,
  Workload,
} from "./types";

// Node ids in a view: workload id, "ns:<ns>", "gateway:<ns>", "ingress", "internet"/"lan" (inbound), "world"/"internal" (egress),
// "net:<name>" (named network), "cluster:<name>", "infra" (nodes / API server).
export type NamedNetworks = Array<{ cidr: string; name: string }>;

const DB_APPS = new Set([
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
  "TCP/9000",
  "TCP/8123",
]);

const indexes = new WeakMap<
  Snapshot,
  {
    byId: Map<string, Workload>;
    gateways: Map<string, { lb: LoadBalancer; workload: string | null }>;
    gwNamespaces: Set<string>;
  }
>();
function index(s: Snapshot) {
  let ix = indexes.get(s);
  if (!ix) {
    const gateways = new Map<string, { lb: LoadBalancer; workload: string | null }>();
    for (const lb of s.loadBalancers.filter((l) => l.kind === "Gateway")) {
      // the gateway's pods are behind the LoadBalancer Service that shares its IP
      const svc = s.loadBalancers.find(
        (l) => l.kind === "Service" && l.ns === lb.ns && l.ips.some((ip) => lb.ips.includes(ip)),
      );
      gateways.set(`${lb.ns}/${lb.name}`, { lb, workload: svc?.target ?? null });
    }
    const gwNamespaces = new Set([...gateways.values()].map((g) => g.lb.ns));
    ix = { byId: new Map(s.workloads.map((w) => [w.id, w])), gateways, gwNamespaces };
    indexes.set(s, ix);
  }
  return ix;
}

const labelsMatch = (w: Workload, f: Filters) =>
  f.labels.every(([k, v]) => k in w.labels && (v == null || w.labels[k] === v));
export const workloadVisible = (w: Workload, f: Filters) =>
  !f.hiddenNs.has(w.ns) && !f.kinds.has(w.db ? "Database" : w.kind) && labelsMatch(w, f);

/** Inbound source for a LoadBalancer: public ones are reached from the Internet, private ones from the internal network. */
export const inboundOf = (lb: LoadBalancer | undefined) => (lb?.exposure === "public" ? "internet" : "lan");

/** Maps a flow endpoint onto the node drawn in `view`, or null when the filters hide it. */
export function mapEndpoint(
  ep: Endpoint,
  view: View,
  s: Snapshot,
  f: Filters,
  named: NamedNetworks = [],
): string | null {
  const { byId, gwNamespaces } = index(s);
  if (view === "@clusters")
    return ep.startsWith("@cluster:")
      ? `cluster:${ep.slice(9)}`
      : /^@(internet|internal):/.test(ep)
        ? null
        : `cluster:${s.cluster}`;
  if (ep.startsWith("@internet:")) return "world";
  if (ep.startsWith("@internal:")) {
    const net = ep.slice(10).split("/")[0]!;
    const hit = named.find((n) => inCidr(net, n.cidr));
    return hit ? `net:${hit.name}` : "internal";
  }
  if (ep.startsWith("@cluster:")) return `cluster:${ep.slice(9)}`;
  if (ep === "@host" || ep === "@kube-apiserver") return f.infra ? "infra" : null;
  if (ep.startsWith("@")) return f.hiddenNs.has(ep.slice(1)) ? null : `ns:${ep.slice(1)}`;
  const ns = ep.split("/")[0]!;
  const w = byId.get(ep);
  if (f.hiddenNs.has(ns) || (w && !workloadVisible(w, f)) || (!w && f.labels.length)) return null;
  if (!view) return `ns:${ns}`;
  if (ns === view) return w ? ep : null;
  if (gwNamespaces.has(ns)) return `gateway:${ns}`;
  return `ns:${ns}`;
}

/** Aggregates raw links into the links of `view`, plus declared gateway routes and LoadBalancer entry links. */
export function aggregate(
  s: Snapshot,
  view: View,
  rates: number[],
  f: Filters,
  named: NamedNetworks = [],
  list: RawEdge[] = s.edges,
): MapEdge[] {
  const { byId, gateways } = index(s);
  const live = list === s.edges;
  const m = new Map<string, MapEdge>();
  const add = (
    src: string | null,
    dst: string | null,
    o: {
      app?: string;
      rate?: number;
      drop?: number;
      route?: Route;
      lb?: LoadBalancer;
      samples?: RawEdge["samples"];
      idx?: number;
    } = {},
  ) => {
    if (!src || !dst || src === dst) return;
    const id = `${src}>${dst}`;
    let e = m.get(id);
    if (!e)
      m.set(
        id,
        (e = {
          id,
          source: src,
          target: dst,
          rate: 0,
          drops: 0,
          base: 0,
          bdrops: 0,
          apps: new Map(),
          routes: [],
          lbs: [],
          samples: [],
          idx: [],
          synthetic: true,
        }),
      );
    if (o.rate != null && o.app) {
      e.synthetic = false;
      e.rate += o.rate;
      e.drops += o.rate * (o.drop ?? 0);
      e.apps.set(o.app, (e.apps.get(o.app) ?? 0) + o.rate);
      const base = o.idx != null ? (s.edges[o.idx]?.flowsPerSec ?? 0) : o.rate;
      e.base += base;
      e.bdrops += base * (o.drop ?? 0);
    }
    if (o.idx != null) e.idx.push(o.idx);
    if (o.lb && !e.lbs.includes(o.lb)) e.lbs.push(o.lb);
    if (o.route && !e.routes.some((r) => r.host === o.route!.host && r.path === o.route!.path)) e.routes.push(o.route);
    if (o.samples) e.samples.push(...o.samples);
  };
  list.forEach((x, i) => {
    if (f.apps.has(x.app)) return;
    add(mapEndpoint(x.src, view, s, f, named), mapEndpoint(x.dst, view, s, f, named), {
      app: x.app,
      rate: rates[i] ?? x.flowsPerSec,
      drop: x.dropRate,
      ...(live ? { samples: x.samples, idx: i } : {}),
    });
  });
  if (view === "@clusters") return [...m.values()];

  // each route enters through its own Gateway; an Ingress through its controller, which the objects do not name
  const entries = new Set<string>();
  if (!f.apps.has("HTTP route")) {
    for (const r of s.routes) {
      const gwNs = r.gateway?.split("/")[0] ?? null;
      if (gwNs && f.hiddenNs.has(gwNs)) continue;
      // a route to a Service with no running pods falls back to the same-named workload, so the broken route stays visible
      const target = r.target ?? (byId.has(`${r.ns}/${r.service}`) ? `${r.ns}/${r.service}` : null);
      const w = target ? byId.get(target) : undefined;
      if (!w || !workloadVisible(w, f)) continue;
      const g = r.gateway ? gateways.get(r.gateway) : undefined;
      const src = !gwNs ? "ingress" : !view ? `ns:${gwNs}` : view === gwNs ? (g?.workload ?? null) : `gateway:${gwNs}`;
      const t = !view || view === gwNs ? `ns:${r.ns}` : r.ns === view ? target : null;
      if (!src || !t) continue;
      add(src, t, { route: r });
      if (gwNs) {
        add(inboundOf(g?.lb), src);
        entries.add(`${inboundOf(g?.lb)}>${src}`);
      }
    }
  }
  for (const lb of s.loadBalancers.filter((l) => l.kind === "Service" && l.target)) {
    const t = mapEndpoint(lb.target!, view, s, f, named);
    if (t && (!view || lb.ns === view || m.has(`internet>${t}`) || m.has(`lan>${t}`))) add(inboundOf(lb), t, { lb });
  }
  const out = [...m.values()];
  for (const id of entries) {
    const entry = m.get(id)!;
    entry.rate = out.filter((e) => e.source === entry.target).reduce((a, e) => a + e.rate, 0);
  }
  return out;
}

/** Namespace view: links within `hops` of the namespace's own workloads, plus the entry path into anything kept. 0 = all. */
export function scope(edges: MapEdge[], s: Snapshot, view: View, hops: 0 | 1 | 2): MapEdge[] {
  if (!view || !hops || view === "@clusters") return edges;
  const depth = new Map(s.workloads.filter((w) => w.ns === view).map((w) => [w.id, 0]));
  for (let d = 0; d < hops; d++)
    for (const e of edges)
      for (const [a, b] of [
        [e.source, e.target],
        [e.target, e.source],
      ] as const)
        if (depth.get(a) === d && !depth.has(b)) depth.set(b, d + 1);
  return edges.filter(
    (e) =>
      (depth.has(e.source) && depth.has(e.target) && Math.min(depth.get(e.source)!, depth.get(e.target)!) < hops) ||
      (["internet", "lan"].includes(e.source) && depth.has(e.target)),
  );
}

export const isProblem = (w: Workload, t: Thresholds) =>
  w.ready < w.desired ||
  w.restarts >= t.restarts ||
  (w.cpuLim != null && w.cpu / w.cpuLim > t.cpu / 100) ||
  (w.memLim != null && w.mem / w.memLim > t.ram / 100);

/** Quick views and panel filters applied after aggregation, on captured (base) rates so links don't flicker. */
export function refine(
  edges: MapEdge[],
  s: Snapshot,
  view: View,
  f: Filters,
  t: Thresholds,
): { edges: MapEdge[]; keep: Set<string> | null } {
  const { byId } = index(s);
  const problemNode = (id: string) => {
    const w = byId.get(id);
    return w
      ? isProblem(w, t)
      : id.startsWith("ns:") && s.workloads.some((x) => x.ns === id.slice(3) && isProblem(x, t));
  };
  const inside = (id: string) =>
    view ? byId.get(id)?.ns === view : id.startsWith("ns:") && s.namespaces.includes(id.slice(3));
  let es = edges,
    narrow = f.hideIdle || f.changes;
  if (f.minRate > 0) es = es.filter((e) => e.synthetic || e.base >= f.minRate);
  if (f.drops) {
    narrow = true;
    es = es.filter((e) => e.bdrops > 0);
  }
  if (f.direction !== "all") {
    narrow = true;
    es = es.filter((e) => {
      const a = inside(e.source),
        b = inside(e.target);
      return f.direction === "inbound" ? !a && b : f.direction === "outbound" ? a && !b : a && b;
    });
  }
  if (f.exposed) {
    // LB -> gateway -> namespace, or LB -> gateway -> service -> its datastores
    narrow = true;
    const reach = new Map([
        ["internet", 0],
        ["lan", 0],
      ]),
      max = view ? 3 : 2;
    for (let d = 0; d < max; d++)
      for (const e of es)
        if (reach.get(e.source) === d && !reach.has(e.target) && !["world", "internal"].includes(e.target))
          reach.set(e.target, d + 1);
    es = es.filter(
      (e) => reach.has(e.source) && reach.get(e.source)! < max && reach.get(e.target) === reach.get(e.source)! + 1,
    );
  }
  if (f.dbs) {
    narrow = true;
    es = es.filter(
      (e) => byId.get(e.source)?.db || byId.get(e.target)?.db || [...e.apps.keys()].some((a) => DB_APPS.has(a)),
    );
  }
  if (f.problems) {
    narrow = true;
    es = es.filter(
      (e) =>
        (e.base && e.bdrops / e.base > 0.01) ||
        (e.synthetic && byId.get(e.target)?.ready === 0) ||
        problemNode(e.source) ||
        problemNode(e.target),
    );
  }
  if (!narrow) return { edges: es, keep: null };
  const keep = new Set(es.flatMap((e) => [e.source, e.target]));
  if (f.problems)
    for (const w of s.workloads) if ((!view || w.ns === view) && isProblem(w, t)) keep.add(view ? w.id : `ns:${w.ns}`);
  return { edges: es, keep };
}

/** "What changed": links present now but not in the baseline (new), and the reverse (gone). */
export function diff(current: MapEdge[], baseline: MapEdge[]): MapEdge[] {
  const b = new Set(baseline.map((e) => e.id)),
    c = new Set(current.map((e) => e.id));
  return [
    ...current.filter((e) => !e.synthetic && !b.has(e.id)).map((e) => ({ ...e, change: "new" as const })),
    ...baseline.filter((e) => !e.synthetic && !c.has(e.id)).map((e) => ({ ...e, change: "gone" as const, rate: 0 })),
  ];
}

/** Everything a view needs: aggregate → scope → (diff vs baseline) → refine. */
export function pipeline(
  s: Snapshot,
  view: View,
  rates: number[],
  f: Filters,
  hops: 0 | 1 | 2,
  t: Thresholds,
  baseline?: Snapshot,
  named: NamedNetworks = [],
) {
  let es = scope(aggregate(s, view, rates, f, named), s, view, hops);
  if (f.changes && baseline)
    es = diff(
      es,
      scope(
        aggregate(
          baseline,
          view,
          baseline.edges.map((e) => e.flowsPerSec),
          f,
          named,
        ),
        baseline,
        view,
        hops,
      ),
    );
  return refine(es, s, view, f, t);
}

/** Card label inside a Helm release box: shop-mongodb-mongodb in release shop-mongodb -> mongodb. */
export const shortName = (w: Workload) =>
  w.release && w.name.startsWith(`${w.release}-`) ? w.name.slice(w.release.length + 1) : w.name;
