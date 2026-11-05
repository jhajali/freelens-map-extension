import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { loadFixture } from "../../../test/fixture";
import { flowsToEdges, toSnapshot } from "../../common/graph/flows";
import { buildInventory } from "../../common/graph/inventory";
import { DEFAULT_THRESHOLDS, NO_FILTERS } from "../../common/graph/types";
import { pipeline } from "../../common/graph/view";
import { layoutGraph, nodesFor, type Point } from "./layout";
import { type Avoid, avoidRoutes, type Box, boxesOf, loadAvoid, withPositions } from "./routing";

import type { Node } from "@xyflow/react";

let A: Avoid;
beforeAll(async () => {
  const loaded = await loadAvoid(resolve("node_modules/libavoid-js/dist/libavoid.wasm"));
  if (!loaded) throw new Error("libavoid did not load");
  A = loaded;
});

// does the segment p-q cross the inside of box b (touching its border is fine)?
const crosses = (p: Point, q: Point, b: Box) =>
  Math.max(p.x, q.x) > b.x &&
  Math.min(p.x, q.x) < b.x + b.w &&
  Math.max(p.y, q.y) > b.y &&
  Math.min(p.y, q.y) < b.y + b.h;
const hits = (pts: Point[], b: Box) => pts.slice(1).some((q, i) => crosses(pts[i]!, q, b));
const on = (p: Point, b: Box) => p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h;

describe("avoidRoutes", () => {
  const a = { id: "a", x: 0, y: 0, w: 100, h: 60, obstacle: true };
  const b = { id: "b", x: 400, y: 0, w: 100, h: 60, obstacle: true };
  const edges = [{ id: "e", source: "a", target: "b" }];

  it("routes around an obstacle", () => {
    const wall = { id: "w", x: 200, y: -100, w: 60, h: 300, obstacle: true };
    const pts = avoidRoutes(A, [a, b, wall], edges).e!;
    expect(pts.length).toBeGreaterThan(2);
    expect(on(pts[0]!, a) && on(pts.at(-1)!, b)).toBe(true);
    expect(hits(pts, wall)).toBe(false);
    // orthogonal: every segment is horizontal or vertical
    expect(pts.slice(1).every((q, i) => q.x === pts[i]!.x || q.y === pts[i]!.y)).toBe(true);
  });

  it("release boxes are not obstacles", () => {
    const release = { id: "grp:r", x: 200, y: -100, w: 60, h: 300, obstacle: false };
    const pts = avoidRoutes(A, [a, b, release], edges).e!;
    expect(pts).toHaveLength(2);
    expect(hits(pts, release)).toBe(true);
  });
});

describe("avoidRoutes memory", () => {
  // every embind value the caller creates or receives lives on the wasm heap until its delete()
  it("frees every temporary it creates", () => {
    const live = new Set<object>();
    const track = <T extends { delete(): void }>(o: T): T => {
      live.add(o);
      const del = o.delete.bind(o);
      Object.assign(o, { delete: () => (live.delete(o), del()) });
      return o;
    };
    const wrap = (C: new (...a: never[]) => object, after?: (o: never) => void) =>
      new Proxy(C, {
        construct: (T, args) => {
          const o = Reflect.construct(T, args) as never;
          after?.(o);
          return o;
        },
      });
    const own = (C: new (...a: never[]) => object) =>
      new Proxy(C, { construct: (T, args) => track(Reflect.construct(T, args) as { delete(): void }) });
    const spy = {
      ...A,
      Point: own(A.Point),
      Rectangle: own(A.Rectangle),
      ConnEnd: own(A.ConnEnd),
      ConnRef: wrap(A.ConnRef, (c: { displayRoute(): { at(i: number): { delete(): void } } & { delete(): void } }) => {
        const route = c.displayRoute.bind(c);
        c.displayRoute = () => {
          const r = track(route());
          const at = r.at.bind(r);
          r.at = (i: number) => track(at(i));
          return r;
        };
      }),
    } as unknown as Avoid;
    const boxes = [
      { id: "a", x: 0, y: 0, w: 100, h: 60, obstacle: true },
      { id: "b", x: 400, y: 0, w: 100, h: 60, obstacle: true },
      { id: "w", x: 200, y: -100, w: 60, h: 300, obstacle: true },
    ];
    for (let i = 0; i < 200; i++) {
      const pts = avoidRoutes(spy, boxes, [{ id: "e", source: "a", target: "b" }]).e!;
      expect(pts.length).toBeGreaterThan(2);
    }
    expect(live.size).toBe(0);
  });
});

describe("boxesOf", () => {
  it("places cards in absolute coordinates; release boxes are no obstacles", () => {
    const nodes = [
      { id: "grp:r", type: "grp", position: { x: 100, y: 50 }, style: { width: 300, height: 200 }, data: {} },
      { id: "w1", type: "card", parentId: "grp:r", position: { x: 16, y: 40 }, data: { h: 122 } },
      { id: "ext", type: "ext", position: { x: 0, y: 0 }, data: { h: 56 }, measured: { width: 190, height: 60 } },
    ] as Node[];
    expect(boxesOf(nodes)).toEqual([
      { id: "grp:r", x: 100, y: 50, w: 300, h: 200, obstacle: false },
      { id: "w1", x: 116, y: 90, w: 230, h: 122, obstacle: true },
      { id: "ext", x: 0, y: 0, w: 190, h: 60, obstacle: true },
    ]);
  });
});

describe("withPositions", () => {
  it("remembered positions apply only to nodes still present", async () => {
    const fx = loadFixture("capture-b");
    const inv = buildInventory(fx.objects, fx.metrics);
    const ctx = {
      self: fx.cluster.self,
      clusterCidrs: fx.cluster.clusterCidrs,
      namedNetworks: [],
      clusterIps: inv.clusterIps,
    };
    const s = toSnapshot(inv, flowsToEdges(fx.flows, inv, ctx), fx.cluster.self, fx.cluster.clusterCidrs);
    const view = [...s.namespaces].sort(
      (x, y) => s.workloads.filter((w) => w.ns === y).length - s.workloads.filter((w) => w.ns === x).length,
    )[0]!;
    const { edges, keep } = pipeline(
      s,
      view,
      s.edges.map((e) => e.flowsPerSec),
      NO_FILTERS,
      1,
      DEFAULT_THRESHOLDS,
    );
    const { nodes } = await layoutGraph(view, nodesFor(s, view, edges, NO_FILTERS, keep), edges, {
      space: 1,
      dir: "RIGHT",
    });
    const rf = nodes as Node[];
    const box = rf.find((n) => n.type === "grp")!;

    // a workload deleted since: its position is ignored, nothing else moves
    const gone = withPositions(rf, { [`${view}/deployment/deleted`]: { x: 5, y: 5 } });
    expect(gone.moved).toBe(false);
    expect(gone.nodes.map((n) => n.position)).toEqual(rf.map((n) => n.position));
    const leaves = boxesOf(gone.nodes).filter((b) => !b.id.startsWith("grp:"));
    for (const [i, p] of leaves.entries())
      for (const q of leaves.slice(i + 1))
        expect(p.x < q.x + q.w && q.x < p.x + p.w && p.y < q.y + q.h && q.y < p.y + p.h, `${p.id} / ${q.id}`).toBe(
          false,
        );

    // a box still there takes its remembered place; its cards move with it
    const kept = withPositions(rf, { [box.id]: { x: -999, y: 7 }, [`${view}/deployment/deleted`]: { x: 5, y: 5 } });
    expect(kept.moved).toBe(true);
    expect(kept.nodes.find((n) => n.id === box.id)!.position).toEqual({ x: -999, y: 7 });
    expect(kept.nodes.filter((n) => n.id !== box.id).map((n) => n.position)).toEqual(
      rf.filter((n) => n.id !== box.id).map((n) => n.position),
    );
  });
});
