import { describe, expect, it } from "vitest";
import { loadFixture } from "../../../test/fixture";
import { flowsToEdges, toSnapshot } from "../../common/graph/flows";
import { buildInventory } from "../../common/graph/inventory";
import { DEFAULT_THRESHOLDS, type MapEdge, NO_FILTERS, type View, type Workload } from "../../common/graph/types";
import { pipeline } from "../../common/graph/view";
import { cardHeight, layoutGraph, nodesFor, type RfNode } from "./layout";

const fx = loadFixture("capture-b");
const inv = buildInventory(fx.objects, fx.metrics);
const ctx = {
  self: fx.cluster.self,
  clusterCidrs: fx.cluster.clusterCidrs,
  namedNetworks: [],
  clusterIps: inv.clusterIps,
};
const s = toSnapshot(inv, flowsToEdges(fx.flows, inv, ctx), fx.cluster.self, fx.cluster.clusterCidrs);
const rates = s.edges.map((e) => e.flowsPerSec);
const biggest = [...s.namespaces]
  .sort((a, b) => s.workloads.filter((w) => w.ns === b).length - s.workloads.filter((w) => w.ns === a).length)
  .slice(0, 3);

type Box = { x: number; y: number; w: number; h: number };
const overlap = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

const cases: Array<[View, 0 | 1 | 2]> = [null, ...biggest].flatMap((v) =>
  [0, 1, 2].map((h) => [v, h] as [View, 0 | 1 | 2]),
);

describe("layoutGraph", () => {
  it.each(cases)("view %s hops %i: no overlaps, boxes shrink-wrapped", async (view, hops) => {
    const { edges, keep } = pipeline(s, view, rates, NO_FILTERS, hops, DEFAULT_THRESHOLDS);
    const raw = nodesFor(s, view, edges, NO_FILTERS, keep);
    const { nodes } = await layoutGraph(view, raw, edges, { space: 1, dir: "RIGHT" });
    expect(nodes.filter((n) => n.type !== "grp")).toHaveLength(raw.length);

    const byId = new Map(nodes.map((n) => [n.id, n]));
    const size = (n: RfNode) =>
      n.type === "grp"
        ? { w: n.style!.width, h: n.style!.height }
        : { w: raw.find((r) => r.id === n.id)!.w, h: n.data.h! };
    const absBox = (n: RfNode): Box => {
      const p = n.parentId ? byId.get(n.parentId)!.position : { x: 0, y: 0 };
      return { x: p.x + n.position.x, y: p.y + n.position.y, ...size(n) };
    };
    const leaves = nodes.filter((n) => n.type !== "grp");
    const boxes = nodes.filter((n) => n.type === "grp");
    for (let i = 0; i < leaves.length; i++)
      for (let j = i + 1; j < leaves.length; j++)
        expect(overlap(absBox(leaves[i]!), absBox(leaves[j]!)), `${leaves[i]!.id} / ${leaves[j]!.id}`).toBe(false);
    for (const l of leaves.filter((n) => !n.parentId))
      for (const b of boxes) expect(overlap(absBox(l), absBox(b)), `${l.id} / ${b.id}`).toBe(false);
    for (const b of boxes) {
      const kids = leaves.filter((n) => n.parentId === b.id);
      expect(kids.length).toBeGreaterThan(0);
      for (const k of kids) expect([k.extent, k.draggable]).toEqual(["parent", false]);
      expect(Math.min(...kids.map((k) => k.position.x))).toBe(16);
      expect(Math.min(...kids.map((k) => k.position.y))).toBe(40);
      expect(b.style!.height - Math.max(...kids.map((k) => k.position.y + size(k).h))).toBe(16);
      expect(b.style!.width - Math.max(...kids.map((k) => k.position.x + size(k).w))).toBe(16);
    }
  });

  // ELK rejects an edge between two LAST nodes; "world" is a source for public IPs that bypass a LoadBalancer
  it("lays out an edge from world to another egress node", async () => {
    const ext = (id: string) => ({ id, type: "ext" as const, w: 180, h: 56 });
    const edge = { id: "world->internal", source: "world", target: "internal" } as MapEdge;
    await expect(
      layoutGraph(null, [ext("world"), ext("internal")], [edge], { space: 1, dir: "RIGHT" }),
    ).resolves.toBeDefined();
  });

  it("gives a workload with a long short name the taller card", () => {
    const w = { ...s.workloads[0]!, release: null, name: "a".repeat(30) } as Workload;
    expect(cardHeight(w)).toBe(138);
    expect(cardHeight({ ...w, name: "short" })).toBe(122);
  });
});
