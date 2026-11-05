// @vitest-environment jsdom
import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_RECORD } from "../../common/store/map-store";
import { FiltersMenu } from "./filters-menu";

import type { Snapshot } from "../../common/graph/types";

const edge = (app: string) => ({ app });
const snap = {
  namespaces: ["default", "kube-system"],
  edges: [edge("DNS"), edge("DNS"), edge("HTTP"), edge("DNS"), edge("HTTP"), edge("Redis")],
} as unknown as Snapshot;
const filters = DEFAULT_RECORD.filters;

const setup = (f = filters) => {
  const onChange = vi.fn();
  const r = render(<FiltersMenu s={snap} filters={f} onChange={onChange} />);
  return { onChange, ...r };
};

describe("FiltersMenu", () => {
  it("hide DNS removes DNS from apps", () => {
    const { onChange, getByText } = setup();
    fireEvent.click(getByText("hide DNS"));
    expect(onChange).toHaveBeenCalledWith({ ...filters, apps: ["DNS"] });
  });

  it("hide DNS toggles DNS within the hidden apps", () => {
    const { onChange, getByText, rerender } = setup({ ...filters, apps: ["Redis"] });
    fireEvent.click(getByText("hide DNS"));
    expect(onChange).toHaveBeenLastCalledWith({ ...filters, apps: ["Redis", "DNS"] });
    rerender(<FiltersMenu s={snap} filters={{ ...filters, apps: ["Redis", "DNS"] }} onChange={onChange} />);
    fireEvent.click(getByText("show DNS"));
    expect(onChange).toHaveBeenLastCalledWith({ ...filters, apps: ["Redis"] });
  });

  it("all, none and DNS are buttons", () => {
    const { getByText } = setup();
    for (const t of ["hide DNS"]) expect(getByText(t).tagName).toBe("BUTTON");
  });

  it("labels follow an external change", () => {
    const { getByLabelText, rerender, onChange } = setup({ ...filters, labels: [["app", null]] });
    expect((getByLabelText("Labels") as HTMLTextAreaElement).value).toBe("app");
    rerender(<FiltersMenu s={snap} filters={{ ...filters, labels: [] }} onChange={onChange} />);
    expect((getByLabelText("Labels") as HTMLTextAreaElement).value).toBe("");
  });

  it("labels parse key and key=value", () => {
    const { onChange, getByLabelText } = setup();
    fireEvent.change(getByLabelText("Labels"), { target: { value: "app\n\ntier=web\n" } });
    expect(onChange).toHaveBeenCalledWith({
      ...filters,
      labels: [
        ["app", null],
        ["tier", "web"],
      ],
    });
  });

  it("lists namespaces of the snapshot", () => {
    const { getByLabelText, onChange } = setup();
    expect((getByLabelText("default") as HTMLInputElement).checked).toBe(true);
    expect(getByLabelText("kube-system")).toBeTruthy();
    fireEvent.click(getByLabelText("kube-system"));
    expect(onChange).toHaveBeenCalledWith({ ...filters, hiddenNs: ["kube-system"] });
  });

  it("lists protocols most common first, plus HTTP route", () => {
    const { container } = setup();
    const labels = [...container.querySelectorAll("fieldset[aria-label='Protocols'] label")].map((l) =>
      l.textContent?.trim(),
    );
    expect(labels).toEqual(["DNS 3", "HTTP 2", "Redis 1", "HTTP route"]);
  });

  it("direction, min traffic and infra write their own fields", () => {
    const { onChange, getByLabelText } = setup();
    fireEvent.click(getByLabelText("Outbound only"));
    expect(onChange).toHaveBeenLastCalledWith({ ...filters, direction: "outbound" });
    fireEvent.change(getByLabelText("Min flows/s"), { target: { value: "0.5" } });
    expect(onChange).toHaveBeenLastCalledWith({ ...filters, minRate: 0.5 });
    fireEvent.click(getByLabelText("Show node / API-server traffic"));
    expect(onChange).toHaveBeenLastCalledWith({ ...filters, infra: true });
  });
});
