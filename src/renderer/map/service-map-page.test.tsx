// @vitest-environment jsdom
import { resolve } from "node:path";
import { Renderer } from "@freelensapp/extensions";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { toPng } from "html-to-image";
import { observable, runInAction } from "mobx";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { loadFixture } from "../../../test/fixture";
import { GENERIC, realStrings } from "../../../test/real-names";
import { flowsToEdges, toSnapshot } from "../../common/graph/flows";
import { buildInventory } from "../../common/graph/inventory";
import { shortName } from "../../common/graph/view";
import { ServiceMapStore } from "../../common/store/map-store";
import { scrub } from "./export";
import { layoutGraph } from "./layout";
import { avoidRoutes, loadAvoid } from "./routing";
import { MapPage, ServiceMapPage } from "./service-map-page";

import type { Node, ReactFlowInstance, ReactFlowProps } from "@xyflow/react";

import type { Snapshot } from "../../common/graph/types";
import type { LiveState } from "./live-map";

// the real layout, counted
vi.mock("./layout", async (importOriginal) => {
  const real = await importOriginal<typeof import("./layout")>();
  return { ...real, layoutGraph: vi.fn(real.layoutGraph) };
});

// jsdom has no wasm file to fetch; the page falls back to ELK's routes, as without WebAssembly
// one test hands the page the real libavoid, loaded from node_modules
vi.mock("./routing", async (importOriginal) => {
  const real = await importOriginal<typeof import("./routing")>();
  return { ...real, loadAvoid: vi.fn(() => Promise.resolve(null)), avoidRoutes: vi.fn(real.avoidRoutes) };
});
// React Flow's props, for the drag handlers jsdom cannot drive
const flowProps: { current: ReactFlowProps | null } = { current: null };
vi.mock("@xyflow/react", async (importOriginal) => {
  const real = await importOriginal<typeof import("@xyflow/react")>();
  return {
    ...real,
    ReactFlow: (p: ReactFlowProps) => {
      flowProps.current = p;
      return <real.ReactFlow {...p} />;
    },
  };
});

// the export's renderer, which needs a real browser
vi.mock("html-to-image", () => ({ toPng: vi.fn(async () => "data:image/png;base64,"), toSvg: vi.fn() }));

// the page reads the most recently constructed store, as the host's singleton
new ServiceMapStore();
const fx = loadFixture("capture-b");
const inv = buildInventory(fx.objects, fx.metrics);
const flows = flowsToEdges(fx.flows, inv, {
  self: fx.cluster.self,
  clusterCidrs: fx.cluster.clusterCidrs,
  namedNetworks: [],
  clusterIps: inv.clusterIps,
});
const s = toSnapshot(inv, flows, "dev", fx.cluster.clusterCidrs);
const state = (snapshot: Snapshot, over: Partial<LiveState> = {}): LiveState => ({
  snapshot,
  baseline: null,
  baselineLabel: "none yet",
  sources: [
    { id: "kubernetes", ok: true, detail: "objects listed", fix: null },
    { id: "prometheus", ok: true, detail: "observability/prometheus", fix: null },
    { id: "hubble", ok: false, detail: "connecting", fix: null },
  ],
  level: "Prometheus only",
  sampled: { cpu: new Set(snapshot.workloads.map((w) => w.id)), mem: new Set(snapshot.workloads.map((w) => w.id)) },
  truncated: 0,
  l7: false,
  ...over,
});

/** A fake live source: emits `first` on start; `emit` sends more. */
function fake(first: LiveState) {
  let onChange: (s: LiveState) => void = () => {};
  const stop = vi.fn();
  const createLive = () => ({
    start(fn: (s: LiveState) => void) {
      onChange = fn;
      fn(first);
    },
    stop,
  });
  return { createLive, stop, emit: (x: LiveState) => act(() => onChange(x)) };
}
const { createLive } = fake(state(s));
const extension = { navigate: vi.fn() };
const shop = s.namespaces.find((ns) => s.workloads.filter((w) => w.ns === ns).length === 12)!;

beforeAll(() => {
  // React Flow measures nodes; jsdom has no layout engine
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as never;
});

describe("ServiceMapPage", () => {
  // a test that builds its own store replaces the singleton the others read
  afterEach(() => {
    new ServiceMapStore();
  });

  it("cluster view: one card per namespace, labelled with the data level", async () => {
    const { container } = render(
      <ServiceMapPage clusterId="test" extension={extension} params={{}} createLive={createLive} />,
    );
    expect(await screen.findByText("Data: Prometheus only")).toBeTruthy();
    await vi.waitFor(() =>
      expect(container.querySelectorAll("[data-testid=ns-card]")).toHaveLength(
        new Set(s.workloads.map((w) => w.ns)).size,
      ),
    );
  });

  it("the toolbar crumbs navigate and Egress toggles the direction", async () => {
    const navigate = vi.fn();
    const store = new ServiceMapStore();
    render(
      <ServiceMapPage
        clusterId="test"
        extension={{ navigate }}
        params={{ namespace: shop }}
        createLive={createLive}
        store={store}
      />,
    );
    await screen.findByText("Data: Prometheus only");
    fireEvent.click(screen.getByText("All clusters"));
    expect(navigate).toHaveBeenLastCalledWith(expect.any(String), { namespace: "@clusters" });
    fireEvent.click(screen.getByRole("button", { name: "Egress" }));
    expect(store.record("test").filters.direction).toBe("outbound");
    fireEvent.click(screen.getByRole("button", { name: "All links" }));
    expect(store.record("test").hops).toBe(0);
    fireEvent.click(screen.getByRole("button", { name: "Egress" }));
    expect(store.record("test").filters.direction).toBe("all");
  });

  it("namespace view: one card per workload and a box for workloads without a release", async () => {
    const { container } = render(
      <ServiceMapPage clusterId="test" extension={extension} params={{ namespace: shop }} createLive={createLive} />,
    );
    await vi.waitFor(() => expect(container.querySelectorAll("[data-testid=workload-card]")).toHaveLength(12));
    expect(screen.getByText("(no Helm release)")).toBeTruthy();
  });

  it("explode removes release boxes", async () => {
    const store = new ServiceMapStore();
    store.update("test", { layout: { ...store.record("test").layout, explode: true } });
    const { container } = render(
      <ServiceMapPage
        clusterId="test"
        store={store}
        extension={extension}
        params={{ namespace: shop }}
        createLive={createLive}
      />,
    );
    await vi.waitFor(() => expect(container.querySelectorAll("[data-testid=workload-card]")).toHaveLength(12));
    expect(screen.queryByText("(no Helm release)")).toBeNull();
  });

  it("follows the host's page params when they change while the page stays mounted", async () => {
    const namespace = observable.box("");
    const { container } = render(
      <MapPage clusterId="test" extension={extension} params={{ namespace }} createLive={createLive} />,
    );
    await vi.waitFor(() => expect(container.querySelectorAll("[data-testid=ns-card]").length).toBeGreaterThan(0));
    runInAction(() => namespace.set(shop));
    await vi.waitFor(() => expect(container.querySelectorAll("[data-testid=workload-card]")).toHaveLength(12));
  });

  it("draws a namespace with no workloads as a card with 0", async () => {
    const withEmpty = { ...s, namespaces: [...s.namespaces, "empty"] };
    const { container } = render(
      <ServiceMapPage
        clusterId="test"
        extension={extension}
        params={{}}
        createLive={fake(state(withEmpty)).createLive}
      />,
    );
    await vi.waitFor(() =>
      expect(
        [...container.querySelectorAll("[data-testid=ns-card]")].some((c) =>
          /empty[\s\S]*0 workloads/.test(c.textContent ?? ""),
        ),
      ).toBe(true),
    );
  });

  it("says why the map is empty", async () => {
    const none = { ...s, namespaces: [], workloads: [], routes: [], loadBalancers: [], edges: [] };
    const kube = {
      id: "kubernetes" as const,
      ok: false,
      detail: "2 lists not readable",
      fix: 'needs "list" on pods, deployments',
    };
    const x = state(none);
    render(
      <ServiceMapPage
        clusterId="test"
        extension={extension}
        params={{}}
        createLive={fake({ ...x, sources: [kube, ...x.sources.slice(1)] }).createLive}
      />,
    );
    expect(await screen.findByText(/Nothing to draw: 2 lists not readable/)).toBeTruthy();
  });

  it("explains that system namespaces are not drawn", async () => {
    render(
      <ServiceMapPage
        clusterId="test"
        extension={extension}
        params={{ namespace: "kube-system" }}
        createLive={createLive}
      />,
    );
    expect(await screen.findByText(/kube-system is a system namespace/)).toBeTruthy();
  });

  it("stops the live source when the page goes away", () => {
    const f = fake(state(s));
    render(<ServiceMapPage clusterId="test" extension={extension} params={{}} createLive={f.createLive} />).unmount();
    expect(f.stop).toHaveBeenCalledOnce();
  });

  it("shows CPU and RAM with % of limit on cards", async () => {
    const { container } = render(
      <ServiceMapPage clusterId="test" extension={extension} params={{ namespace: shop }} createLive={createLive} />,
    );
    await vi.waitFor(() =>
      expect(
        [...container.querySelectorAll("[data-testid=workload-card]")].some((c) =>
          /CPU \d+m \(\d+%\)/.test(c.textContent ?? ""),
        ),
      ).toBe(true),
    );
  });

  it("shows CPU and RAM as unknown for a workload Prometheus has no sample of", async () => {
    const quiet = s.workloads.find((w) => w.ns === shop)!;
    const others = new Set(s.workloads.filter((w) => w !== quiet).map((w) => w.id));
    const { container } = render(
      <ServiceMapPage
        clusterId="test"
        extension={extension}
        params={{ namespace: shop }}
        createLive={fake(state(s, { sampled: { cpu: others, mem: others } })).createLive}
      />,
    );
    await vi.waitFor(() => expect(container.querySelectorAll("[data-testid=workload-card]")).toHaveLength(12));
    const texts = [...container.querySelectorAll("[data-testid=workload-card]")].map((c) => c.textContent ?? "");
    expect(texts.filter((t) => t.includes("CPU – · RAM –"))).toHaveLength(1);
  });

  it("says CPU/RAM need Prometheus when Prometheus is not there", async () => {
    const x = state(s, { level: "Kubernetes only" });
    const prom = { id: "prometheus" as const, ok: false, detail: "no Prometheus service found", fix: null };
    const { container } = render(
      <ServiceMapPage
        clusterId="test"
        extension={extension}
        params={{ namespace: shop }}
        createLive={fake({ ...x, sources: [x.sources[0]!, prom, x.sources[2]!] }).createLive}
      />,
    );
    await vi.waitFor(() => expect(container.querySelectorAll("[data-testid=workload-card]")).toHaveLength(12));
    expect(screen.getAllByText("CPU/RAM need Prometheus")).toHaveLength(12);
  });

  it("does not lay out again when only rates change", async () => {
    const f = fake(state(s));
    vi.mocked(layoutGraph).mockClear();
    const { container } = render(
      <ServiceMapPage clusterId="test" extension={extension} params={{ namespace: shop }} createLive={f.createLive} />,
    );
    await vi.waitFor(() => expect(container.querySelectorAll("[data-testid=workload-card]")).toHaveLength(12));
    const rates = () =>
      [...container.querySelectorAll("[data-testid=workload-card]")].map(
        (c) => /([\d.]+) flows\/s/.exec(c.textContent ?? "")?.[1],
      );
    const before = rates();
    expect(before.some((r) => Number(r) > 0)).toBe(true);
    f.emit(state({ ...s, edges: s.edges.map((e) => ({ ...e, flowsPerSec: e.flowsPerSec * 2 + 1 })) }));
    await vi.waitFor(() => expect(rates()).not.toEqual(before));
    expect(layoutGraph).toHaveBeenCalledOnce();
  });

  it("lays out again when a workload goes away", async () => {
    const f = fake(state(s));
    vi.mocked(layoutGraph).mockClear();
    const { container } = render(
      <ServiceMapPage clusterId="test" extension={extension} params={{ namespace: shop }} createLive={f.createLive} />,
    );
    await vi.waitFor(() => expect(container.querySelectorAll("[data-testid=workload-card]")).toHaveLength(12));
    const gone = s.workloads.find((w) => w.ns === shop)!;
    f.emit(state({ ...s, workloads: s.workloads.filter((w) => w !== gone) }));
    await vi.waitFor(() => expect(container.querySelectorAll("[data-testid=workload-card]")).toHaveLength(11));
    expect(layoutGraph).toHaveBeenCalledTimes(2);
  });

  // a link between two workloads of `shop` that have none: a topology change of the namespace view
  const added = () => {
    const ws = s.workloads.filter((w) => w.ns === shop);
    const linked = new Set(s.edges.flatMap((e) => [`${e.src}>${e.dst}`, `${e.dst}>${e.src}`]));
    const [a, b] = ws.flatMap((a) =>
      ws.filter((b) => b !== a && !linked.has(`${a.id}>${b.id}`)).map((b) => [a, b]),
    )[0]!;
    const edge = { ...s.edges[0]!, src: a!.id, dst: b!.id, samples: [] };
    return state({ ...s, edges: [...s.edges, edge] });
  };

  it("keeps drawing the map while a new layout runs", async () => {
    const f = fake(state(s));
    const { container } = render(
      <ServiceMapPage clusterId="test" extension={extension} params={{ namespace: shop }} createLive={f.createLive} />,
    );
    await vi.waitFor(() => expect(container.querySelectorAll("[data-testid=workload-card]")).toHaveLength(12));
    vi.mocked(layoutGraph).mockClear();
    vi.mocked(layoutGraph).mockImplementationOnce(() => new Promise(() => {}));
    f.emit(added());
    await vi.waitFor(() => expect(layoutGraph).toHaveBeenCalledOnce());
    expect(container.querySelectorAll("[data-testid=workload-card]")).toHaveLength(12);
  });

  it("keeps the same React Flow, and its viewport, across a new layout of the same view", async () => {
    const f = fake(state(s));
    vi.mocked(layoutGraph).mockClear();
    const { container } = render(
      <ServiceMapPage clusterId="test" extension={extension} params={{ namespace: shop }} createLive={f.createLive} />,
    );
    await vi.waitFor(() => expect(container.querySelectorAll("[data-testid=workload-card]")).toHaveLength(12));
    const flow = container.querySelector(".react-flow");
    f.emit(added());
    await vi.waitFor(() => expect(layoutGraph).toHaveBeenCalledTimes(2));
    await act(() => vi.mocked(layoutGraph).mock.results[1]!.value);
    expect(container.querySelector(".react-flow")).toBe(flow);
    expect(container.querySelectorAll("[data-testid=workload-card]")).toHaveLength(12);
  });

  it("says why there is no map when the objects cannot be listed", async () => {
    const x = state(s);
    const kube = { id: "kubernetes" as const, ok: false, detail: "objects not listed: boom", fix: null };
    render(
      <ServiceMapPage
        clusterId="test"
        extension={extension}
        params={{}}
        createLive={fake({ ...x, snapshot: null, sources: [kube, ...x.sources.slice(1)] }).createLive}
      />,
    );
    expect(await screen.findByText(/Nothing to draw: objects not listed: boom/)).toBeTruthy();
  });
});

describe("view state", () => {
  const mount = (store: ServiceMapStore, params = {}) =>
    render(
      <ServiceMapPage clusterId="c1" store={store} extension={extension} params={params} createLive={createLive} />,
    );
  // React Flow draws no edges in jsdom; the links handed to the layout are the ones kept
  const edgeCount = () => vi.mocked(layoutGraph).mock.calls.at(-1)?.[2].length ?? 0;

  it("the color-blind palette is set from settings", async () => {
    const store = new ServiceMapStore();
    const { container } = mount(store);
    const page = () => container.firstElementChild as HTMLElement;
    expect(page().getAttribute("data-palette")).toBeNull();
    act(() => store.update("c1", { settings: { ...store.record("c1").settings, palette: "cb" } }));
    await vi.waitFor(() => expect(page().getAttribute("data-palette")).toBe("cb"));
  });

  it("hops 0 shows links n+1 hides", async () => {
    const store = new ServiceMapStore();
    const { container } = mount(store, { namespace: shop });
    await vi.waitFor(() => expect(container.querySelectorAll("[data-testid=workload-card]")).toHaveLength(12));
    const one = edgeCount();
    expect(one).toBeGreaterThan(0);
    act(() => store.update("c1", { hops: 0 }));
    await vi.waitFor(() => expect(edgeCount()).toBeGreaterThan(one));
  });

  it("a hidden namespace disappears from the cluster view", async () => {
    const store = new ServiceMapStore();
    const { container } = mount(store);
    const all = new Set(s.workloads.map((w) => w.ns)).size;
    await vi.waitFor(() => expect(container.querySelectorAll("[data-testid=ns-card]")).toHaveLength(all));
    act(() => store.update("c1", { filters: { ...store.record("c1").filters, hiddenNs: [shop] } }));
    await vi.waitFor(() => expect(container.querySelectorAll("[data-testid=ns-card]")).toHaveLength(all - 1));
  });

  it("Changes shows new and gone links", async () => {
    const a = loadFixture("capture-a");
    const invA = buildInventory(a.objects, a.metrics);
    const flowsA = flowsToEdges(a.flows, invA, {
      self: a.cluster.self,
      clusterCidrs: a.cluster.clusterCidrs,
      namedNetworks: [],
      clusterIps: invA.clusterIps,
    });
    const baseline = toSnapshot(invA, flowsA, "dev", a.cluster.clusterCidrs);
    const store = new ServiceMapStore();
    store.update("c1", { hops: 0, filters: { ...store.record("c1").filters, changes: true } });
    const f = fake(state(s, { baseline, baselineLabel: "snapshot from 09:07" }));
    vi.mocked(layoutGraph).mockClear();
    render(
      <ServiceMapPage
        clusterId="c1"
        store={store}
        extension={extension}
        params={{ namespace: shop }}
        createLive={f.createLive}
      />,
    );
    await vi.waitFor(() => expect(vi.mocked(layoutGraph)).toHaveBeenCalled());
    const changes = vi
      .mocked(layoutGraph)
      .mock.calls.at(-1)![2]
      .map((e) => e.change);
    expect(changes).toContain("new");
    expect(changes).toContain("gone");
    expect(changes.every((c) => c === "new" || c === "gone")).toBe(true);
  });

  it("Changes is disabled without a baseline", async () => {
    const store = new ServiceMapStore();
    const f = fake(state(s));
    render(<ServiceMapPage clusterId="c1" store={store} extension={extension} params={{}} createLive={f.createLive} />);
    await screen.findByText("Data: Prometheus only");
    const chip = screen.getByRole("button", { name: "Changes" }) as HTMLButtonElement;
    expect(chip.disabled).toBe(true);
    expect(chip.title).toBe("No baseline yet");
    f.emit(state(s, { baseline: s, baselineLabel: "snapshot from 09:07" }));
    expect(chip.disabled).toBe(false);
    expect(screen.getByText("Changes baseline: snapshot from 09:07")).toBeTruthy();
  });

  it("a persisted Changes without a baseline can be turned off and narrows nothing", async () => {
    const store = new ServiceMapStore();
    store.update("c1", { filters: { ...store.record("c1").filters, changes: true } });
    vi.mocked(layoutGraph).mockClear();
    render(
      <ServiceMapPage
        clusterId="c1"
        store={store}
        extension={extension}
        params={{ namespace: shop }}
        createLive={createLive}
      />,
    );
    await vi.waitFor(() => expect(vi.mocked(layoutGraph)).toHaveBeenCalled());
    // Changes narrows to changed links only; without a baseline the links stay
    expect(vi.mocked(layoutGraph).mock.calls.at(-1)![2].length).toBeGreaterThan(0);
    const chip = screen.getByRole("button", { name: "Changes" }) as HTMLButtonElement;
    expect(chip.disabled).toBe(false);
    expect(chip.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(chip);
    expect(store.record("c1").filters.changes).toBe(false);
    expect(chip.disabled).toBe(true);
  });

  it("state survives a remount", async () => {
    const cards = (c: HTMLElement) => c.querySelectorAll("[data-testid=workload-card]");
    const counts: number[] = [];
    for (const hops of [1, 2] as const) {
      const probe = new ServiceMapStore();
      probe.update("c1", { hops });
      vi.mocked(layoutGraph).mockClear();
      const { container, unmount } = mount(probe, { namespace: shop });
      await vi.waitFor(() => expect(cards(container)).toHaveLength(12));
      counts.push(edgeCount());
      unmount();
    }
    expect(counts[0]).not.toBe(counts[1]);

    const store = new ServiceMapStore();
    store.update("c1", { hops: 1 });
    mount(store, { namespace: shop }).unmount();
    act(() => store.update("c1", { hops: 2 }));
    vi.mocked(layoutGraph).mockClear();
    const { container } = mount(store, { namespace: shop });
    await vi.waitFor(() => expect(cards(container)).toHaveLength(12));
    expect(vi.mocked(layoutGraph).mock.calls[0]![2]).toHaveLength(counts[1]!);
  });

  it("a drag stop remembers the dragged boxes of the view, also two in a row", async () => {
    const store = new ServiceMapStore();
    const { container } = mount(store, { namespace: shop });
    await vi.waitFor(() => expect(container.querySelectorAll("[data-testid=workload-card]")).toHaveLength(12));
    const stop = flowProps.current!.onNodeDragStop!;
    const at = (id: string, x: number, y: number) => ({ id, position: { x, y }, data: {} }) as Node;
    act(() => {
      stop(new MouseEvent("mouseup") as never, at("grp:a", 1, 2), [at("grp:a", 1, 2)]);
      stop(new MouseEvent("mouseup") as never, at("grp:b", 3, 4), [at("grp:b", 3, 4)]);
    });
    expect(store.record("c1").positions[`${shop}|1`]).toEqual({ "grp:a": { x: 1, y: 2 }, "grp:b": { x: 3, y: 4 } });
  });

  it("re-routes with libavoid when the geometry changes, not when a node is selected", async () => {
    const { loadAvoid: real } = await vi.importActual<typeof import("./routing")>("./routing");
    const A = await real(resolve("node_modules/libavoid-js/dist/libavoid.wasm"));
    vi.mocked(loadAvoid).mockResolvedValueOnce(A);
    vi.mocked(avoidRoutes).mockClear();
    const { container } = mount(new ServiceMapStore(), { namespace: shop });
    await vi.waitFor(() => expect(vi.mocked(avoidRoutes)).toHaveBeenCalledTimes(1));
    fireEvent.click(container.querySelector("[data-testid=workload-card]")!);
    await act(() => new Promise((r) => requestAnimationFrame(r)));
    expect(vi.mocked(avoidRoutes)).toHaveBeenCalledTimes(1);
  });

  it("Reset positions clears the stored positions and lays out again", async () => {
    const store = new ServiceMapStore();
    const key = `${shop}|1`;
    store.update("c1", { positions: { [key]: { n: { x: 5, y: 6 } } } });
    const { container } = mount(store, { namespace: shop });
    await vi.waitFor(() => expect(container.querySelectorAll("[data-testid=workload-card]")).toHaveLength(12));
    vi.mocked(layoutGraph).mockClear();
    fireEvent.click(screen.getByText("Reset positions"));
    await vi.waitFor(() => expect(layoutGraph).toHaveBeenCalledOnce());
    expect(store.record("c1").positions[key]).toBeUndefined();
  });

  it("draws a release box where the user left it; boxes drag, cards do not", async () => {
    const box = "grp:(no Helm release)";
    const store = new ServiceMapStore();
    store.update("c1", {
      positions: { [`${shop}|1`]: { [box]: { x: 1234, y: 567 }, [`${shop}/deployment/deleted`]: { x: 1, y: 1 } } },
    });
    const { container } = mount(store, { namespace: shop });
    await vi.waitFor(() => expect(container.querySelectorAll("[data-testid=workload-card]")).toHaveLength(12));
    const node = (id: string) =>
      container.querySelector<HTMLElement>(`.react-flow__node[data-id="${CSS.escape(id)}"]`)!;
    expect(node(box).style.transform).toBe("translate(1234px,567px)");
    expect(node(box).classList.contains("draggable")).toBe(true);
    const card = s.workloads.find((w) => w.ns === shop)!.id;
    expect(node(card).classList.contains("draggable")).toBe(false);
  });
});

describe("selection", () => {
  const target = s.workloads.find((w) => w.ns === shop)!;
  const mountSelect = (select?: string) => {
    let fit!: ReturnType<typeof vi.fn>;
    const view = render(
      <ServiceMapPage
        clusterId="test"
        extension={extension}
        params={{ namespace: shop, select }}
        createLive={createLive}
        onFlow={(rf) => {
          fit = vi.spyOn(rf, "fitView").mockResolvedValue(true) as never;
        }}
      />,
    );
    return { ...view, fit: () => fit };
  };

  it("select param zooms to the node", async () => {
    const { container, fit } = mountSelect(target.id);
    await vi.waitFor(() => expect(container.querySelectorAll("[data-testid=workload-card]")).toHaveLength(12));
    await vi.waitFor(() =>
      expect(fit()).toHaveBeenCalledWith({ nodes: [{ id: target.id }], maxZoom: 1.3, padding: 0.4 }),
    );
    expect(screen.getByTestId("panel").textContent).toContain(target.kind);
    expect(screen.getByTestId("panel").textContent).toContain(shortName(target));
    expect(container.querySelector(`.react-flow__node[data-id="${target.id}"]`)!.classList).toContain("selected");
  });

  it("node click selects, pane click clears", async () => {
    const { container } = mountSelect();
    await vi.waitFor(() => expect(container.querySelectorAll("[data-testid=workload-card]")).toHaveLength(12));
    expect(screen.getByTestId("panel").textContent).toContain("workloads");
    const card = container.querySelector<HTMLElement>(`.react-flow__node[data-id="${target.id}"]`)!;
    fireEvent.click(card);
    expect(screen.getByTestId("panel").textContent).toContain(shortName(target));
    fireEvent.click(container.querySelector(".react-flow__pane")!);
    expect(screen.getByTestId("panel").textContent).toContain("workloads");
  });
});

describe("search", () => {
  const open = async (q: string) => {
    let rf!: ReactFlowInstance;
    const { container } = render(
      <ServiceMapPage
        clusterId="test"
        extension={extension}
        params={{ namespace: shop }}
        createLive={createLive}
        onFlow={(i) => (rf = i)}
      />,
    );
    await vi.waitFor(() => expect(container.querySelectorAll("[data-testid=workload-card]")).toHaveLength(12));
    await vi.waitFor(() => expect(rf).toBeTruthy());
    const fit = vi.spyOn(rf, "fitView").mockResolvedValue(true);
    const box = screen.getByRole("searchbox");
    fireEvent.change(box, { target: { value: q } });
    return { container, fit, box };
  };
  const wrappers = (c: HTMLElement) => [...c.querySelectorAll<HTMLElement>(".react-flow__node-card")];

  it("no match zooms nowhere", async () => {
    const { container, fit, box } = await open("zzz-no-such");
    fireEvent.keyDown(box, { key: "Enter" });
    expect(fit).not.toHaveBeenCalled();
    // nothing is hidden: every card is still drawn, dimmed
    expect(wrappers(container)).toHaveLength(12);
    expect(wrappers(container).every((n) => n.style.opacity === "0.28")).toBe(true);
  });

  // workload ids in the open namespace whose card label contains q; none of the outside nodes' labels contain it
  const expected = (q: string) =>
    s.workloads
      .filter((w) => w.ns === shop && shortName(w).toLowerCase().includes(q))
      .map((w) => w.id)
      .sort();
  const fitted = (fit: { mock: { calls: unknown[][] } }) =>
    (fit.mock.calls[0]![0] as { nodes: Array<{ id: string }> }).nodes.map((n) => n.id).sort();

  it("fits exactly the matching cards, not every node", async () => {
    const { fit, box } = await open("mongo");
    const want = expected("mongo");
    expect(want.length).toBeGreaterThan(0);
    expect(want.length).toBeLessThan(12);
    fireEvent.keyDown(box, { key: "Enter" });
    expect(fit).toHaveBeenCalledTimes(1);
    expect(fit.mock.calls[0]![0]).toMatchObject({ padding: 0.4, duration: 400, maxZoom: 1.3 });
    expect(fitted(fit)).toEqual(want);
  });

  it("fits every card when every card matches", async () => {
    const { fit, box } = await open("");
    fireEvent.change(box, { target: { value: "a" } });
    fireEvent.keyDown(box, { key: "Enter" });
    const ids = fitted(fit);
    expect(ids).toEqual(expect.arrayContaining(expected("a")));
    expect(ids.some((id) => id.startsWith("grp"))).toBe(false);
  });

  it("Escape clears the query and the dimming", async () => {
    const { container, box } = await open("zzz-no-such");
    fireEvent.keyDown(box, { key: "Escape" });
    expect(wrappers(container).some((n) => n.style.opacity === "0.28")).toBe(false);
  });
});

describe("anonymize", () => {
  const { names, generic } = realStrings(s);
  it("leaves out only the generic words, by name", () => expect(generic).toEqual(GENERIC));
  const leaks = (markup: string) => names.filter((n) => markup.includes(n));

  it("anonymized export contains no real name", async () => {
    const store = new ServiceMapStore();
    store.update("test", { settings: { ...store.record("test").settings, anonymize: true } });
    const { container } = render(
      <ServiceMapPage
        clusterId="test"
        store={store}
        extension={extension}
        params={{ namespace: shop }}
        createLive={createLive}
      />,
    );
    await vi.waitFor(() => expect(container.querySelectorAll("[data-testid=workload-card]")).toHaveLength(12));
    // what an export draws (the viewport), the panel next to it, and the breadcrumb above
    const shot = () =>
      [".react-flow__viewport", "[data-testid=panel]", "nav"]
        .map((q) => container.querySelector(q)!.outerHTML)
        .join("\n");
    const shots = [shot()];
    const node = (id: string) =>
      container.querySelector<HTMLElement>(`.react-flow__node[data-id="${CSS.escape(id)}"]`)!;
    // every node's panel, and every link's, opened from the peer rows: jsdom draws no links (React Flow cannot measure)
    const ids = [...container.querySelectorAll<HTMLElement>(".react-flow__node:not(.react-flow__node-grp)")].map(
      (n) => n.dataset.id!,
    );
    for (const id of ids) {
      fireEvent.click(node(id));
      shots.push(shot());
      for (const peer of [...container.querySelectorAll<HTMLElement>("[data-peer]")].map((r) => r.dataset.peer!)) {
        fireEvent.click(node(id));
        const row = container.querySelector<HTMLElement>(`[data-peer="${CSS.escape(peer)}"]`)!;
        fireEvent.click(row.querySelector("button") ?? row);
        shots.push(shot());
      }
    }
    // the sections that print hosts, paths, IPs, DNS names, pods and labels were all drawn
    for (const sec of ["Pods", "Labels", "HTTPRoutes", "Connections", "Endpoints", "Helm releases"])
      expect(
        shots.some((x) => x.includes(sec)),
        sec,
      ).toBe(true);
    const all = scrub(shots.join("\n"));
    expect(leaks(all)).toEqual([]);
  });

  it("exports the viewport with the arrowheads in it, named after the cluster's alias", async () => {
    const store = new ServiceMapStore();
    store.update("test", { settings: { ...store.record("test").settings, anonymize: true } });
    const names: string[] = [];
    Object.assign(URL, { createObjectURL: () => "blob:x", revokeObjectURL: () => {} });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      names.push(this.download);
    });
    const { container } = render(
      <ServiceMapPage
        clusterId="test"
        store={store}
        extension={extension}
        params={{ namespace: shop }}
        createLive={createLive}
      />,
    );
    await vi.waitFor(() => expect(container.querySelectorAll("[data-testid=workload-card]")).toHaveLength(12));
    fireEvent.click(screen.getByText("Export PNG"));
    await vi.waitFor(() => expect(names).toHaveLength(1));
    const el = vi.mocked(toPng).mock.calls[0]![0];
    expect(el.classList).toContain("react-flow__viewport");
    expect(el.querySelector("marker#arrow-crit")).not.toBeNull();
    expect(vi.mocked(toPng).mock.calls[0]![1]).toMatchObject({ width: expect.any(Number), height: expect.any(Number) });
    expect(names[0]).toMatch(/^service-map-cluster-1-\d{8}-\d{4}\.png$/);
    click.mockRestore();
  });

  it("search matches the aliases", async () => {
    const store = new ServiceMapStore();
    store.update("test", { settings: { ...store.record("test").settings, anonymize: true } });
    let rf!: ReactFlowInstance;
    const { container } = render(
      <ServiceMapPage
        clusterId="test"
        store={store}
        extension={extension}
        params={{ namespace: shop }}
        createLive={createLive}
        onFlow={(i) => (rf = i)}
      />,
    );
    await vi.waitFor(() => expect(container.querySelectorAll("[data-testid=workload-card]")).toHaveLength(12));
    await vi.waitFor(() => expect(rf).toBeTruthy());
    const fit = vi.spyOn(rf, "fitView").mockResolvedValue(true);
    const box = screen.getByRole("searchbox");
    fireEvent.change(box, { target: { value: "svc-" } });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(fit).toHaveBeenCalledTimes(1);
    fit.mockClear();
    fireEvent.change(box, { target: { value: shortName(s.workloads.find((x) => x.ns === shop && !x.db)!) } });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(fit).not.toHaveBeenCalled();
  });
});

describe("all-clusters view", () => {
  const withLink = {
    ...s,
    edges: [
      ...s.edges,
      {
        src: s.workloads[0]!.id,
        dst: "@cluster:prod",
        proto: "TCP",
        port: 443,
        app: "",
        flowsPerSec: 2,
        connsPerSec: 1,
        dropRate: 0,
        samples: [],
      },
    ],
  };
  const clusters = [
    { id: "id-dev", name: "dev", status: "connected" },
    { id: "id-prod", name: "prod", status: "disconnected" },
  ];
  const open = async (navigate = vi.fn()) => {
    vi.mocked(Renderer.Catalog.getAllClusters).mockReturnValue(clusters as never);
    const f = fake(state(withLink));
    render(
      <ServiceMapPage
        clusterId="test"
        extension={{ navigate }}
        params={{ namespace: "@clusters" }}
        createLive={f.createLive}
      />,
    );
    await screen.findByText("Data: Prometheus only");
    return navigate;
  };

  it("draws the catalog's clusters, with Connect for the others and a link", async () => {
    await open();
    expect(await screen.findByText("this cluster · double-click")).toBeTruthy();
    expect(screen.getAllByText(/not live here/)).toHaveLength(2);
    expect(screen.queryByText(/system namespace|No Deployments/)).toBeNull();
    expect(screen.queryByText(/Show n\+1/)).toBeNull();
    await vi.waitFor(() =>
      expect(flowProps.current?.edges?.some((e) => e.target === "cluster:n4780c-cc-k8s-mgmt")).toBe(true),
    );
  });

  it("Connect opens the cluster in the root frame", async () => {
    await open();
    fireEvent.click(await screen.findByText("Connect"));
    expect(Renderer.Navigation.navigate).toHaveBeenCalledWith("/cluster/id-prod");
  });

  it("the crumbs are just All clusters, as the current page", async () => {
    await open();
    await screen.findByText("this cluster · double-click");
    expect(screen.getByRole("navigation").textContent).toBe("All clusters");
    expect(screen.queryByRole("button", { name: "All clusters" })).toBeNull();
  });

  it("a connected cluster says Open, not Connect", async () => {
    clusters[1]!.status = "connected";
    try {
      const navigate = await open();
      expect(await screen.findByText(/connected in Freelens/)).toBeTruthy();
      expect(screen.queryByText("Connect")).toBeNull();
      fireEvent.click(screen.getByText("Open"));
      expect(Renderer.Navigation.navigate).toHaveBeenCalledWith("/cluster/id-prod");
      expect(navigate).not.toHaveBeenCalled();
    } finally {
      clusters[1]!.status = "disconnected";
    }
  });

  it("double-clicking this cluster opens the cluster view", async () => {
    const navigate = await open();
    await screen.findByText("this cluster · double-click");
    act(() => flowProps.current!.onNodeDoubleClick!({} as never, { id: "cluster:dev" } as Node));
    expect(navigate).toHaveBeenLastCalledWith(expect.any(String), {});
  });
});
