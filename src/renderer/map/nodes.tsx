// Map nodes: workload card, namespace card, outside box, Helm release box. Health is the left edge and a shape, never color alone.
import { Renderer } from "@freelensapp/extensions";
import { Handle, type NodeProps, Position } from "@xyflow/react";
import { type CSSProperties, createContext, useContext } from "react";
import { realNames } from "../../common/graph/anonymize";
import { score } from "../../common/graph/layers";
import { shortName } from "../../common/graph/view";
import controlPlane from "../icons/k8s/control-plane.svg?raw";
import deploy from "../icons/k8s/deploy.svg?raw";
import ds from "../icons/k8s/ds.svg?raw";
import ing from "../icons/k8s/ing.svg?raw";
import node from "../icons/k8s/node.svg?raw";
import ns from "../icons/k8s/ns.svg?raw";
import sts from "../icons/k8s/sts.svg?raw";
import styles from "./service-map.module.scss";

import type { Alias } from "../../common/graph/anonymize";
import type { Snapshot, Thresholds, Workload } from "../../common/graph/types";
import type { Layer } from "../../common/store/map-store";

/** How names are shown: real, or the snapshot's aliases with "Anonymize names" on. */
export const AliasContext = createContext<Alias>(realNames);

export const MapContext = createContext<{
  s: Snapshot;
  byId: Map<string, Workload>;
  thresholds: Thresholds;
  layer: Layer;
  protectedNs: (ns: string) => boolean;
  /** flows/s in and out of each node of the view */
  rates: Map<string, number>;
  prometheus: boolean;
  /** link labels shown; absent means shown */
  labels?: boolean;
  sampled: { cpu: Set<string>; mem: Set<string> };
  /** the catalog's clusters, in the all-clusters view only */
  clusters?: Array<{ id: string; name: string; status: string }>;
}>(null as never);

export const cpuText = (cores: number) => (cores < 1 ? `${Math.round(cores * 1000)}m` : cores.toFixed(2));
export const memText = (bytes: number) =>
  bytes >= 2 ** 30 ? `${(bytes / 2 ** 30).toFixed(1)}Gi` : `${Math.round(bytes / 2 ** 20)}Mi`;
const ofLimit = (v: number, lim: number | null) => (lim ? ` (${Math.round((v / lim) * 100)}%)` : "");

// as <img>: the Inkscape files share element ids, which would clash inline
export const src = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
export const KIND_ICON = { Deployment: deploy, StatefulSet: sts, DaemonSet: ds, KubeBlocks: sts };

export const tone = (v: number) => (v < 0.6 ? "var(--good)" : v < 0.85 ? "var(--warn)" : "var(--crit)");
const Glyph = ({ v }: { v: number }) => (
  <span
    className={styles.glyph}
    role="img"
    aria-label={v < 0.6 ? "ok" : v < 0.85 ? "busy" : "trouble"}
    style={{ color: tone(v) }}
  >
    {v < 0.6 ? "●" : v < 0.85 ? "▲" : "■"}
  </span>
);
const Handles = () => (
  <>
    <Handle type="target" position={Position.Left} />
    <Handle type="source" position={Position.Right} />
  </>
);

export function Card({ id, data }: NodeProps) {
  const { s, byId, thresholds, layer, protectedNs, rates, prometheus, sampled } = useContext(MapContext);
  const a = useContext(AliasContext);
  const w = byId.get(id);
  // a workload gone from the snapshot while the previous layout is still drawn
  if (!w) return null;
  const v = score(w, layer, { thresholds, traffic: rates.get(id) ?? 0, prometheus, protectedNs });
  return (
    <div
      data-testid="workload-card"
      className={styles.card}
      style={{ "--st": tone(v), height: data.h as number } as CSSProperties}
    >
      <Handles />
      <Glyph v={v} />
      <div className={styles.head}>
        <img alt="" src={src(KIND_ICON[w.kind])} />
        <div>
          <div className={styles.name} title={a === realNames ? w.name : a("svc", w.id)}>
            {nameOf(id, s, byId, a)}
          </div>
          <div className={styles.sub}>{w.kind === "KubeBlocks" ? w.chart && a("chart", w.chart) : w.kind}</div>
        </div>
        {w.db && <span className={styles.badge}>DB</span>}
      </div>
      <div className={styles.row}>
        {Array.from({ length: Math.max(w.desired, w.ready) }, (_, i) => (
          <span key={i} className={i < w.ready ? styles.dot : `${styles.dot} ${styles.dotOff}`} />
        ))}{" "}
        {w.ready}/{w.desired} pods
        {w.restarts > 0 && <span className={styles.warn}> ⟳ {w.restarts} restarts</span>}
      </div>
      {prometheus ? (
        <div className={styles.row}>
          CPU {sampled.cpu.has(id) ? cpuText(w.cpu) + ofLimit(w.cpu, w.cpuLim) : "–"} · RAM{" "}
          {sampled.mem.has(id) ? memText(w.mem) + ofLimit(w.mem, w.memLim) : "–"}
        </div>
      ) : (
        <div className={`${styles.row} ${styles.sub}`}>CPU/RAM need Prometheus</div>
      )}
      <div className={styles.row}>{(rates.get(id) ?? 0).toFixed(2)} flows/s</div>
    </div>
  );
}

export function NamespaceNode({ id, data }: NodeProps) {
  const { s, thresholds, layer, protectedNs, rates, prometheus } = useContext(MapContext);
  const a = useContext(AliasContext);
  const name = id.slice(3);
  const ws = s.workloads.filter((w) => w.ns === name);
  const worst = Math.max(
    0,
    ...ws.map((w) => score(w, layer, { thresholds, traffic: rates.get(id) ?? 0, prometheus, protectedNs })),
  );
  const ready = ws.reduce((a, w) => a + w.ready, 0),
    want = ws.reduce((a, w) => a + w.desired, 0);
  const releases = new Set(ws.map((w) => w.release).filter(Boolean)).size;
  return (
    <div
      data-testid="ns-card"
      className={styles.nsCard}
      style={{ "--st": tone(worst), height: data.h as number } as CSSProperties}
      title="Double-click to open"
    >
      <Handles />
      <Glyph v={worst} />
      <div className={styles.head}>
        <img alt="" src={src(ns)} />
        <div>
          <div className={styles.name}>{a("ns", name)}</div>
          <div className={styles.sub}>
            {ws.length} workloads, {releases} releases
          </div>
        </div>
      </div>
      <div className={styles.row}>
        Pods {ready}/{want}
        {ready < want && <span className={styles.warn}> ● degraded</span>}
      </div>
      {prometheus && (
        <div className={styles.row}>
          CPU {cpuText(ws.reduce((a, x) => a + x.cpu, 0))} · RAM {memText(ws.reduce((a, x) => a + x.mem, 0))}
        </div>
      )}
    </div>
  );
}

const lbIps = (s: Snapshot, exposure: "public" | "internal", a: Alias) =>
  [...new Set(s.loadBalancers.filter((l) => l.exposure === exposure).flatMap((l) => l.ips))]
    .map((ip) => a("ip", ip))
    .join(", ");

function outside(id: string, s: Snapshot, a: Alias): [string | null, string, string] {
  if (id === "internet")
    return [null, "Internet (inbound)", lbIps(s, "public", a) ? `public LB ${lbIps(s, "public", a)}` : "no public LB"];
  if (id === "lan")
    return [
      null,
      "Internal network (inbound)",
      lbIps(s, "internal", a) ? `internal LB ${lbIps(s, "internal", a)}` : "no internal LB",
    ];
  if (id === "world") return [null, "Internet", "egress to public IPs"];
  if (id === "internal") return [null, "Internal network", "private IPs, not a known cluster"];
  if (id === "infra") return [node, "Nodes / API server", "host & control-plane traffic"];
  if (id.startsWith("gateway:")) return [ing, "Gateway", `${a("ns", id.slice(8))} · HTTPRoutes`];
  if (id === "ingress") return [ing, "Ingress", "Ingress routes"];
  if (id.startsWith("cluster:"))
    return [controlPlane, a("cluster", id.slice(8)), id.slice(8) === s.cluster ? "this cluster" : "other cluster"];
  if (id.startsWith("net:")) return [null, a("net", id.slice(4)), "named network"];
  return [ns, a("ns", id.replace(/^ns:/, "")), "other namespace · double-click"];
}

/** The name a node shows, and search matches: its real name, or its alias with "Anonymize names" on. */
export function nameOf(id: string, s: Snapshot, byId: Map<string, Workload>, a: Alias = realNames): string {
  const w = byId.get(id);
  if (w) return a === realNames ? shortName(w) : a("svc", w.id);
  return id.startsWith("ns:") ? a("ns", id.slice(3)) : outside(id, s, a)[1];
}

export function OutsideNode({ id }: NodeProps) {
  const { s, clusters } = useContext(MapContext);
  const [icon, title, sub] = outside(id, s, useContext(AliasContext));
  const name = id.startsWith("cluster:") ? id.slice(8) : "";
  const other = clusters && name !== s.cluster ? (clusters.find((c) => c.name === name) ?? null) : null;
  return (
    <div className={id.startsWith("cluster:") ? `${styles.ext} ${styles.cluster}` : styles.ext}>
      <Handles />
      <div className={styles.head}>
        {icon && <img alt="" src={src(icon)} />}
        <div>
          <div className={styles.name}>{title}</div>
          <div className={styles.sub}>
            {clusters && name
              ? name === s.cluster
                ? "this cluster · double-click"
                : other
                  ? other.status === "connected"
                    ? "connected in Freelens · "
                    : "not live here · "
                  : "not live here"
              : sub}
            {other && (
              <button
                type="button"
                className="nodrag"
                onClick={() => Renderer.Navigation.navigate(`/cluster/${other.id}`)}
              >
                {other.status === "connected" ? "Open" : "Connect"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export function ReleaseBox({ data }: NodeProps) {
  const { s } = useContext(MapContext);
  const a = useContext(AliasContext);
  const chart = s.workloads.find((w) => w.ns === data.view && w.release === data.name && w.chart)?.chart;
  return (
    <div className={styles.group}>
      ⎈ <b>{a("release", data.name as string)}</b>
      {chart && <span className={styles.chart}>{a("chart", chart)}</span>}
    </div>
  );
}

export const nodeTypes = { card: Card, ns: NamespaceNode, ext: OutsideNode, grp: ReleaseBox };
