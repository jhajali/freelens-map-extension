// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { observable, runInAction } from "mobx";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { loadFixture } from "../../../test/fixture";
import { toSnapshot } from "../../common/graph/flows";
import { buildInventory } from "../../common/graph/inventory";
import { MapPage, ServiceMapPage } from "./service-map-page";

// the spike panel talks to main over IPC, which the host stub does not have
vi.mock("../diagnostics/feasibility-panel", () => ({ FeasibilityPanel: () => null }));

const fx = loadFixture("capture-b");
const s = toSnapshot(buildInventory(fx.objects, fx.metrics), { edges: [], windowSec: 0, capturedAt: "" }, "dev", {});
const load = () => Promise.resolve(s);
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
  it("cluster view: one card per namespace, labelled Kubernetes only", async () => {
    const { container } = render(<ServiceMapPage extension={extension} params={{}} load={load} />);
    expect(await screen.findByText(/Kubernetes only/)).toBeTruthy();
    await vi.waitFor(() =>
      expect(container.querySelectorAll("[data-testid=ns-card]")).toHaveLength(
        new Set(s.workloads.map((w) => w.ns)).size,
      ),
    );
  });

  it("namespace view: one card per workload and a box for workloads without a release", async () => {
    const { container } = render(<ServiceMapPage extension={extension} params={{ namespace: shop }} load={load} />);
    await vi.waitFor(() => expect(container.querySelectorAll("[data-testid=workload-card]")).toHaveLength(12));
    expect(screen.getByText("(no Helm release)")).toBeTruthy();
  });

  it("follows the host's page params when they change while the page stays mounted", async () => {
    const namespace = observable.box("");
    const { container } = render(<MapPage extension={extension} params={{ namespace }} load={load} />);
    await vi.waitFor(() => expect(container.querySelectorAll("[data-testid=ns-card]").length).toBeGreaterThan(0));
    runInAction(() => namespace.set(shop));
    await vi.waitFor(() => expect(container.querySelectorAll("[data-testid=workload-card]")).toHaveLength(12));
  });

  it("draws a namespace with no workloads as a card with 0", async () => {
    const withEmpty = { ...s, namespaces: [...s.namespaces, "empty"] };
    const { container } = render(
      <ServiceMapPage extension={extension} params={{}} load={() => Promise.resolve(withEmpty)} />,
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
    const none = {
      ...s,
      namespaces: [],
      workloads: [],
      routes: [],
      loadBalancers: [],
      unreadable: ["/api/v1/pods", "/apis/apps/v1/deployments"],
    };
    render(<ServiceMapPage extension={extension} params={{}} load={() => Promise.resolve(none)} />);
    expect(await screen.findByText(/2 lists not readable/)).toBeTruthy();
  });

  it("explains that system namespaces are not drawn", async () => {
    render(<ServiceMapPage extension={extension} params={{ namespace: "kube-system" }} load={load} />);
    expect(await screen.findByText(/kube-system is a system namespace/)).toBeTruthy();
  });
});
