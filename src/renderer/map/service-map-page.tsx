import "@xyflow/react/dist/style.css";
import { Renderer } from "@freelensapp/extensions";
import {
  applyNodeChanges,
  Background,
  Controls,
  type Edge,
  type EdgeMouseHandler,
  type Node,
  type NodeMouseHandler,
  ReactFlow,
  type ReactFlowInstance,
  ViewportPortal,
} from "@xyflow/react";
import { observer } from "mobx-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { aliases, realNames } from "../../common/graph/anonymize";
import { RateHistory } from "../../common/graph/history";
import { SYSTEM_NAMESPACES } from "../../common/graph/inventory";
import { protectedNamespaces } from "../../common/graph/layers";
import { matchNodes } from "../../common/graph/search";
import { pipeline } from "../../common/graph/view";
import { ServiceMapStore, toFilters } from "../../common/store/map-store";
import { MapIpcRenderer } from "../ipc";
import { type MapPageParams, PAGE_ID } from "../menus/show-on-map";
import { clusterNodes } from "./clusters";
import { DataMenu } from "./data-menu";
import { Arrows, edgeTypes, isFocused, RoutesContext } from "./edges";
import { download, exportMap, exportName } from "./export";
import { FiltersMenu } from "./filters-menu";
import { clusterList } from "./k8s-source";
import { layoutGraph, nodesFor, type Point } from "./layout";
import { LayoutMenu } from "./layout-menu";
import { LiveMap, type LiveState } from "./live-map";
import { AliasContext, MapContext, nameOf, nodeTypes } from "./nodes";
import { LinkDetails } from "./panel/link";
import { NamespaceDetails, OutsideDetails } from "./panel/namespace";
import { Panel, type Selection } from "./panel/panel";
import { WorkloadDetails } from "./panel/workload";
import { allot, prefersReducedMotion } from "./particles";
import { type Avoid, avoidRoutes, boxesOf, loadAvoid, withPositions } from "./routing";
import styles from "./service-map.module.scss";
import { SettingsDialog } from "./settings-dialog";
import { themeColors } from "./theme";
import { MenuStub, Toolbar } from "./toolbar";
import { useViewState } from "./view-state";

interface Navigator {
  navigate: (pageId?: string, params?: Record<string, unknown>) => void;
}
export type CreateLive = () => Pick<LiveMap, "start" | "stop">;

const liveActiveCluster: CreateLive = () => {
  const cluster = Renderer.Catalog.getActiveCluster();
  if (!cluster) throw new Error("no active cluster");
  const api = Renderer.K8sApi.KubeJsonApi.forCluster(cluster.id);
  const ipc = MapIpcRenderer.getInstance();
  return new LiveMap(
    cluster.id,
    cluster.name,
    {
      list: clusterList(cluster.id),
      query: (path, q) => api.get(path, { query: { query: q } }),
      invoke: (ch, ...a) => ipc.invoke(ch, ...a),
      listen: (ch, fn) => ipc.listen(ch, (_e, ...a) => fn(...a)),
      // the page's timers, called unbound: a bare reference would throw "Illegal invocation"
      setInterval: globalThis.setInterval.bind(globalThis),
      clearInterval: globalThis.clearInterval.bind(globalThis),
    },
    () => ServiceMapStore.getInstance<ServiceMapStore>().record(cluster.id).settings,
  );
};

const ids = (xs: Array<{ id: string }>) => xs.map((x) => x.id).sort();
// above this, links re-route once on drag end instead of every frame of the drag
const LIVE_ROUTING = { nodes: 150, links: 400 };

/** The service map of the active cluster: cluster view (namespaces) or one namespace, as the page params say. */
export const ServiceMapPage = observer(function ServiceMapPage({
  extension,
  params,
  createLive = liveActiveCluster,
  clusterId = Renderer.Catalog.getActiveCluster()?.id ?? "",
  store,
  onFlow,
}: {
  extension: Navigator;
  params: MapPageParams;
  createLive?: CreateLive;
  clusterId?: string;
  store?: ServiceMapStore;
  /** the React Flow instance, once it is up (tests spy on its fitView) */
  onFlow?: (rf: ReactFlowInstance) => void;
}) {
  const { record, set, reset, resetPositions, savePositions } = useViewState(clusterId, store);
  const view = params.namespace || null;
  const [search, setSearch] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const flow = useRef<ReactFlowInstance | null>(null);
  const [live, setLive] = useState<LiveState | null>(null);
  const [error, setError] = useState<string | null>(null);
  // moved: some node is not where ELK put it, so ELK's routes no longer fit
  const [graph, setGraph] = useState<{
    frame: string;
    nodes: Node[];
    routes: Record<string, Point[]>;
    moved: boolean;
  } | null>(null);
  const [avoid, setAvoid] = useState<Avoid | null>(null);
  const [avoided, setAvoided] = useState<Record<string, Point[]> | null>(null);
  const [dragging, setDragging] = useState(false);
  // bumped by "Reset positions", which needs a new layout though nothing else changed
  const [relayout, setRelayout] = useState(0);
  // a new frame is a new React Flow, fitted to its first layout; a new layout of the same frame keeps the viewport
  const frame = JSON.stringify([view, params.select ?? null]);
  // a selection belongs to the frame it was made in
  const [picked, setPicked] = useState<{ frame: string; sel: Selection } | null>(null);
  const selection = picked?.frame === frame ? picked.sel : null;
  const select = (sel: Selection) => setPicked({ frame, sel });
  const history = useRef(new RateHistory());
  // where the user left the boxes of this view
  const posKey = `${view ?? ""}|${record.hops}`;
  const stored = useRef(record.positions[posKey]);
  stored.current = record.positions[posKey];

  useEffect(() => {
    let on = true;
    loadAvoid().then((a) => on && setAvoid(a));
    return () => {
      on = false;
    };
  }, []);

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
  const anonymize = record.settings.anonymize;
  const a = useMemo(() => (s && anonymize ? aliases(s) : realNames), [s, anonymize]);
  const canvas = useRef<HTMLDivElement>(null);
  const baseline = live?.baseline ?? undefined;
  const allClusters =
    view === "@clusters"
      ? Renderer.Catalog.getAllClusters().map(({ id, name, status }) => ({ id, name, status }))
      : null;
  const clustersKey = JSON.stringify(allClusters);
  const scene = useMemo(() => {
    if (!s) return null;
    // a stored Changes with nothing to compare with yet narrows nothing
    const filters = toFilters({ ...record.filters, changes: record.filters.changes && !!baseline });
    const { edges, keep } = pipeline(
      s,
      view,
      s.edges.map((e) => e.flowsPerSec),
      filters,
      record.hops,
      record.settings.thresholds,
      baseline,
      record.settings.namedNetworks,
    );
    const nodes = allClusters
      ? clusterNodes(allClusters, s.cluster, edges)
      : nodesFor(s, view, edges, filters, keep, record.layout.explode);
    const rates = new Map<string, number>();
    for (const e of edges) for (const id of [e.source, e.target]) rates.set(id, (rates.get(id) ?? 0) + e.rate);
    // the layout depends on which nodes and links there are, not on their rates
    const key = JSON.stringify([
      view,
      params.select,
      ids(nodes),
      nodes.map((n) => n.group),
      ids(edges),
      record.layout.space,
      record.layout.dir,
      relayout,
    ]);
    return { edges, nodes, rates, key };
  }, [s, baseline, view, params.select, record, relayout, clustersKey]);

  // one point per tick, of the view's links: pushed while rendering the tick, so the panel is not a tick behind
  const pushed = useRef<LiveState | null>(null);
  if (scene && live && pushed.current !== live) {
    pushed.current = live;
    history.current.push(scene.edges, Date.now());
  }

  // the latest view for the layout effect, which runs only when the key changes
  const latest = useRef(scene);
  latest.current = scene;
  const layoutPrefs = useRef(record.layout);
  layoutPrefs.current = record.layout;
  const key = scene?.key;
  useEffect(() => {
    const v = latest.current;
    if (!key || !v) return;
    let on = true;
    layoutGraph(view, v.nodes, v.edges, { space: layoutPrefs.current.space, dir: layoutPrefs.current.dir }).then(
      ({ nodes, routes }) => {
        if (!on) return;
        setError(null);
        const placed = withPositions(
          nodes.map((n) => ({ ...n, data: { ...n.data }, selected: n.id === params.select })),
          stored.current,
        );
        setGraph({ frame, nodes: placed.nodes, routes, moved: placed.moved });
        // routes of the previous layout, maybe of another view, never go on this one
        setAvoided(null);
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
  const [reduced] = useState(prefersReducedMotion);
  const edges = useMemo<Edge[]>(() => {
    const at = new Set(drawn?.nodes.map((n) => n.id));
    const shown = scene?.edges.filter((e) => at.has(e.source) && at.has(e.target)) ?? [];
    const budget = allot(shown, reduced);
    const sel = selection?.id;
    return shown.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      type: "traffic",
      data: { ...e, n: budget.get(e.id) ?? 0, focus: isFocused(e, sel) } as never,
      selected: e.id === sel,
    }));
  }, [reduced, scene, drawn?.nodes, selection?.id]);
  // libavoid re-routes around the boxes where they are: every frame of a drag on small views, else when it ends
  const perFrame = !!drawn && drawn.nodes.length <= LIVE_ROUTING.nodes && edges.length <= LIVE_ROUTING.links;
  // the links change every tick, their ends only with the layout
  const links = useRef(edges);
  links.current = edges;
  const linkKey = ids(edges).join(" ");
  // and the nodes on every selection change; only where they are and how big matters
  const boxes = useMemo(() => (drawn ? boxesOf(drawn.nodes) : null), [drawn?.nodes]);
  const geometry = JSON.stringify(boxes);
  const latestBoxes = useRef(boxes);
  latestBoxes.current = boxes;
  useEffect(() => {
    const b = latestBoxes.current;
    if (!avoid || !b || (dragging && !perFrame)) return;
    const raf = requestAnimationFrame(() => setAvoided(avoidRoutes(avoid, b, links.current)));
    return () => cancelAnimationFrame(raf);
  }, [avoid, geometry, linkKey, dragging, perFrame]);
  // without libavoid: ELK's routes until a node moves, then React Flow's smooth steps
  const routes = avoid && avoided ? avoided : drawn?.moved ? {} : (drawn?.routes ?? {});
  const onMap = useMemo(
    () => new Set([...(drawn?.nodes.map((n) => n.id) ?? []), ...edges.map((e) => e.id)]),
    [drawn?.nodes, edges],
  );

  const prometheus = !!live?.sources.find((x) => x.id === "prometheus")?.ok;
  const sampled = live?.sampled;
  const ctx = useMemo(
    () =>
      s &&
      scene &&
      sampled && {
        s,
        byId: new Map(s.workloads.map((w) => [w.id, w])),
        thresholds: record.settings.thresholds,
        layer: record.layer,
        protectedNs: protectedNamespaces(s.policies),
        rates: scene.rates,
        prometheus,
        labels: record.layout.labels,
        sampled,
        clusters: allClusters ?? undefined,
      },
    [s, scene, prometheus, sampled, record.settings.thresholds, record.layer, record.layout.labels, clustersKey],
  );
  // release boxes are not searchable; everything else is drawn dimmed or outlined, never hidden
  const hits = useMemo(
    () =>
      s && drawn
        ? matchNodes(
            search,
            drawn.nodes.filter((n) => n.type !== "grp").map((n) => n.id),
            (id) => nameOf(id, s, ctx?.byId ?? new Map(), a),
          )
        : new Set<string>(),
    [search, s, drawn?.nodes, ctx?.byId, a],
  );
  // the panel's selection is the one React Flow highlights, also when it came from the select param
  const shown = useMemo<Node[] | undefined>(
    () =>
      drawn?.nodes.map((n) =>
        n.type === "grp" || !search.trim()
          ? { ...n, selected: n.id === selection?.id }
          : {
              ...n,
              selected: n.id === selection?.id,
              style: hits.has(n.id)
                ? { ...n.style, outline: "2px solid var(--accent, #3d90ce)", outlineOffset: 2 }
                : { ...n.style, opacity: 0.28 },
            },
      ),
    [search, hits, drawn?.nodes, selection?.id],
  );
  const kindOf = (id: string): NonNullable<Selection>["kind"] =>
    ctx?.byId.has(id)
      ? "workload"
      : id.startsWith("ns:")
        ? "namespace"
        : id.startsWith("cluster:")
          ? "cluster"
          : "outside";
  const pick: NodeMouseHandler = (_, n) => n.type !== "grp" && select({ kind: kindOf(n.id), id: n.id });
  const pickEdge: EdgeMouseHandler = (_, e) => select({ kind: "link", id: e.id });
  // "Show on map": the selected node, zoomed to, when this frame draws it
  const focus = params.select && drawn?.nodes.some((n) => n.id === params.select) ? params.select : null;
  const open: NodeMouseHandler = (_, n) => {
    if (n.id.startsWith("ns:")) extension.navigate(PAGE_ID, { namespace: n.id.slice(3) });
    else if (n.id === `cluster:${s?.cluster}`) extension.navigate(PAGE_ID, {});
  };

  const kube = live?.sources.find((x) => x.id === "kubernetes");
  const empty = !drawn?.nodes.length
    ? view === "@clusters"
      ? kube && !kube.ok
        ? `Nothing to draw: ${kube.detail}${kube.fix ? ` (${kube.fix})` : ""}.`
        : "No clusters in the catalog."
      : view && SYSTEM_NAMESPACES.has(view)
        ? `${view} is a system namespace; the map leaves system namespaces out.`
        : kube && !kube.ok
          ? `Nothing to draw: ${kube.detail}${kube.fix ? ` (${kube.fix})` : ""}.`
          : `No Deployments, StatefulSets or DaemonSets${view ? ` in ${a("ns", view)}` : ""}.`
    : null;

  const onExport = (kind: "png" | "svg") => {
    const el = canvas.current?.querySelector<HTMLElement>(".react-flow__viewport");
    if (!el || !s || !flow.current) return;
    exportMap(el, kind, themeColors(), flow.current.getNodes()).then(
      (blob) => download(blob, exportName(a("cluster", s.cluster), new Date(), kind)),
      (err) =>
        Renderer.Component.Notifications.error(`Export failed: ${err instanceof Error ? err.message : String(err)}`),
    );
  };

  return (
    <AliasContext.Provider value={a}>
      <div className={styles.page} data-palette={record.settings.palette === "cb" ? "cb" : undefined}>
        <Toolbar
          crumbs={
            view === "@clusters"
              ? [{ label: "All clusters" }]
              : [
                  { label: "All clusters", onClick: () => extension.navigate(PAGE_ID, { namespace: "@clusters" }) },
                  view
                    ? { label: s ? a("cluster", s.cluster) : "cluster", onClick: () => extension.navigate(PAGE_ID, {}) }
                    : { label: s ? a("cluster", s.cluster) : "cluster" },
                  ...(view ? [{ label: a("ns", view) }] : []),
                ]
          }
          layer={record.layer}
          onLayer={(layer) => set({ layer })}
          hops={view && view !== "@clusters" ? record.hops : undefined}
          onHops={(hops) => set({ hops })}
          quick={{
            problems: record.filters.problems,
            exposed: record.filters.exposed,
            egress: record.filters.direction === "outbound",
            dbs: record.filters.dbs,
            drops: record.filters.drops,
            changes: record.filters.changes,
          }}
          onQuick={(k) =>
            set({
              filters: {
                ...record.filters,
                ...(k === "egress"
                  ? { direction: record.filters.direction === "outbound" ? "all" : "outbound" }
                  : { [k]: !record.filters[k] }),
              },
            })
          }
          disabled={baseline || record.filters.changes ? undefined : { changes: "No baseline yet" }}
          onReset={reset}
          search={search}
          onSearch={setSearch}
          onSearchEnter={() => {
            if (hits.size)
              flow.current?.fitView({
                nodes: [...hits].map((id) => ({ id })),
                padding: 0.4,
                duration: 400,
                maxZoom: 1.3,
              });
          }}
          onSearchEscape={() => setSearch("")}
          menus={{
            layout: (
              <LayoutMenu
                prefs={record.layout}
                onChange={(layout) => set({ layout })}
                onResetPositions={() => {
                  resetPositions(posKey);
                  setRelayout((n) => n + 1);
                }}
                onExport={onExport}
                anonymize={anonymize}
                onAnonymize={() => set({ settings: { ...record.settings, anonymize: !record.settings.anonymize } })}
              />
            ),
            data: error ? (
              <span className={styles.note}>{error}</span>
            ) : live ? (
              <DataMenu state={live} />
            ) : (
              <span className={styles.note}>Loading…</span>
            ),
            filters: s ? (
              <FiltersMenu s={s} filters={record.filters} onChange={(f) => set({ filters: f })} />
            ) : (
              <MenuStub icon="sliders" label="Filters" />
            ),
          }}
          onSettings={() => setSettingsOpen(true)}
        />
        <SettingsDialog clusterId={clusterId} open={settingsOpen} onClose={() => setSettingsOpen(false)} />
        <div className={styles.main}>
          <div className={styles.canvas} ref={canvas}>
            {(drawn || (!s && kube && !kube.ok)) && empty && <p className={styles.empty}>{empty}</p>}
            {ctx && drawn && !empty && (
              <MapContext.Provider value={ctx}>
                <RoutesContext.Provider value={routes}>
                  {/* mounted per frame so that it fits the new view */}
                  <ReactFlow
                    key={drawn.frame}
                    nodes={shown}
                    onInit={(rf) => {
                      flow.current = rf;
                      onFlow?.(rf);
                      if (focus) {
                        rf.fitView({ nodes: [{ id: focus }], maxZoom: 1.3, padding: 0.4 });
                        select({ kind: kindOf(focus), id: focus });
                      }
                    }}
                    onNodesChange={(c) => setGraph((g) => g && { ...g, nodes: applyNodeChanges(c, g.nodes) })}
                    edges={edges}
                    nodeTypes={nodeTypes}
                    edgeTypes={edgeTypes}
                    onNodeDragStart={() => {
                      setDragging(true);
                      setGraph((g) => g && { ...g, moved: true });
                    }}
                    onNodeDragStop={(_, _n, moved) => {
                      setDragging(false);
                      savePositions(
                        posKey,
                        Object.fromEntries(moved.map((n) => [n.id, { x: n.position.x, y: n.position.y }])),
                      );
                    }}
                    nodesConnectable={false}
                    onNodeDoubleClick={open}
                    onNodeClick={pick}
                    onEdgeClick={pickEdge}
                    onPaneClick={() => select(null)}
                    zoomOnDoubleClick={false}
                    fitView={!focus}
                    minZoom={0.1}
                    proOptions={{ hideAttribution: true }}
                  >
                    {/* in the viewport, so that an export keeps the arrowheads */}
                    <ViewportPortal>
                      <Arrows />
                    </ViewportPortal>
                    <Background />
                    <Controls showInteractive={false} />
                  </ReactFlow>
                </RoutesContext.Provider>
              </MapContext.Provider>
            )}
          </div>
          {s && scene && (
            <Panel
              selection={selection}
              s={s}
              edges={scene.edges}
              drawn={onMap}
              history={history.current}
              level={live?.level ?? ""}
              renderDetails={(sel) => {
                const e = sel.kind === "link" ? scene.edges.find((x) => x.id === sel.id) : undefined;
                if (e)
                  return (
                    <LinkDetails
                      e={e}
                      s={s}
                      history={history.current}
                      protectedNs={protectedNamespaces(s.policies)}
                      l7={live?.l7 ?? false}
                      onSelect={(id) => select({ kind: kindOf(id), id })}
                    />
                  );
                if (sel.kind === "namespace")
                  return (
                    <NamespaceDetails
                      ns={sel.id.slice(3)}
                      s={s}
                      edges={scene.edges}
                      history={history.current}
                      protectedNs={protectedNamespaces(s.policies)}
                      prometheus={prometheus}
                      onSelect={(id) => select({ kind: "link", id })}
                      onOpen={() => extension.navigate(PAGE_ID, { namespace: sel.id.slice(3) })}
                    />
                  );
                if (sel.kind === "outside" || sel.kind === "cluster")
                  return (
                    <OutsideDetails
                      id={sel.id}
                      s={s}
                      edges={scene.edges}
                      onSelect={(id) => select({ kind: "link", id })}
                    />
                  );
                const w = sel.kind === "workload" ? s.workloads.find((x) => x.id === sel.id) : undefined;
                return w ? (
                  <WorkloadDetails
                    w={w}
                    s={s}
                    edges={scene.edges}
                    history={history.current}
                    thresholds={record.settings.thresholds}
                    prometheus={prometheus}
                    onSelect={(id) => select({ kind: "link", id })}
                  />
                ) : undefined;
              }}
              width={record.layout.panelWidth}
              onWidth={(panelWidth) => set({ layout: { ...record.layout, panelWidth } })}
            />
          )}
        </div>
      </div>
    </AliasContext.Provider>
  );
});

export type PageParams = Record<string, { get(): string } | undefined>;

// An observer: the host keeps the page mounted across navigation and only changes the observable params.
export const MapPage = observer(
  ({
    extension,
    params,
    createLive,
    clusterId,
    store,
  }: {
    extension: Navigator;
    params: PageParams;
    createLive?: CreateLive;
    clusterId?: string;
    store?: ServiceMapStore;
  }) => (
    <ServiceMapPage
      extension={extension}
      params={{ namespace: params.namespace?.get() || undefined, select: params.select?.get() || undefined }}
      createLive={createLive}
      clusterId={clusterId}
      store={store}
    />
  ),
);
