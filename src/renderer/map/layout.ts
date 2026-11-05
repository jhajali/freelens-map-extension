// ELK layout of a map view: release boxes shrink-wrapped to their cards, entry points first, exits last.
import ELK, { type ElkNode } from "elkjs/lib/elk.bundled.js";
import { shortName, workloadVisible } from "../../common/graph/view";

import type { Filters, MapEdge, Snapshot, View, Workload } from "../../common/graph/types";

export interface LayoutNode {
  id: string;
  type: "card" | "ns" | "ext";
  w: number;
  h: number;
  group?: string;
}
export interface Point {
  x: number;
  y: number;
}
/** React Flow node; release boxes are type "grp" and hold their cards as fixed children. */
export interface RfNode {
  id: string;
  type: LayoutNode["type"] | "grp";
  position: Point;
  parentId?: string;
  extent?: "parent";
  draggable?: boolean;
  zIndex?: number;
  style?: { width: number; height: number };
  data: { h?: number; name?: string; view?: View };
}

export const NO_RELEASE = "(no Helm release)";
// two-line names get the taller card
export const cardHeight = (w: Workload) => (shortName(w).length > 24 ? 138 : 122);

/** The nodes of `view`: namespace cards (cluster view) or workload cards (namespace view), plus every other endpoint of `edges`. */
export function nodesFor(
  s: Snapshot,
  view: View,
  edges: MapEdge[],
  f: Filters,
  keep: Set<string> | null,
  explode = false,
): LayoutNode[] {
  const ids = new Set(edges.flatMap((e) => [e.source, e.target]));
  const ok = s.workloads.filter((w) => workloadVisible(w, f));
  const out: LayoutNode[] = [];
  // a namespace with no workloads at all stays visible as a "0 workloads" card, unless filters narrow the map
  const emptyShown = (ns: string) => !f.labels.length && !f.hiddenNs.has(ns) && !s.workloads.some((w) => w.ns === ns);
  if (!view)
    for (const ns of s.namespaces.filter(
      (ns) => (ok.some((w) => w.ns === ns) || emptyShown(ns)) && (!keep || keep.has(`ns:${ns}`)),
    )) {
      out.push({ id: `ns:${ns}`, type: "ns", w: 210, h: 100 });
      ids.delete(`ns:${ns}`);
    }
  else if (view !== "@clusters")
    for (const w of ok.filter((w) => w.ns === view && (!keep || keep.has(w.id)))) {
      out.push({
        id: w.id,
        type: "card",
        w: 230,
        h: cardHeight(w),
        group: explode ? undefined : (w.release ?? NO_RELEASE),
      });
      ids.delete(w.id);
    }
  for (const id of ids) out.push({ id, type: "ext", w: 180, h: 56 });
  return out;
}

// Pin entry points to the first layer and exits to the last; internal services fill the middle.
// ELK rejects a FIRST node with an incoming edge and a LAST node with an outgoing one; "world" is also the
// source of flows from public IPs that bypass a LoadBalancer, so even the fixed sides follow the edges.
function side(id: string, edges: MapEdge[]): "FIRST" | "LAST" | null {
  const hasIn = edges.some((e) => e.target === id),
    hasOut = edges.some((e) => e.source === id);
  if (id === "internet" || id === "lan") return hasIn ? null : "FIRST";
  if (id === "world" || id === "internal" || id.startsWith("net:")) return hasOut ? null : "LAST";
  if (!/^(ns:|cluster:|infra)/.test(id) || !edges.length) return null;
  return hasOut && !hasIn ? "FIRST" : hasIn && !hasOut ? "LAST" : null;
}

const elk = new ELK();

export async function layoutGraph(
  view: View,
  raw: LayoutNode[],
  edges: MapEdge[],
  opts: { space: number; dir: "RIGHT" | "LEFT" },
) {
  const { space, dir } = opts;
  const leaf = (x: LayoutNode): ElkNode => {
    const c = view || x.type === "ext" ? side(x.id, edges) : null;
    return { id: x.id, width: x.w, height: x.h, layoutOptions: c ? { "elk.layered.layering.layerConstraint": c } : {} };
  };
  const groups = new Map<string, ElkNode[]>();
  const root: ElkNode[] = [];
  for (const x of raw) {
    if (!x.group) root.push(leaf(x));
    else groups.set(x.group, [...(groups.get(x.group) ?? []), leaf(x)]);
  }
  for (const [g, children] of groups)
    root.push({
      id: `grp:${g}`,
      children,
      layoutOptions: {
        "elk.padding": "[top=40,left=16,bottom=16,right=16]",
        "elk.spacing.nodeNode": String(28 * space),
        "elk.layered.spacing.nodeNodeBetweenLayers": String(110 * space),
      },
    });
  const res = await elk.layout({
    id: "root",
    children: root,
    edges: edges.map((e) => ({ id: e.id, sources: [e.source], targets: [e.target] })),
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": dir,
      "elk.hierarchyHandling": "INCLUDE_CHILDREN",
      "elk.spacing.nodeNode": String(28 * space),
      "elk.layered.spacing.nodeNodeBetweenLayers": String(110 * space),
      "elk.spacing.componentComponent": String(40 * space),
      "elk.spacing.edgeNode": String(20 * space),
      // fewer crossings: thorough layer sweep, connected nodes pulled into line, links routed around boxes
      "elk.layered.crossingMinimization.strategy": "LAYER_SWEEP",
      "elk.layered.thoroughness": "60",
      "elk.layered.crossingMinimization.greedySwitch.type": "TWO_SIDED",
      "elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX",
      "elk.edgeRouting": "ORTHOGONAL",
      "elk.spacing.edgeEdge": "10",
      "elk.layered.spacing.edgeEdgeBetweenLayers": "12",
      "elk.json.edgeCoords": "ROOT",
    },
  });
  // ELK's routes, in absolute coordinates, plus where each node sat when they were computed
  const routes: Record<string, Point[]> = {},
    abs: Record<string, Point> = {};
  const walk = (n: ElkNode, ox: number, oy: number) => {
    for (const e of n.edges ?? [])
      for (const sec of e.sections ?? []) routes[e.id] = [sec.startPoint, ...(sec.bendPoints ?? []), sec.endPoint];
    for (const c of n.children ?? []) {
      abs[c.id] = { x: ox + c.x!, y: oy + c.y! };
      walk(c, ox + c.x!, oy + c.y!);
    }
  };
  walk(res, 0, 0);
  const byId = new Map(raw.map((x) => [x.id, x]));
  const nodes: RfNode[] = [];
  for (const c of res.children ?? []) {
    const kids = c.children ?? [];
    if (!c.id.startsWith("grp:")) {
      nodes.push({
        id: c.id,
        type: byId.get(c.id)!.type,
        position: { x: c.x!, y: c.y! },
        data: { h: byId.get(c.id)!.h },
      });
      continue;
    }
    // ELK leaves room for links routed through the box; shrink-wrap it to its cards with even padding instead
    const PAD = 16,
      TOP = 40;
    const x0 = Math.min(...kids.map((k) => k.x!)),
      y0 = Math.min(...kids.map((k) => k.y!));
    const x1 = Math.max(...kids.map((k) => k.x! + k.width!)),
      y1 = Math.max(...kids.map((k) => k.y! + k.height!));
    nodes.push({
      id: c.id,
      type: "grp",
      position: { x: c.x! + x0 - PAD, y: c.y! + y0 - TOP },
      data: { name: c.id.slice(4), view },
      style: { width: x1 - x0 + 2 * PAD, height: y1 - y0 + TOP + PAD },
      zIndex: -1,
    });
    // cards are fixed inside their release box; drag the box to move them
    for (const k of kids)
      nodes.push({
        id: k.id,
        type: byId.get(k.id)!.type,
        parentId: c.id,
        extent: "parent",
        draggable: false,
        position: { x: k.x! - x0 + PAD, y: k.y! - y0 + TOP },
        data: { h: byId.get(k.id)!.h },
      });
  }
  return { nodes, routes, abs };
}
