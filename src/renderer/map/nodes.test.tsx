// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { ReactFlowProvider } from "@xyflow/react";
import { describe, expect, it } from "vitest";
import { DEFAULT_THRESHOLDS, type Snapshot, type Workload } from "../../common/graph/types";
import { MapContext, NamespaceNode } from "./nodes";

const w = {
  id: "a/x",
  ns: "a",
  name: "x",
  kind: "Deployment",
  desired: 1,
  ready: 1,
  restarts: 0,
  cpu: 0.25,
  mem: 1048576,
} as Workload;

describe("NamespaceNode", () => {
  it("scores the Traffic layer by the namespace card's own rate", () => {
    const ctx = {
      s: { workloads: [w] } as Snapshot,
      byId: new Map([[w.id, w]]),
      thresholds: DEFAULT_THRESHOLDS,
      layer: "traffic" as const,
      protectedNs: () => false,
      rates: new Map([["ns:a", 3]]),
      prometheus: false,
      sampled: { cpu: new Set<string>(), mem: new Set<string>() },
    };
    render(
      <ReactFlowProvider>
        <MapContext.Provider value={ctx}>
          <NamespaceNode {...({ id: "ns:a", data: { h: 80 } } as never)} />
        </MapContext.Provider>
      </ReactFlowProvider>,
    );
    expect(screen.getByRole("img", { name: "trouble" })).toBeTruthy();
  });

  const renderCard = (prometheus: boolean) =>
    render(
      <ReactFlowProvider>
        <MapContext.Provider
          value={{
            s: { workloads: [w, { ...w, id: "a/y", cpu: 0.25 }] } as Snapshot,
            byId: new Map([[w.id, w]]),
            thresholds: DEFAULT_THRESHOLDS,
            layer: "health" as const,
            protectedNs: () => false,
            rates: new Map(),
            prometheus,
            sampled: { cpu: new Set<string>(), mem: new Set<string>() },
          }}
        >
          <NamespaceNode {...({ id: "ns:a", data: { h: 80 } } as never)} />
        </MapContext.Provider>
      </ReactFlowProvider>,
    );

  it("shows CPU and RAM totals of its workloads with Prometheus, none without", () => {
    const { unmount } = renderCard(true);
    expect(screen.getByText(/CPU 500m · RAM/)).toBeTruthy();
    unmount();
    renderCard(false);
    expect(screen.queryByText(/CPU .* · RAM/)).toBeNull();
  });
});
