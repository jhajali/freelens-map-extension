// @vitest-environment jsdom
import { act, render, screen } from "@testing-library/react";
import { observer } from "mobx-react";
import { describe, expect, it } from "vitest";
import { DEFAULT_RECORD, ServiceMapStore } from "../../common/store/map-store";
import { useViewState, type ViewState } from "./view-state";

describe("useViewState", () => {
  const probe = (store: ServiceMapStore, id = "c") => {
    const seen: { current: ViewState | null } = { current: null };
    const Probe = observer(() => {
      seen.current = useViewState(id, store);
      return <p>hops {seen.current.record.hops}</p>;
    });
    return { seen, ui: <Probe /> };
  };

  it("re-renders an observer when the store changes", () => {
    const store = new ServiceMapStore();
    const { ui } = probe(store);
    render(ui);
    expect(screen.getByText("hops 1")).toBeTruthy();
    act(() => store.update("c", { hops: 0 }));
    expect(screen.getByText("hops 0")).toBeTruthy();
  });

  it("sets and resets; positions and settings stay", () => {
    const store = new ServiceMapStore();
    const { seen, ui } = probe(store);
    render(ui);
    const pos = { "|1": { a: { x: 1, y: 2 } } };
    act(() =>
      seen.current!.set({
        hops: 2,
        layer: "cpu",
        positions: pos,
        filters: { ...DEFAULT_RECORD.filters, infra: true, hiddenNs: ["x"] },
      }),
    );
    act(() => store.update("c", { settings: { ...store.record("c").settings, anonymize: true } }));
    expect(seen.current!.record.layer).toBe("cpu");
    act(() => seen.current!.reset());
    const r = seen.current!.record;
    expect(r.filters).toEqual(DEFAULT_RECORD.filters);
    expect([r.hops, r.layer, r.positions, r.settings.anonymize]).toEqual([1, "health", pos, true]);
  });

  it("resetPositions clears one view's positions only", () => {
    const store = new ServiceMapStore();
    const { seen, ui } = probe(store);
    render(ui);
    act(() => seen.current!.set({ positions: { "|1": { a: { x: 1, y: 2 } }, "web|1": { b: { x: 3, y: 4 } } } }));
    act(() => seen.current!.resetPositions("web|1"));
    expect(seen.current!.record.positions).toEqual({ "|1": { a: { x: 1, y: 2 } } });
  });

  it("persists nothing without a cluster", () => {
    const store = new ServiceMapStore();
    const { seen, ui } = probe(store, "");
    render(ui);
    act(() => seen.current!.set({ hops: 2 }));
    act(() => seen.current!.reset());
    expect(store.clusters).toEqual({});
  });
});
