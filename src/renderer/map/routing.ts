// Link routing with libavoid: orthogonal routes around the boxes where the user left them.
import { AvoidLib } from "libavoid-js";

import type { Node } from "@xyflow/react";

import type { Point } from "./layout";

export type Avoid = ReturnType<typeof AvoidLib.getInstance>;
export type Box = { id: string; x: number; y: number; w: number; h: number; obstacle: boolean };
export type Positions = Record<string, Point>;

let loading: Promise<Avoid | null> | null = null;
// every embind object has delete(); the typings declare it on a few classes only
const free = (...xs: object[]) => {
  for (const x of xs) (x as { delete(): void }).delete();
};

/** Loads libavoid from the extension bundle once; resolves null (never throws) when WebAssembly is unavailable. */
export function loadAvoid(
  url = new URL(/* @vite-ignore */ "libavoid.wasm", import.meta.url).href,
): Promise<Avoid | null> {
  loading ??= AvoidLib.load(url)
    .then(() => AvoidLib.getInstance())
    .catch((error: unknown) => {
      console.warn("[service-map] libavoid unavailable, falling back to ELK routes", error);
      return null;
    });
  return loading;
}

/** Orthogonal routes around the obstacles, from a pin on whichever side of each end the router picks. */
export function avoidRoutes(
  A: Avoid,
  boxes: Box[],
  edges: Array<{ id: string; source: string; target: string }>,
): Record<string, Point[]> {
  const router = new A.Router(A.RouterFlag.OrthogonalRouting.value);
  try {
    router.setRoutingParameter(A.RoutingParameter.shapeBufferDistance, 12);
    router.setRoutingParameter(A.RoutingParameter.idealNudgingDistance, 10);
    router.setRoutingParameter(A.RoutingParameter.segmentPenalty, 20);
    router.setRoutingParameter(A.RoutingParameter.crossingPenalty, 200);
    router.setRoutingOption(A.RoutingOption.nudgeOrthogonalSegmentsConnectedToShapes, true);
    router.setRoutingOption(A.RoutingOption.nudgeSharedPathsWithCommonEndPoint, true);
    router.setRoutingOption(A.RoutingOption.penaliseOrthogonalSharedPathsAtConnEnds, true);
    const shapes = new Map<string, InstanceType<Avoid["ShapeRef"]>>();
    for (const b of boxes) {
      // a release box is drawn behind its cards and links cross it freely
      if (!b.obstacle) continue;
      // the router owns its shapes, pins and connectors; the points, rectangles and ends it copies are ours to free
      const p = new A.Point(b.x, b.y),
        q = new A.Point(b.x + b.w, b.y + b.h),
        rect = new A.Rectangle(p, q);
      const shape = new A.ShapeRef(router, rect);
      free(rect, q, p);
      // top, bottom, left, right (ConnDirUp 1, Down 2, Left 4, Right 8); shared, as busy cards have many links
      for (const [px, py, dir] of [
        [0.5, 0, 1],
        [0.5, 1, 2],
        [0, 0.5, 4],
        [1, 0.5, 8],
      ] as const)
        new A.ShapeConnectionPin(shape, 1, px, py, true, 0, dir).setExclusive(false);
      shapes.set(b.id, shape);
    }
    const conns: Array<[string, InstanceType<Avoid["ConnRef"]>]> = [];
    for (const e of edges) {
      const a = shapes.get(e.source),
        b = shapes.get(e.target);
      if (!a || !b) continue;
      const from = new A.ConnEnd(a, 1),
        to = new A.ConnEnd(b, 1);
      conns.push([e.id, new A.ConnRef(router, from, to)]);
      free(from, to);
    }
    router.processTransaction();
    const out: Record<string, Point[]> = {};
    for (const [id, c] of conns) {
      const r = c.displayRoute(),
        pts: Point[] = [];
      for (let i = 0; i < r.size(); i++) {
        const q = r.at(i);
        pts.push({ x: q.x, y: q.y });
        free(q);
      }
      free(r);
      out[id] = pts;
    }
    return out;
  } finally {
    router.delete();
  }
}

// the sizes nodesFor gives each kind, for nodes React Flow has not measured yet
const WIDTH: Record<string, number> = { card: 230, ns: 210, ext: 180 };

/** Each node's box in absolute coordinates; cards sit in their release box. */
export function boxesOf(nodes: Node[]): Box[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  return nodes
    .filter((n) => !n.hidden)
    .map((n) => {
      const parent = n.parentId ? byId.get(n.parentId) : undefined;
      const style = n.style as { width?: number; height?: number } | undefined;
      return {
        id: n.id,
        x: n.position.x + (parent?.position.x ?? 0),
        y: n.position.y + (parent?.position.y ?? 0),
        w: n.measured?.width ?? style?.width ?? WIDTH[n.type ?? ""] ?? 0,
        h: n.measured?.height ?? style?.height ?? (n.data as { h?: number }).h ?? 0,
        obstacle: n.type !== "grp",
      };
    });
}

/** ELK's nodes with the remembered positions of the ones still drawn; positions of nodes gone are ignored. */
export function withPositions<N extends Node>(
  nodes: N[],
  stored: Positions | undefined,
): { nodes: N[]; moved: boolean } {
  let moved = false;
  const out = nodes.map((n) => {
    const p = !n.parentId && stored?.[n.id];
    if (!p) return n;
    moved = true;
    return { ...n, position: { x: p.x, y: p.y } };
  });
  return { nodes: out, moved };
}
