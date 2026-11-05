import { describe, expect, it } from "vitest";
import { clusterNodes } from "./clusters";

import type { MapEdge } from "../../common/graph/types";

const all = [
  { id: "i1", name: "dev", status: "connected" },
  { id: "i2", name: "prod", status: "disconnected" },
];
const edge = (source: string, target: string) => ({ id: `${source}>${target}`, source, target }) as MapEdge;

describe("clusterNodes", () => {
  it("lists every catalog cluster and marks this one", () => {
    const n = clusterNodes(all, "dev", []);
    expect(n.map((x) => [x.id, x.type])).toEqual([
      ["cluster:dev", "ext"],
      ["cluster:prod", "ext"],
    ]);
  });
  it("draws cross-cluster links seen from here", () => {
    const n = clusterNodes(all, "dev", [edge("cluster:dev", "cluster:staging")]);
    expect(n.map((x) => x.id)).toEqual(["cluster:dev", "cluster:prod", "cluster:staging"]);
  });
});
