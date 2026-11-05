// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PAGE_ID, ShowOnMapMenuItem } from "./show-on-map";

const extension = () => ({ navigate: vi.fn() });

describe("ShowOnMapMenuItem", () => {
  it("opens the map at the workload's namespace with the workload selected", () => {
    const ext = extension();
    render(
      <ShowOnMapMenuItem
        extension={ext}
        object={{ kind: "Deployment", metadata: { name: "api", namespace: "shop" } }}
      />,
    );
    fireEvent.click(screen.getByRole("menuitem"));
    expect(PAGE_ID).toBe("service-map");
    expect(ext.navigate).toHaveBeenCalledWith("service-map", { namespace: "shop", select: "shop/api" });
  });

  it("opens the map at a namespace without a selection", () => {
    const ext = extension();
    render(<ShowOnMapMenuItem extension={ext} object={{ kind: "Namespace", metadata: { name: "shop" } }} />);
    fireEvent.click(screen.getByRole("menuitem"));
    expect(ext.navigate).toHaveBeenCalledWith("service-map", { namespace: "shop" });
  });

  it("labels the item 'Show on map'", () => {
    render(<ShowOnMapMenuItem extension={extension()} object={{ kind: "Namespace", metadata: { name: "shop" } }} />);
    expect(screen.getByRole("menuitem").textContent).toBe("Show on map");
  });
});
