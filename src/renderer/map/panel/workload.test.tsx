// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { RateHistory } from "../../../common/graph/history";
import { DEFAULT_THRESHOLDS } from "../../../common/graph/types";
import { openLogs, openShell } from "../actions";
import { WorkloadDetails, type WorkloadDetailsProps } from "./workload";

import type { MapEdge, Snapshot, Workload } from "../../../common/graph/types";

vi.mock("../actions", () => ({ openInFreelens: vi.fn(), openLogs: vi.fn(), openShell: vi.fn() }));

const pod = { name: "api-1", phase: "Running", restarts: 3, cpu: 0.2, mem: 2 ** 28, cpuLim: null, memLim: null };
const api: Workload = {
  id: "shop/api",
  ns: "shop",
  name: "api",
  kind: "Deployment",
  release: "shop",
  chart: null,
  image: "api:1",
  desired: 1,
  ready: 1,
  db: false,
  labels: { app: "api" },
  pods: [pod],
  restarts: 3,
  cpu: 0.2,
  mem: 2 ** 28,
  cpuLim: null,
  memLim: null,
};
const db: Workload = {
  ...api,
  id: "shop/db",
  name: "db",
  kind: "KubeBlocks",
  chart: "postgresql-1.0",
  db: true,
  restarts: 0,
  pods: [],
};
const edge = (source: string, target: string): MapEdge => ({
  id: `${source}>${target}`,
  source,
  target,
  rate: 2,
  drops: 0,
  base: 2,
  bdrops: 0,
  apps: new Map(),
  routes: [],
  lbs: [],
  samples: [],
  idx: [],
  synthetic: false,
});
const s = {
  cluster: "dev",
  workloads: [api, db],
  routes: [
    {
      ns: "shop",
      name: "r",
      kind: "HTTPRoute",
      gateway: null,
      host: "a.example",
      path: "/x",
      service: "api",
      port: 80,
      target: "shop/api",
    },
  ],
  loadBalancers: [],
  policies: [],
  namespaces: ["shop"],
} as unknown as Snapshot;
const props = (over: Partial<WorkloadDetailsProps> = {}): WorkloadDetailsProps => ({
  w: api,
  s,
  edges: [edge("shop/db", "shop/api"), edge("shop/api", "shop/db")],
  history: new RateHistory(),
  thresholds: DEFAULT_THRESHOLDS,
  prometheus: true,
  onSelect: vi.fn(),
  ...over,
});

describe("WorkloadDetails", () => {
  it("a restarting workload shows the Problem pill and its restart tile", () => {
    render(<WorkloadDetails {...props()} />);
    expect(screen.getByText("Problem")).not.toBeNull();
    expect(screen.getByText("restarts").previousElementSibling?.textContent).toBe("3");
    expect(screen.getByText("1/1")).not.toBeNull();
  });

  it("lists peers of both directions; a click selects the link", () => {
    const onSelect = vi.fn();
    render(<WorkloadDetails {...props({ onSelect })} />);
    fireEvent.click(screen.getByText("db", { selector: "[data-peer='shop/db>shop/api'] *" }));
    expect(onSelect).toHaveBeenCalledWith("shop/db>shop/api");
    expect(document.querySelector("[data-peer='shop/api>shop/db']")).not.toBeNull();
  });

  it("without limits the bars say no limit; without Prometheus they ask for it", () => {
    const { rerender } = render(<WorkloadDetails {...props()} />);
    expect(screen.getAllByText(/\(no limit\)/)).toHaveLength(2);
    rerender(<WorkloadDetails {...props({ prometheus: false })} />);
    expect(screen.getByText("CPU/RAM need Prometheus")).not.toBeNull();
  });

  it("shows the chart of a KubeBlocks workload, routes, policy warning and actions", () => {
    const { rerender } = render(<WorkloadDetails {...props({ w: db })} />);
    expect(screen.getByText(/postgresql-1\.0/)).not.toBeNull();
    expect(screen.getByText("DB")).not.toBeNull();
    rerender(<WorkloadDetails {...props()} />);
    expect(screen.getByText("a.example")).not.toBeNull();
    expect(screen.getByText(/No NetworkPolicy/)).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Logs/ }));
    fireEvent.click(screen.getByRole("button", { name: /Shell/ }));
    expect(openLogs).toHaveBeenCalledWith(api);
    expect(openShell).toHaveBeenCalledWith(api);
  });
});
