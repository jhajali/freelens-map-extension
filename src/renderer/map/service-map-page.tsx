import "@xyflow/react/dist/style.css";
import { Renderer } from "@freelensapp/extensions";
import { Background, Controls, type Edge, type Node, type NodeMouseHandler, ReactFlow } from "@xyflow/react";
import { observer } from "mobx-react";
import { useEffect, useMemo, useState } from "react";
import { SYSTEM_NAMESPACES } from "../../common/graph/inventory";
import { DEFAULT_THRESHOLDS, NO_FILTERS, type Snapshot } from "../../common/graph/types";
import { pipeline } from "../../common/graph/view";
import { FeasibilityPanel } from "../diagnostics/feasibility-panel";
import { type MapPageParams, PAGE_ID } from "../menus/show-on-map";
import { Arrows, edgeTypes, RoutesContext } from "./edges";
import { clusterList, loadK8sSnapshot } from "./k8s-source";
import { layoutGraph, nodesFor, type Point } from "./layout";
import { MapContext, nodeTypes } from "./nodes";
import styles from "./service-map.module.scss";

type Loaded = Snapshot & { unreadable?: string[] };

interface Navigator {
  navigate: (pageId?: string, params?: Record<string, unknown>) => void;
}

const loadActiveCluster = () => {
  const cluster = Renderer.Catalog.getActiveCluster();
  if (!cluster) return Promise.reject(new Error("no active cluster"));
  return loadK8sSnapshot(cluster.name, clusterList(cluster.id));
};

/** The service map of the active cluster: cluster view (namespaces) or one namespace, as the page params say. */
export function ServiceMapPage({
  extension,
  params,
  load = loadActiveCluster,
}: {
  extension: Navigator;
  params: MapPageParams;
  load?: () => Promise<Loaded>;
}) {
  const view = params.namespace || null;
  const [s, setS] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [graph, setGraph] = useState<{ nodes: Node[]; edges: Edge[]; routes: Record<string, Point[]> } | null>(null);

  useEffect(() => {
    let live = true;
    load().then(
      (x) => live && setS(x),
      (err) => live && setError(String(err)),
    );
    return () => {
      live = false;
    };
  }, [load]);

  useEffect(() => {
    if (!s) return;
    let live = true;
    setGraph(null);
    const { edges, keep } = pipeline(
      s,
      view,
      s.edges.map((e) => e.flowsPerSec),
      NO_FILTERS,
      1,
      DEFAULT_THRESHOLDS,
    );
    layoutGraph(view, nodesFor(s, view, edges, NO_FILTERS, keep), edges, { space: 1, dir: "RIGHT" }).then(
      ({ nodes, routes }) => {
        if (!live) return;
        setGraph({
          nodes: nodes.map((n) => ({ ...n, data: { ...n.data }, selected: n.id === params.select })),
          edges: edges.map((e) => ({
            id: e.id,
            source: e.source,
            target: e.target,
            type: "traffic",
            data: e as never,
          })),
          routes,
        });
      },
      (err) => live && setError(String(err)),
    );
    return () => {
      live = false;
    };
  }, [s, view, params.select]);

  const ctx = useMemo(
    () => s && { s, byId: new Map(s.workloads.map((w) => [w.id, w])), restarts: DEFAULT_THRESHOLDS.restarts },
    [s],
  );
  const open: NodeMouseHandler = (_, n) => {
    if (n.id.startsWith("ns:")) extension.navigate(PAGE_ID, { namespace: n.id.slice(3) });
    else if (n.id === `cluster:${s?.cluster}`) extension.navigate(PAGE_ID, {});
  };

  const unreadable = s?.unreadable ?? [];
  const empty = !graph?.nodes.length
    ? view && SYSTEM_NAMESPACES.has(view)
      ? `${view} is a system namespace; the map leaves system namespaces out.`
      : unreadable.length
        ? `Nothing to draw: ${unreadable.length} lists not readable (RBAC): ${unreadable.join(", ")}.`
        : `No Deployments, StatefulSets or DaemonSets${view ? ` in ${view}` : ""}.`
    : null;

  return (
    <div className={styles.page}>
      <div className={styles.top}>
        <span className={styles.crumb}>
          {view ? (
            <a onClick={() => extension.navigate(PAGE_ID, {})}>{s?.cluster ?? "cluster"}</a>
          ) : (
            <b>{s?.cluster ?? "cluster"}</b>
          )}
          {view && (
            <>
              {" "}
              › <b>{view}</b>
            </>
          )}
        </span>
        <span className={styles.spacer} />
        <span className={styles.note}>
          {error ??
            (s
              ? `Data: Kubernetes only${unreadable.length ? ` · ${unreadable.length} lists not readable` : ""}`
              : "Loading…")}
        </span>
      </div>
      <div className={styles.canvas}>
        {graph && empty && <p className={styles.empty}>{empty}</p>}
        {ctx && graph && !empty && (
          <MapContext.Provider value={ctx}>
            <RoutesContext.Provider value={graph.routes}>
              <Arrows />
              {/* mounted per layout so that it fits the new graph; dragging is off until links re-route live (M3) */}
              <ReactFlow
                defaultNodes={graph.nodes}
                defaultEdges={graph.edges}
                nodeTypes={nodeTypes}
                edgeTypes={edgeTypes}
                nodesDraggable={false}
                nodesConnectable={false}
                onNodeDoubleClick={open}
                zoomOnDoubleClick={false}
                fitView
                minZoom={0.1}
                proOptions={{ hideAttribution: true }}
              >
                <Background />
                <Controls showInteractive={false} />
              </ReactFlow>
            </RoutesContext.Provider>
          </MapContext.Provider>
        )}
      </div>
      <details>
        <summary className={styles.note}>Diagnostics (M1 spikes)</summary>
        <FeasibilityPanel />
      </details>
    </div>
  );
}

export type PageParams = Record<string, { get(): string } | undefined>;

// An observer: the host keeps the page mounted across navigation and only changes the observable params.
export const MapPage = observer(
  ({ extension, params, load }: { extension: Navigator; params: PageParams; load?: () => Promise<Loaded> }) => (
    <ServiceMapPage
      extension={extension}
      params={{ namespace: params.namespace?.get() || undefined, select: params.select?.get() || undefined }}
      load={load}
    />
  ),
);
