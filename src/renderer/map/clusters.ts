import type { MapEdge } from "../../common/graph/types";
import type { LayoutNode } from "./layout";

export interface CatalogCluster {
  id: string;
  name: string;
  status: string;
}

/** One card per catalog cluster, then any other endpoint the links name (a cluster the catalog lacks). */
export function clusterNodes(all: CatalogCluster[], _self: string, edges: MapEdge[]): LayoutNode[] {
  const ids = new Set([...all.map((c) => `cluster:${c.name}`), ...edges.flatMap((e) => [e.source, e.target])]);
  return [...ids].map((id) => ({ id, type: "ext", w: 180, h: 56 }));
}
