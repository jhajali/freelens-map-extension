// @vitest-environment jsdom
import { act, render, screen } from "@testing-library/react";
import { observable, runInAction } from "mobx";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { loadFixture } from "../../../test/fixture";
import { flowsToEdges, toSnapshot } from "../../common/graph/flows";
import { buildInventory } from "../../common/graph/inventory";
import { layoutGraph } from "./layout";
import { MapPage, ServiceMapPage } from "./service-map-page";

import type { Snapshot } from "../../common/graph/types";
import type { LiveState } from "./live-map";

// the real layout, counted
vi.mock("./layout", async (importOriginal) => {
  const real = await importOriginal<typeof import("./layout")>();
  return { ...real, layoutGraph: vi.fn(real.layoutGraph) };
});

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
  it("cluster view: one card per namespace, labelled with the data level", async () => {
    const { container } = render(<ServiceMapPage extension={extension} params={{}} createLive={createLive} />);
    expect(await screen.findByText("Data: Prometheus only")).toBeTruthy();
    await vi.waitFor(() =>
      expect(container.querySelectorAll("[data-testid=ns-card]")).toHaveLength(
        new Set(s.workloads.map((w) => w.ns)).size,
      ),
    );
  });

  it("namespace view: one card per workload and a box for workloads without a release", async () => {
    const { container } = render(
      <ServiceMapPage extension={extension} params={{ namespace: shop }} createLive={createLive} />,
    );
    await vi.waitFor(() => expect(container.querySelectorAll("[data-testid=workload-card]")).toHaveLength(12));
    expect(screen.getByText("(no Helm release)")).toBeTruthy();
  });

  it("follows the host's page params when they change while the page stays mounted", async () => {
    const namespace = observable.box("");
    const { container } = render(<MapPage extension={extension} params={{ namespace }} createLive={createLive} />);
    await vi.waitFor(() => expect(container.querySelectorAll("[data-testid=ns-card]").length).toBeGreaterThan(0));
    runInAction(() => namespace.set(shop));
    await vi.waitFor(() => expect(container.querySelectorAll("[data-testid=workload-card]")).toHaveLength(12));
  });

  it("draws a namespace with no workloads as a card with 0", async () => {
    const withEmpty = { ...s, namespaces: [...s.namespaces, "empty"] };
    const { container } = render(
      <ServiceMapPage extension={extension} params={{}} createLive={fake(state(withEmpty)).createLive} />,
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
        extension={extension}
        params={{}}
        createLive={fake({ ...x, sources: [kube, ...x.sources.slice(1)] }).createLive}
      />,
    );
    expect(await screen.findByText(/Nothing to draw: 2 lists not readable/)).toBeTruthy();
  });

  it("explains that system namespaces are not drawn", async () => {
    render(<ServiceMapPage extension={extension} params={{ namespace: "kube-system" }} createLive={createLive} />);
    expect(await screen.findByText(/kube-system is a system namespace/)).toBeTruthy();
  });

  it("stops the live source when the page goes away", () => {
    const f = fake(state(s));
    render(<ServiceMapPage extension={extension} params={{}} createLive={f.createLive} />).unmount();
    expect(f.stop).toHaveBeenCalledOnce();
  });

  it("shows CPU and RAM with % of limit on cards", async () => {
    const { container } = render(
      <ServiceMapPage extension={extension} params={{ namespace: shop }} createLive={createLive} />,
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
      <ServiceMapPage extension={extension} params={{ namespace: shop }} createLive={f.createLive} />,
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
      <ServiceMapPage extension={extension} params={{ namespace: shop }} createLive={f.createLive} />,
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
      <ServiceMapPage extension={extension} params={{ namespace: shop }} createLive={f.createLive} />,
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
      <ServiceMapPage extension={extension} params={{ namespace: shop }} createLive={f.createLive} />,
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
        extension={extension}
        params={{}}
        createLive={fake({ ...x, snapshot: null, sources: [kube, ...x.sources.slice(1)] }).createLive}
      />,
    );
    expect(await screen.findByText(/Nothing to draw: objects not listed: boom/)).toBeTruthy();
  });
});
