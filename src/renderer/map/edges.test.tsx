// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { loadFixture } from "../../../test/fixture";
import { realStrings } from "../../../test/real-names";
import { aliases } from "../../common/graph/anonymize";
import { flowsToEdges, toSnapshot } from "../../common/graph/flows";
import { buildInventory } from "../../common/graph/inventory";
import { protectedNamespaces } from "../../common/graph/layers";
import { DEFAULT_THRESHOLDS, NO_FILTERS } from "../../common/graph/types";
import { pipeline } from "../../common/graph/view";
import { RoutesContext, TrafficEdge } from "./edges";
import { scrub } from "./export";
import { AliasContext, MapContext } from "./nodes";

import type { EdgeProps } from "@xyflow/react";

import type { MapEdge } from "../../common/graph/types";

// React Flow's label portal needs a mounted flow; here it hands its children through
vi.mock("@xyflow/react", async (importOriginal) => {
  const real = await importOriginal<typeof import("@xyflow/react")>();
  return { ...real, EdgeLabelRenderer: ({ children }: { children: unknown }) => <>{children as never}</> };
});

const edge = {
  id: "a>b",
  source: "a",
  target: "b",
  rate: 2,
  drops: 0,
  synthetic: false,
  apps: new Map([["HTTP", 2]]),
  routes: [],
  lbs: [],
};

const draw = (labels: boolean | undefined, over: object = {}, alias = (_: string, r: string) => r) => {
  const ctx = { s: {}, byId: new Map(), layer: "traffic", protectedNs: () => false, labels } as never;
  const props = { id: edge.id, target: "b", data: { ...edge, ...over, n: 0, focus: true } } as unknown as EdgeProps;
  const routes = {
    [edge.id]: [
      { x: 0, y: 0 },
      { x: 50, y: 0 },
    ],
  };
  return render(
    <AliasContext.Provider value={alias}>
      <MapContext.Provider value={ctx}>
        <RoutesContext.Provider value={routes}>
          <svg>
            <TrafficEdge {...props} />
          </svg>
        </RoutesContext.Provider>
      </MapContext.Provider>
    </AliasContext.Provider>,
  );
};

describe("TrafficEdge", () => {
  it("draws its label, and none when link labels are off", () => {
    expect(draw(true).queryByText(/HTTP · 2\.00\/s/)).not.toBeNull();
    expect(draw(false).container.textContent).not.toContain("HTTP");
  });

  it("names the load balancer's IPs through the aliases", () => {
    const lb = { apps: new Map(), synthetic: true, lbs: [{ ips: ["203.0.113.7"] }] };
    expect(draw(true, lb).container.textContent).toContain("LB 203.0.113.7");
    const text = draw(true, lb, (k, r) => (k === "ip" && r === "203.0.113.7" ? "ip-1" : r)).container.textContent;
    expect(text).toContain("LB ip-1");
    expect(text).not.toContain("203.0.113.7");
  });
});

describe("TrafficEdge, anonymized", () => {
  const fx = loadFixture("capture-b");
  const inv = buildInventory(fx.objects, fx.metrics);
  const flows = flowsToEdges(fx.flows, inv, {
    self: fx.cluster.self,
    clusterCidrs: fx.cluster.clusterCidrs,
    namedNetworks: [],
    clusterIps: inv.clusterIps,
  });
  const s = toSnapshot(inv, flows, "dev", fx.cluster.clusterCidrs);
  const { names } = realStrings(s);
  const rates = s.edges.map((e) => e.flowsPerSec);
  // the cluster view and every namespace's, with all links
  const links = [null, ...s.namespaces].flatMap((v) => pipeline(s, v, rates, NO_FILTERS, 0, DEFAULT_THRESHOLDS).edges);

  it("labels no link with a real name, in any layer", () => {
    const ctx = (layer: string) =>
      ({
        s,
        byId: new Map(s.workloads.map((w) => [w.id, w])),
        layer,
        protectedNs: protectedNamespaces(s.policies),
        labels: true,
      }) as never;
    const draw = (e: MapEdge, layer: string) =>
      render(
        <AliasContext.Provider value={aliases(s)}>
          <MapContext.Provider value={ctx(layer)}>
            <RoutesContext.Provider
              value={{
                [e.id]: [
                  { x: 0, y: 0 },
                  { x: 50, y: 0 },
                ],
              }}
            >
              <svg>
                <TrafficEdge
                  {...({ id: e.id, target: e.target, data: { ...e, n: 0, focus: true } } as unknown as EdgeProps)}
                />
              </svg>
            </RoutesContext.Provider>
          </MapContext.Provider>
        </AliasContext.Provider>,
      );
    const out: string[] = [];
    for (const e of links)
      for (const layer of ["traffic", "policy"]) {
        const v = draw(e, layer);
        out.push(v.container.innerHTML);
        v.unmount();
      }
    const all = scrub(out.join("\n"));
    expect(names.filter((n) => all.includes(n))).toEqual([]);
    // the links with load balancers, routes and protocols were among them
    expect(all).toContain("LB ip-");
    expect(links.some((e) => e.routes.length)).toBe(true);
    expect(all).toMatch(/\/s/);
  });
});
