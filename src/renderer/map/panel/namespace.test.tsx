// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { loadFixture } from "../../../../test/fixture";
import { flowsToEdges, toSnapshot } from "../../../common/graph/flows";
import { RateHistory } from "../../../common/graph/history";
import { buildInventory } from "../../../common/graph/inventory";
import { protectedNamespaces } from "../../../common/graph/layers";
import { NO_FILTERS } from "../../../common/graph/types";
import { aggregate } from "../../../common/graph/view";
import { NamespaceDetails, OutsideDetails } from "./namespace";

const fx = loadFixture("capture-b");
const inv = buildInventory(fx.objects, fx.metrics);
const s = toSnapshot(
  inv,
  flowsToEdges(fx.flows, inv, {
    self: fx.cluster.self,
    clusterCidrs: fx.cluster.clusterCidrs,
    namedNetworks: [],
    clusterIps: inv.clusterIps,
  }),
  fx.cluster.self,
  fx.cluster.clusterCidrs,
);
const rates = s.edges.map((x) => x.flowsPerSec);
const edges = aggregate(s, null, rates, NO_FILTERS);
const ns = s.workloads.find((w) => w.release && w.chart)!.ns;
// capture-b's public flows carry no resolved names; name one real sample's IP the way Hubble's DNS parser would
const real = edges.find((e) => e.target === "world" && e.samples.length)!;
const dnsSample = { ...real.samples[0]!, dns: "api.example.test" };
const worldEdge = { ...real, samples: [dnsSample, ...real.samples.slice(1)] };
const withWorld = [worldEdge, ...edges.filter((e) => e.id !== real.id)];

const nsProps = (over = {}) => ({
  ns,
  s,
  edges,
  history: new RateHistory(),
  protectedNs: protectedNamespaces(s.policies),
  prometheus: true,
  onSelect: vi.fn(),
  onOpen: vi.fn(),
  ...over,
});

describe("NamespaceDetails", () => {
  it("lists the namespace's Helm releases with their charts", () => {
    render(<NamespaceDetails {...nsProps()} />);
    const sec = screen.getByText("Helm releases").closest("details")!;
    const w = s.workloads.find((x) => x.ns === ns && x.release && x.chart)!;
    expect(sec.textContent).toContain(w.release!);
    expect(sec.textContent).toContain(w.chart!);
  });

  it("shows CPU and RAM tiles only with Prometheus", () => {
    const { rerender } = render(<NamespaceDetails {...nsProps()} />);
    expect(screen.queryByText("CPU")).not.toBeNull();
    rerender(<NamespaceDetails {...nsProps({ prometheus: false })} />);
    expect(screen.queryByText("CPU")).toBeNull();
  });

  it("Open drills in; a link row selects the link", () => {
    const link = edges.find((e) => e.source === `ns:${ns}` || e.target === `ns:${ns}`)!;
    const p = nsProps({ edges: [link] });
    render(<NamespaceDetails {...p} />);
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    expect(p.onOpen).toHaveBeenCalled();
    fireEvent.click(document.querySelector("[data-peer] button")!);
    expect(p.onSelect).toHaveBeenCalledWith(link.id);
  });
});

describe("OutsideDetails", () => {
  it("world lists public IPs with their reverse-DNS names from samples", () => {
    render(<OutsideDetails id="world" s={s} edges={withWorld} onSelect={vi.fn()} />);
    const sec = screen.getByText("Endpoints").closest("details")!;
    expect(sec.textContent).toContain(dnsSample.dstIp);
    expect(sec.textContent).toContain(dnsSample.dns!);
  });

  it("lan lists the internal load balancers as entry points", () => {
    expect(s.loadBalancers.some((l) => l.exposure === "internal")).toBe(true);
    render(<OutsideDetails id="lan" s={s} edges={edges} onSelect={vi.fn()} />);
    expect(screen.getByText("Entry points")).not.toBeNull();
  });
});
