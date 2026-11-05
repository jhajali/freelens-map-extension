import "@xyflow/react/dist/style.css";
import { Renderer } from "@freelensapp/extensions";
import {
  applyNodeChanges,
  Background,
  Controls,
  type Edge,
  type Node,
  type NodeMouseHandler,
  ReactFlow,
} from "@xyflow/react";
import { observer } from "mobx-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { SYSTEM_NAMESPACES } from "../../common/graph/inventory";
import { DEFAULT_THRESHOLDS, NO_FILTERS } from "../../common/graph/types";
import { pipeline } from "../../common/graph/view";
import { MapIpcRenderer } from "../ipc";
import { type MapPageParams, PAGE_ID } from "../menus/show-on-map";
import { DataMenu } from "./data-menu";
import { Arrows, edgeTypes, RoutesContext } from "./edges";
import { clusterList } from "./k8s-source";
import { layoutGraph, nodesFor, type Point } from "./layout";
import { LiveMap, type LiveState } from "./live-map";
import { MapContext, nodeTypes } from "./nodes";
import styles from "./service-map.module.scss";

interface Navigator {
  navigate: (pageId?: string, params?: Record<string, unknown>) => void;
}
export type CreateLive = () => Pick<LiveMap, "start" | "stop">;

const liveActiveCluster: CreateLive = () => {
  const cluster = Renderer.Catalog.getActiveCluster();
  if (!cluster) throw new Error("no active cluster");
  const api = Renderer.K8sApi.KubeJsonApi.forCluster(cluster.id);
  const ipc = MapIpcRenderer.getInstance();
  return new LiveMap(cluster.id, cluster.name, {
    list: clusterList(cluster.id),
    query: (path, q) => api.get(path, { query: { query: q } }),
    invoke: (ch, ...a) => ipc.invoke(ch, ...a),
    listen: (ch, fn) => ipc.listen(ch, (_e, ...a) => fn(...a)),
    // the page's timers, called unbound: a bare reference would throw "Illegal invocation"
    setInterval: globalThis.setInterval.bind(globalThis),
    clearInterval: globalThis.clearInterval.bind(globalThis),
  });
};

const ids = (xs: Array<{ id: string }>) => xs.map((x) => x.id).sort();

/** The service map of the active cluster: cluster view (namespaces) or one namespace, as the page params say. */
export function ServiceMapPage({
  extension,
  params,
  createLive = liveActiveCluster,
}: {
  extension: Navigator;
  params: MapPageParams;
  createLive?: CreateLive;
}) {
  const view = params.namespace || null;
  const [live, setLive] = useState<LiveState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [graph, setGraph] = useState<{ frame: string; nodes: Node[]; routes: Record<string, Point[]> } | null>(null);
  // a new frame is a new React Flow, fitted to its first layout; a new layout of the same frame keeps the viewport
  const frame = JSON.stringify([view, params.select ?? null]);

  // created here, not passed in: StrictMode runs this twice, and each run needs a source of its own to stop
  useEffect(() => {
    let source: ReturnType<CreateLive>;
    try {
      source = createLive();
    } catch (err) {
      setError(String(err));
      return;
    }
    source.start(setLive);
    return () => source.stop();
  }, [createLive]);

  const s = live?.snapshot ?? null;
  const scene = useMemo(() => {
    if (!s) return null;
    const { edges, keep } = pipeline(
      s,
      view,
      s.edges.map((e) => e.flowsPerSec),
      NO_FILTERS,
      1,
      DEFAULT_THRESHOLDS,
    );
    const nodes = nodesFor(s, view, edges, NO_FILTERS, keep);
    const rates = new Map<string, number>();
    for (const e of edges) for (const id of [e.source, e.target]) rates.set(id, (rates.get(id) ?? 0) + e.rate);
    // the layout depends on which nodes and links there are, not on their rates
    const key = JSON.stringify([view, params.select, ids(nodes), nodes.map((n) => n.group), ids(edges)]);
    return { edges, nodes, rates, key };
  }, [s, view, params.select]);

  // the latest view for the layout effect, which runs only when the key changes
  const latest = useRef(scene);
  latest.current = scene;
  const key = scene?.key;
  useEffect(() => {
    const v = latest.current;
    if (!key || !v) return;
    let on = true;
    layoutGraph(view, v.nodes, v.edges, { space: 1, dir: "RIGHT" }).then(
      ({ nodes, routes }) => {
        if (!on) return;
        setError(null);
        setGraph({
          frame,
          nodes: nodes.map((n) => ({ ...n, data: { ...n.data }, selected: n.id === params.select })),
          routes,
        });
      },
      (err) => on && setError(String(err)),
    );
    return () => {
      on = false;
    };
  }, [key]);

  // the previous layout of this frame stays drawn while the next one runs; cards of workloads gone draw nothing
  const drawn = graph && graph.frame === frame ? graph : null;
  // links follow every tick on the layout's routes, between the nodes drawn
  const edges = useMemo<Edge[]>(() => {
    const at = new Set(drawn?.nodes.map((n) => n.id));
    return (
      scene?.edges
        .filter((e) => at.has(e.source) && at.has(e.target))
        .map((e) => ({ id: e.id, source: e.source, target: e.target, type: "traffic", data: e as never })) ?? []
    );
  }, [scene, drawn?.nodes]);

  const prometheus = !!live?.sources.find((x) => x.id === "prometheus")?.ok;
  const sampled = live?.sampled;
  const ctx = useMemo(
    () =>
      s &&
      scene &&
      sampled && {
        s,
        byId: new Map(s.workloads.map((w) => [w.id, w])),
        restarts: DEFAULT_THRESHOLDS.restarts,
        rates: scene.rates,
        prometheus,
        sampled,
      },
    [s, scene, prometheus, sampled],
  );
  const open: NodeMouseHandler = (_, n) => {
    if (n.id.startsWith("ns:")) extension.navigate(PAGE_ID, { namespace: n.id.slice(3) });
    else if (n.id === `cluster:${s?.cluster}`) extension.navigate(PAGE_ID, {});
  };

  const kube = live?.sources.find((x) => x.id === "kubernetes");
  const empty = !drawn?.nodes.length
    ? view && SYSTEM_NAMESPACES.has(view)
      ? `${view} is a system namespace; the map leaves system namespaces out.`
      : kube && !kube.ok
        ? `Nothing to draw: ${kube.detail}${kube.fix ? ` (${kube.fix})` : ""}.`
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
        {error ? (
          <span className={styles.note}>{error}</span>
        ) : live ? (
          <DataMenu state={live} />
        ) : (
          <span className={styles.note}>Loading…</span>
        )}
      </div>
      <div className={styles.canvas}>
        {(drawn || (!s && kube && !kube.ok)) && empty && <p className={styles.empty}>{empty}</p>}
        {ctx && drawn && !empty && (
          <MapContext.Provider value={ctx}>
            <RoutesContext.Provider value={drawn.routes}>
              <Arrows />
              {/* mounted per frame so that it fits the new view; dragging is off until links re-route live (M3) */}
              <ReactFlow
                key={drawn.frame}
                nodes={drawn.nodes}
                onNodesChange={(c) => setGraph((g) => g && { ...g, nodes: applyNodeChanges(c, g.nodes) })}
                edges={edges}
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
    </div>
  );
}

export type PageParams = Record<string, { get(): string } | undefined>;

// An observer: the host keeps the page mounted across navigation and only changes the observable params.
export const MapPage = observer(
  ({ extension, params, createLive }: { extension: Navigator; params: PageParams; createLive?: CreateLive }) => (
    <ServiceMapPage
      extension={extension}
      params={{ namespace: params.namespace?.get() || undefined, select: params.select?.get() || undefined }}
      createLive={createLive}
    />
  ),
);
