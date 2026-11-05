// Map links: libavoid's or ELK's orthogonal route with rounded corners, colored by protocol family; red only for drops and broken routes.
import { BaseEdge, EdgeLabelRenderer, type EdgeProps, getSmoothStepPath } from "@xyflow/react";
import { createContext, useContext } from "react";
import { familyOf } from "../../common/graph/classify";
import { linkVerdict } from "../../common/graph/layers";
import { AliasContext, MapContext } from "./nodes";
import { Particles, particlesFor } from "./particles";
import styles from "./service-map.module.scss";

import type { MapEdge } from "../../common/graph/types";
import type { Point } from "./layout";

export const RoutesContext = createContext<Record<string, Point[]>>({});
const ROLES = ["l-web", "l-data", "l-other", "l-route", "crit", "new", "gone"] as const;
const CHANGE = { new: "+ new", gone: "− gone" };

/** SVG path through `pts` with rounded corners, and the middle of its longest segment for the label. */
export function roundedPath(pts: Point[], r = 10): [string, number, number] {
  let d = `M${pts[0]!.x},${pts[0]!.y}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const a = pts[i - 1]!,
      b = pts[i]!,
      c = pts[i + 1]!;
    const k1 = Math.min(r, Math.hypot(b.x - a.x, b.y - a.y) / 2),
      k2 = Math.min(r, Math.hypot(c.x - b.x, c.y - b.y) / 2);
    const u = { x: Math.sign(b.x - a.x), y: Math.sign(b.y - a.y) },
      v = { x: Math.sign(c.x - b.x), y: Math.sign(c.y - b.y) };
    d += ` L${b.x - u.x * k1},${b.y - u.y * k1} Q${b.x},${b.y} ${b.x + v.x * k2},${b.y + v.y * k2}`;
  }
  const z = pts[pts.length - 1]!;
  d += ` L${z.x},${z.y}`;
  let best = 0,
    mid = pts[0]!;
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i]!,
      q = pts[i - 1]!,
      len = Math.hypot(p.x - q.x, p.y - q.y);
    if (len > best) [best, mid] = [len, { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 }];
  }
  return [d, mid.x, mid.y];
}

/** With a selection, only its own links (and the links of a selected node) stay bright. */
export const isFocused = (e: { id: string; source: string; target: string }, sel?: string | null) =>
  !sel || e.id === sel || e.source === sel || e.target === sel;

export function TrafficEdge({ id, target, data, ...at }: EdgeProps) {
  const routes = useContext(RoutesContext);
  const { s, byId, layer, protectedNs, labels } = useContext(MapContext);
  const a = useContext(AliasContext);
  const pts = routes[id];
  const { n: budgeted, focus, ...rest } = data as unknown as MapEdge & { n: number; focus: boolean };
  const e: MapEdge = rest;
  // no route (moved without libavoid): React Flow's own path between the handles
  const [path, lx, ly] = pts && pts.length > 1 ? roundedPath(pts) : getSmoothStepPath({ ...at, borderRadius: 10 });
  const drop = e.rate ? e.drops / e.rate : 0;
  const broken = e.synthetic && byId.get(target)?.ready === 0;
  const apps = [...e.apps].sort((a, b) => b[1] - a[1]).map((a) => a[0]);
  const verdict = layer === "policy" && !e.change && !e.synthetic ? linkVerdict(e, s, protectedNs) : null;
  const role = e.change
    ? e.change
    : drop > 0.01 || broken
      ? "crit"
      : verdict === "protected"
        ? "l-data"
        : verdict === "default-allow"
          ? "l-other"
          : e.synthetic
            ? "l-route"
            : `l-${familyOf(apps[0] ?? "")}`;
  const color = `var(--${role})`;
  const text = [
    apps.length
      ? `${apps.slice(0, 2).join(", ")} · ${e.rate.toFixed(2)}/s${drop > 0 ? ` · ${(drop * 100).toFixed(1)}% drop` : ""}`
      : e.routes.length
        ? "HTTP"
        : e.lbs.length
          ? `LB ${e.lbs.flatMap((l) => l.ips.map((ip) => a("ip", ip))).join(", ")}`
          : "",
    broken && "▲ no ready pods",
  ]
    .filter(Boolean)
    .join(" · ");
  const label = e.change ? `${CHANGE[e.change]} ${text}`.trim() : text;
  const dur = particlesFor(e.rate, false).durSec;
  return (
    <g style={{ opacity: focus ? 1 : 0.12, transition: "opacity .2s" }}>
      <BaseEdge
        id={id}
        path={path}
        markerEnd={`url(#arrow-${role})`}
        style={{
          stroke: color,
          strokeWidth: 1.25 + Math.min(Math.log2(1 + e.rate * 4), 3) * 0.6,
          strokeDasharray: e.synthetic || e.change === "gone" || verdict === "default-allow" ? "4 5" : undefined,
          opacity: 0.8,
        }}
      />
      {focus && <Particles path={path} color={color} count={budgeted} dur={dur} />}
      {label && focus && labels !== false && (
        <EdgeLabelRenderer>
          <div className={styles.label} style={{ transform: `translate(-50%,-50%) translate(${lx}px,${ly}px)` }}>
            <i style={{ background: color }} />
            {label}
          </div>
        </EdgeLabelRenderer>
      )}
    </g>
  );
}

/** Small fixed-size arrowheads, one per color role, independent of stroke width. */
export const Arrows = () => (
  <svg style={{ position: "absolute", width: 0, height: 0 }} aria-hidden="true">
    <defs>
      {ROLES.map((c) => (
        <marker
          key={c}
          id={`arrow-${c}`}
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="7"
          markerHeight="7"
          markerUnits="userSpaceOnUse"
          orient="auto-start-reverse"
        >
          <path d="M0,1 L9,5 L0,9 z" style={{ fill: `var(--${c})` }} />
        </marker>
      ))}
    </defs>
  </svg>
);

export const edgeTypes = { traffic: TrafficEdge };
