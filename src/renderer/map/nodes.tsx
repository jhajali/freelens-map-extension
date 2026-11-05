// Map nodes: workload card, namespace card, outside box, Helm release box. Health is the left edge and a shape, never color alone.
import { Handle, type NodeProps, Position } from "@xyflow/react";
import { type CSSProperties, createContext, useContext } from "react";
import { shortName } from "../../common/graph/view";
import controlPlane from "../icons/k8s/control-plane.svg?raw";
import deploy from "../icons/k8s/deploy.svg?raw";
import ds from "../icons/k8s/ds.svg?raw";
import ing from "../icons/k8s/ing.svg?raw";
import node from "../icons/k8s/node.svg?raw";
import ns from "../icons/k8s/ns.svg?raw";
import sts from "../icons/k8s/sts.svg?raw";
import styles from "./service-map.module.scss";

import type { Snapshot, Workload } from "../../common/graph/types";

export const MapContext = createContext<{ s: Snapshot; byId: Map<string, Workload>; restarts: number }>(null as never);

// as <img>: the Inkscape files share element ids, which would clash inline
const src = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
const KIND_ICON = { Deployment: deploy, StatefulSet: sts, DaemonSet: ds, KubeBlocks: sts };

/** 0 healthy, 0.7 restarting, 1 not all pods ready. */
const health = (w: Workload, restarts: number) => (w.ready < w.desired ? 1 : w.restarts >= restarts ? 0.7 : 0);
const tone = (v: number) => (v < 0.6 ? "var(--good)" : v < 0.85 ? "var(--warn)" : "var(--crit)");
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
  const { byId, restarts } = useContext(MapContext);
  const w = byId.get(id)!;
  const v = health(w, restarts);
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
          <div className={styles.name} title={w.name}>
            {shortName(w)}
          </div>
          <div className={styles.sub}>{w.kind === "KubeBlocks" ? w.chart : w.kind}</div>
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
      <div className={`${styles.row} ${styles.sub}`}>CPU/RAM need Prometheus</div>
    </div>
  );
}

export function NamespaceNode({ id, data }: NodeProps) {
  const { s, restarts } = useContext(MapContext);
  const name = id.slice(3);
  const ws = s.workloads.filter((w) => w.ns === name);
  const worst = Math.max(0, ...ws.map((w) => health(w, restarts)));
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
          <div className={styles.name}>{name}</div>
          <div className={styles.sub}>
            {ws.length} workloads, {releases} releases
          </div>
        </div>
      </div>
      <div className={styles.row}>
        Pods {ready}/{want}
        {ready < want && <span className={styles.warn}> ● degraded</span>}
      </div>
    </div>
  );
}

const lbIps = (s: Snapshot, exposure: "public" | "internal") =>
  [...new Set(s.loadBalancers.filter((l) => l.exposure === exposure).flatMap((l) => l.ips))].join(", ");

function outside(id: string, s: Snapshot): [string | null, string, string] {
  if (id === "internet")
    return [null, "Internet (inbound)", lbIps(s, "public") ? `public LB ${lbIps(s, "public")}` : "no public LB"];
  if (id === "lan")
    return [
      null,
      "Internal network (inbound)",
      lbIps(s, "internal") ? `internal LB ${lbIps(s, "internal")}` : "no internal LB",
    ];
  if (id === "world") return [null, "Internet", "egress to public IPs"];
  if (id === "internal") return [null, "Internal network", "private IPs, not a known cluster"];
  if (id === "infra") return [node, "Nodes / API server", "host & control-plane traffic"];
  if (id.startsWith("gateway:")) return [ing, "Gateway", `${id.slice(8)} · HTTPRoutes`];
  if (id === "ingress") return [ing, "Ingress", "Ingress routes"];
  if (id.startsWith("cluster:"))
    return [controlPlane, id.slice(8), id.slice(8) === s.cluster ? "this cluster" : "other cluster"];
  if (id.startsWith("net:")) return [null, id.slice(4), "named network"];
  return [ns, id.replace(/^ns:/, ""), "other namespace · double-click"];
}

export function OutsideNode({ id }: NodeProps) {
  const { s } = useContext(MapContext);
  const [icon, title, sub] = outside(id, s);
  return (
    <div className={id.startsWith("cluster:") ? `${styles.ext} ${styles.cluster}` : styles.ext}>
      <Handles />
      <div className={styles.head}>
        {icon && <img alt="" src={src(icon)} />}
        <div>
          <div className={styles.name}>{title}</div>
          <div className={styles.sub}>{sub}</div>
        </div>
      </div>
    </div>
  );
}

export function ReleaseBox({ data }: NodeProps) {
  const { s } = useContext(MapContext);
  const chart = s.workloads.find((w) => w.ns === data.view && w.release === data.name && w.chart)?.chart;
  return (
    <div className={styles.group}>
      ⎈ <b>{data.name as string}</b>
      {chart && <span className={styles.chart}>{chart}</span>}
    </div>
  );
}

export const nodeTypes = { card: Card, ns: NamespaceNode, ext: OutsideNode, grp: ReleaseBox };
