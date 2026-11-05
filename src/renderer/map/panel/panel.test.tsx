// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { RateHistory } from "../../../common/graph/history";
import { Panel, type PanelProps } from "./panel";

import type { MapEdge, Snapshot, Workload } from "../../../common/graph/types";

const api = { id: "shop/api", ns: "shop", name: "api", kind: "Deployment" } as Workload;
const db = { id: "shop/db", ns: "shop", name: "db", kind: "StatefulSet" } as Workload;
const s = {
  cluster: "dev",
  capturedAt: "",
  windowSec: 150,
  namespaces: ["shop"],
  workloads: [api, db],
  routes: [],
  loadBalancers: [],
  edges: [],
  policies: [],
  clusterCidrs: {},
} as Snapshot;
const props = (over: Partial<PanelProps> = {}): PanelProps => ({
  selection: null,
  s,
  edges: [] as MapEdge[],
  drawn: new Set(["shop/api"]),
  history: new RateHistory(),
  level: "Hubble + Prometheus",
  width: 380,
  onWidth: vi.fn(),
  ...over,
});
// jsdom's window is 1024 px wide: 70 % is 716.8 px
const wrap = (c: HTMLElement) => c.firstElementChild as HTMLElement;

describe("Panel", () => {
  it("resizes within 320 px and 70 %", () => {
    const onWidth = vi.fn();
    const { container } = render(<Panel {...props({ onWidth })} />);
    const grip = screen.getByRole("separator", { name: "Resize details" });
    fireEvent.pointerDown(grip, { clientX: 640 });
    fireEvent.pointerMove(window, { clientX: 0 });
    expect(wrap(container).style.width).toBe("716px");
    fireEvent.pointerMove(window, { clientX: 1000 });
    expect(wrap(container).style.width).toBe("320px");
    // persisted once, on drag end
    expect(onWidth).not.toHaveBeenCalled();
    fireEvent.pointerUp(window, { clientX: 1000 });
    expect(onWidth).toHaveBeenCalledTimes(1);
    expect(onWidth).toHaveBeenCalledWith(320);
    // the drag is over: the width is the prop again (the parent persists it), and moves do nothing
    fireEvent.pointerMove(window, { clientX: 0 });
    expect(wrap(container).style.width).toBe("380px");
    expect(onWidth).toHaveBeenCalledTimes(1);
  });

  it("clamps a stored width too", () => {
    const { container, rerender } = render(<Panel {...props({ width: 5000 })} />);
    expect(wrap(container).style.width).toBe("716px");
    rerender(<Panel {...props({ width: 100 })} />);
    expect(wrap(container).style.width).toBe("320px");
  });

  it("ends a drag on pointercancel, and not after unmount", () => {
    const onWidth = vi.fn();
    const { unmount } = render(<Panel {...props({ onWidth })} />);
    fireEvent.pointerDown(screen.getByRole("separator", { name: "Resize details" }), { clientX: 640 });
    fireEvent.pointerMove(window, { clientX: 500 });
    fireEvent.pointerCancel(window);
    expect(onWidth).toHaveBeenCalledWith(524);
    onWidth.mockClear();
    fireEvent.pointerDown(screen.getByRole("separator", { name: "Resize details" }), { clientX: 640 });
    unmount();
    fireEvent.pointerMove(window, { clientX: 500 });
    fireEvent.pointerUp(window);
    expect(onWidth).not.toHaveBeenCalled();
  });

  it("names a gone link by its ends", () => {
    const { container } = render(
      <Panel {...props({ selection: { kind: "link", id: "shop/api>shop/db" }, drawn: new Set() })} />,
    );
    expect(container.textContent).toContain("api → db is no longer on the map");
  });

  it("collapses", () => {
    const { container } = render(<Panel {...props()} />);
    expect(container.textContent).toContain("Details");
    fireEvent.click(screen.getByRole("button", { name: "collapse details" }));
    expect(wrap(container).style.width).toBe("12px");
    expect(container.textContent).not.toContain("Details");
    expect(screen.queryByRole("separator")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "expand details" }));
    expect(wrap(container).style.width).toBe("380px");
  });

  it("shows the overview with no selection", () => {
    const { container } = render(<Panel {...props()} />);
    expect(container.textContent).toContain("2workloads");
    expect(container.textContent).toContain("Source: dev, 3-min window, Data: Hubble + Prometheus");
  });

  it("shows a selection on the map with its history", () => {
    const { container } = render(<Panel {...props({ selection: { kind: "workload", id: "shop/api" } })} />);
    expect(container.textContent).toContain("Deployment");
    expect(container.textContent).toContain("api");
    expect(container.textContent).toContain("collecting…");
  });

  it("says when the selection is gone", () => {
    const { container } = render(
      <Panel {...props({ selection: { kind: "workload", id: "shop/api" }, drawn: new Set() })} />,
    );
    expect(container.textContent).toContain("api is no longer on the map");
    expect(container.textContent).not.toContain("collecting…");
  });
});
