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
import { LinkDetails, type LinkDetailsProps } from "./link";

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
const all = (view: string | null) => aggregate(s, view, rates, NO_FILTERS);
const broken = s.routes.find((r) => r.target === null && r.host)!;
const brokenEdge = s.namespaces.flatMap(all).find((e) => e.routes.includes(broken))!;
const dnsEdge = s.namespaces.flatMap(all).find((e) => !e.synthetic && e.samples.some((x) => x.dns))!;

const props = (e = dnsEdge, over: Partial<LinkDetailsProps> = {}): LinkDetailsProps => ({
  e,
  s,
  history: new RateHistory(),
  protectedNs: protectedNamespaces(s.policies),
  l7: false,
  onSelect: vi.fn(),
  ...over,
});

describe("LinkDetails", () => {
  it("a gateway route link lists host, path and the broken backend flag", () => {
    render(<LinkDetails {...props(brokenEdge)} />);
    expect(screen.getAllByText(broken.host!).length).toBeGreaterThan(0);
    expect(screen.getAllByText(broken.path || "/").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/no ready pods/).length).toBeGreaterThan(0);
  });

  it("a link with samples lists them with their Service DNS name", () => {
    const sample = dnsEdge.samples.find((x) => x.dns)!;
    render(<LinkDetails {...props()} />);
    expect(screen.getAllByText(sample.dns!).length).toBeGreaterThan(0);
  });

  it("without L7 the latency section shows the enable hint; with it, not", () => {
    const { rerender } = render(<LinkDetails {...props()} />);
    expect(screen.getByText(/needs L7 visibility: enable it in Cilium/)).not.toBeNull();
    rerender(<LinkDetails {...props(dnsEdge, { l7: true })} />);
    expect(screen.queryByText(/needs L7 visibility/)).toBeNull();
    expect(screen.getByText(/carry no HTTP codes or latency/)).not.toBeNull();
  });

  it("caps the route and load balancer tables at 200 rows with a show-all button", () => {
    const route = broken;
    const lb = s.loadBalancers[0]!;
    const e = {
      ...brokenEdge,
      routes: Array.from({ length: 201 }, (_, i) => ({ ...route, path: `/p${i}` })),
      lbs: Array.from({ length: 201 }, (_, i) => ({ ...lb, name: `lb${i}` })),
    };
    render(<LinkDetails {...props(e)} />);
    const rows = (title: string) => screen.getByText(title).closest("details")!.querySelectorAll("tbody tr").length;
    expect(rows("HTTPRoutes")).toBe(200);
    expect(rows("Load balancer")).toBe(200);
    expect(screen.getAllByRole("button", { name: /Show all 201/ })).toHaveLength(2);
  });

  it("an LB exposure is a pill; routes of one host and path to two backends get distinct keys", () => {
    const lb = s.loadBalancers[0]!;
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const e = {
      ...brokenEdge,
      lbs: [lb],
      routes: [broken, { ...broken, service: `${broken.service}-2` }],
    };
    const { container } = render(<LinkDetails {...props(e)} />);
    expect(err).not.toHaveBeenCalled();
    err.mockRestore();
    const pill = [...container.querySelectorAll("span")].find((x) => x.textContent === lb.exposure);
    expect(pill?.className).toContain("pill");
  });

  it("the header endpoints are buttons that select the endpoint", () => {
    const onSelect = vi.fn();
    render(<LinkDetails {...props(dnsEdge, { onSelect })} />);
    const [src, dst] = screen.getAllByTestId("link-end");
    fireEvent.click(src!);
    fireEvent.click(dst!);
    expect(onSelect).toHaveBeenNthCalledWith(1, dnsEdge.source);
    expect(onSelect).toHaveBeenNthCalledWith(2, dnsEdge.target);
  });
});
