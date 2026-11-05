import type { MapEdge } from "./types";

// 2.5 min at the 2.5 s tick
const MAX = 60;

/** Rate series per link and per node (in + out), one point per tick, for the details panel's sparklines. */
export class RateHistory {
  private readonly edges = new Map<string, number[]>();
  private readonly nodes = new Map<string, number[]>();
  private last = Number.NEGATIVE_INFINITY;

  push(edges: MapEdge[], t: number) {
    if (t <= this.last) return;
    this.last = t;
    const sums = new Map<string, number>();
    for (const e of edges) {
      add(this.edges, e.id, e.rate);
      for (const id of [e.source, e.target]) sums.set(id, (sums.get(id) ?? 0) + e.rate);
    }
    for (const [id, v] of sums) add(this.nodes, id, v);
    // a link or node out of the view loses its series: no growth over a session, no stale points when it returns
    const ids = new Set(edges.map((e) => e.id));
    for (const id of this.edges.keys()) if (!ids.has(id)) this.edges.delete(id);
    for (const id of this.nodes.keys()) if (!sums.has(id)) this.nodes.delete(id);
  }
  edge(id: string): number[] {
    return this.edges.get(id) ?? [];
  }
  node(id: string): number[] {
    return this.nodes.get(id) ?? [];
  }
}

function add(series: Map<string, number[]>, id: string, v: number) {
  const xs = series.get(id) ?? [];
  xs.push(v);
  if (xs.length > MAX) xs.shift();
  series.set(id, xs);
}
