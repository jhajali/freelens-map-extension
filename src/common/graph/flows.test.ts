import { describe, expect, it } from "vitest";
import { loadFixture } from "../../../test/fixture";
import { classifyIp } from "./classify";
import { flowsToEdges } from "./flows";
import { buildInventory } from "./inventory";

const { objects, metrics, flows, cluster } = loadFixture("capture-b");
const inv = buildInventory(objects, metrics);
const ctx = { self: cluster.self, clusterCidrs: cluster.clusterCidrs, namedNetworks: [], clusterIps: inv.clusterIps };
const result = flowsToEdges(flows, inv, ctx);

describe("flowsToEdges on a real (anonymized) capture", () => {
  it("covers the ~6 minute capture window", () => {
    expect(result.windowSec).toBeGreaterThanOrEqual(355);
    expect(result.windowSec).toBeLessThanOrEqual(365);
  });

  it("produces the prototype's 171 links", () => expect(result.edges).toHaveLength(171));

  it("names protocols from ports and finds the other cluster", () => {
    for (const e of result.edges.filter((x) => x.port === 5432)) expect(e.app).toBe("PostgreSQL");
    expect(result.edges.some((e) => e.dst.startsWith("@cluster:") || e.src.startsWith("@cluster:"))).toBe(true);
  });

  it("names Postgres connections by their Service DNS name", () => {
    const pg = result.edges.filter((e) => e.app === "PostgreSQL" && !e.src.startsWith("@"));
    expect(pg.some((e) => e.samples.some((s) => s.dns?.endsWith(".svc.cluster.local")))).toBe(true);
  });

  it("handles IPv6, ICMP and flows without pod names", () => {
    const base = {
      time: "2026-11-05T10:00:00Z",
      verdict: "FORWARDED",
      source: { namespace: "shop", pod_name: "web-1", labels: [] },
    };
    const odd = [
      {
        ...base,
        IP: { source: "10.0.0.1", destination: "2001:db8::1", ipVersion: "IPv6" },
        l4: { TCP: { destination_port: 443 } },
        destination: { labels: ["reserved:world"] },
      },
      {
        ...base,
        IP: { source: "10.0.0.1", destination: "140.82.121.3" },
        l4: { ICMPv4: { type: 8 } },
        destination: { labels: ["reserved:world"] },
      },
      {
        ...base,
        IP: { source: "10.0.0.1", destination: "10.9.9.9" },
        l4: { TCP: { destination_port: 80 } },
        destination: { namespace: "shop", labels: [] },
      },
    ];
    const out = flowsToEdges(odd, inv, ctx).edges;
    expect(out.find((e) => e.dst === "@internet:2001:db8::1")?.app).toBe("HTTPS");
    expect(out.find((e) => e.dst === "@internet:140.82.121.3")?.app).toBe("ICMPv4");
    expect(out.some((e) => e.dst.startsWith("shop/"))).toBe(false);
    expect(out.some((e) => e.dst === classifyIp("10.9.9.9", ctx))).toBe(true);
  });

  it("reads dual-stack world identities and Cilium's ingress as outside traffic, not node traffic", () => {
    const base = { time: "2026-11-05T10:00:00Z", verdict: "FORWARDED", l4: { TCP: { destination_port: 443 } } };
    const odd = [
      {
        ...base,
        IP: { source: "2001:db8::7", destination: "10.0.0.1" },
        source: { labels: ["reserved:world-ipv6"] },
        destination: { namespace: "shop", pod_name: "web-1", labels: [] },
      },
      {
        ...base,
        IP: { source: "140.82.121.3", destination: "10.0.0.1" },
        source: { labels: ["reserved:world-ipv4"] },
        destination: { namespace: "shop", pod_name: "web-1", labels: [] },
      },
      {
        ...base,
        IP: { source: "198.51.100.4", destination: "10.0.0.1" },
        source: { labels: ["reserved:ingress"] },
        destination: { namespace: "shop", pod_name: "web-1", labels: [] },
      },
    ];
    const srcs = flowsToEdges(odd, inv, ctx).edges.map((e) => e.src);
    expect(srcs).toContain("@internet:2001:db8::7");
    expect(srcs).toContain("@internet:140.82.121.3");
    expect(srcs).not.toContain("@host");
  });
});

describe("flowsToEdges weighting", () => {
  it("weights flows by count and uses the given window", () => {
    const syn = {
      verdict: "FORWARDED",
      IP: { source: "10.0.0.1", destination: "10.0.0.2" },
      l4: { TCP: { destination_port: 80, flags: { SYN: true } } },
      source: { namespace: "a", pod_name: "p" },
      destination: { namespace: "b", pod_name: "q" },
    };
    const r = flowsToEdges([syn], inv, ctx, { counts: [10], windowSec: 5 });
    expect(r.windowSec).toBe(5);
    expect(r.edges[0].flowsPerSec).toBe(2);
    expect(r.edges[0].connsPerSec).toBe(2);
    expect(r.edges[0].samples[0].count).toBe(10);
  });
});
