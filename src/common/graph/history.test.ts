import { describe, expect, it } from "vitest";
import { RateHistory } from "./history";

import type { MapEdge } from "./types";

const link = (source: string, target: string, rate: number) =>
  ({ id: `${source}>${target}`, source, target, rate }) as MapEdge;

describe("RateHistory", () => {
  it("keeps 60 points per edge and sums nodes", () => {
    const h = new RateHistory();
    for (let t = 0; t < 70; t++) h.push([link("a", "b", t), link("b", "c", 1)], t);
    expect(h.edge("a>b")).toHaveLength(60);
    expect(h.edge("a>b")[0]).toBe(10);
    expect(h.edge("a>b").at(-1)).toBe(69);
    // b: 69 in from a, 1 out to c
    expect(h.node("b").at(-1)).toBe(70);
    expect(h.node("b")).toHaveLength(60);
    expect(h.node("a").at(-1)).toBe(69);
    expect(h.edge("x>y")).toEqual([]);
    // the same tick again adds nothing
    h.push([link("a", "b", 5)], 69);
    expect(h.edge("a>b").at(-1)).toBe(69);
  });

  it("drops the series of a link or node absent from a push", () => {
    const h = new RateHistory();
    h.push([link("a", "b", 1), link("b", "c", 2)], 1);
    h.push([link("a", "b", 3)], 2);
    expect(h.edge("b>c")).toEqual([]);
    expect(h.node("c")).toEqual([]);
    expect(h.edge("a>b")).toEqual([1, 3]);
    // a link that comes back starts over, not stitched to its old points
    h.push([link("a", "b", 3), link("b", "c", 7)], 3);
    expect(h.edge("b>c")).toEqual([7]);
  });
});
