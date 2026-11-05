// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Toolbar, type ToolbarProps } from "./toolbar";

const props = (over: Partial<ToolbarProps> = {}): ToolbarProps => ({
  crumbs: [{ label: "All clusters", onClick: vi.fn() }, { label: "dev", onClick: vi.fn() }, { label: "shop" }],
  layer: "health",
  onLayer: vi.fn(),
  hops: 1,
  onHops: vi.fn(),
  quick: { problems: false, exposed: false, egress: true, dbs: false, drops: false, changes: false },
  onQuick: vi.fn(),
  onReset: vi.fn(),
  search: "",
  onSearch: vi.fn(),
  onSearchEnter: vi.fn(),
  menus: { layout: <i>Layout menu</i>, data: <i>Data menu</i>, filters: <i>Filters menu</i> },
  onSettings: vi.fn(),
  ...over,
});

describe("Toolbar", () => {
  it("renders both rows in spec order", () => {
    render(<Toolbar {...props()} />);
    const names = [...document.querySelectorAll("button, input, i, nav a, nav b")].map(
      (e) => e.textContent || e.getAttribute("aria-label"),
    );
    expect(names).toEqual([
      "All clusters",
      "dev",
      "shop",
      "CPU",
      "RAM",
      "Pod health",
      "Traffic",
      "Policy",
      "n+1",
      "n+2",
      "All links",
      "Layout menu",
      "Data menu",
      "Settings",
      "Find workload or namespace",
      "Problems",
      "Exposed",
      "Egress",
      "Databases",
      "Drops",
      "Changes",
      "Filters menu",
      "Reset",
    ]);
  });

  it("toggles a quick view", () => {
    const p = props();
    render(<Toolbar {...p} />);
    expect(screen.getByRole("button", { name: "Egress" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Problems" }).title).toMatch(/unhealthy workloads/);
    fireEvent.click(screen.getByRole("button", { name: "Problems" }));
    expect(p.onQuick).toHaveBeenCalledWith("problems");
  });

  it("the breadcrumb navigates", () => {
    const p = props();
    render(<Toolbar {...p} />);
    fireEvent.click(screen.getByRole("button", { name: "All clusters" }));
    fireEvent.click(screen.getByRole("button", { name: "dev" }));
    expect(p.crumbs[0].onClick).toHaveBeenCalledOnce();
    expect(p.crumbs[1].onClick).toHaveBeenCalledOnce();
    expect(screen.getByText("shop").tagName).toBe("B");
  });

  it("clickable crumbs are buttons a keyboard reaches", () => {
    render(<Toolbar {...props()} />);
    expect(screen.getByRole("button", { name: "All clusters" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "dev" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "shop" })).toBeNull();
  });

  it("shows n+1/n+2/all in a namespace view only", () => {
    const { unmount } = render(<Toolbar {...props()} />);
    expect(screen.getByRole("button", { name: "n+2" })).toBeTruthy();
    unmount();
    render(<Toolbar {...props({ hops: undefined })} />);
    expect(screen.queryByRole("button", { name: "n+2" })).toBeNull();
    expect(screen.queryByText("Show")).toBeNull();
  });
});
