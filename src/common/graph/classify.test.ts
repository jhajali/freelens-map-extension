import { describe, expect, it } from "vitest";
import {
  appForPort,
  classifyIp,
  familyOf,
  isDatabaseName,
  lbExposure,
  lbProvider,
  nodeCidrs,
  PUBLIC_ENDPOINT_ANNOTATION,
} from "./classify";

describe("appForPort", () => {
  it.each([
    [5432, "PostgreSQL"],
    [27017, "MongoDB"],
    [6379, "Redis"],
    [3306, "MySQL"],
    [9092, "Kafka"],
    [5672, "AMQP"],
    [443, "HTTPS"],
    [80, "HTTP"],
    [8080, "HTTP"],
    [53, "DNS"],
    [4317, "OTLP gRPC"],
    [4318, "OTLP HTTP"],
    [7687, "Bolt"],
    [9200, "Elasticsearch"],
  ])("TCP %i is %s", (port, app) => expect(appForPort("TCP", port)).toBe(app));
  it("falls back to protocol/port", () => expect(appForPort("TCP", 3003)).toBe("TCP/3003"));
  it("names portless protocols", () => expect(appForPort("ICMPv4", null)).toBe("ICMPv4"));
});

describe("familyOf", () => {
  it.each(["HTTP", "HTTPS", "OTLP HTTP", "TCP/8080"])("%s is web", (a) => expect(familyOf(a)).toBe("web"));
  it.each(["PostgreSQL", "Redis", "MongoDB", "Kafka", "AMQP", "Bolt", "TCP/6432"])("%s is data", (a) =>
    expect(familyOf(a)).toBe("data"),
  );
  it.each(["DNS", "TCP/9100", "UDP/51820"])("%s is other", (a) => expect(familyOf(a)).toBe("other"));
});

describe("isDatabaseName", () => {
  it("detects databases by name or image", () => expect(isDatabaseName("shop-postgresql postgres:16")).toBe(true));
  it("excludes UIs of databases", () => expect(isDatabaseName("kafka-ui provectuslabs/kafka-ui")).toBe(false));
});

describe("classifyIp", () => {
  const ctx = {
    self: "dev",
    clusterCidrs: { dev: ["10.20.19.0/24"], mgmt: ["10.20.21.0/24", "10.20.31.0/24"] },
    namedNetworks: [{ cidr: "10.20.22.0/24", name: "SigNoz" }],
    clusterIps: { "10.98.0.10": { ns: "kube-system", name: "kube-dns" } },
  };
  it.each([
    ["10.20.19.100", "@host"],
    ["10.20.21.5", "@cluster:mgmt"],
    ["10.20.31.7", "@cluster:mgmt"],
    ["10.98.0.10", "@kube-system"],
    ["10.20.22.110", "@internal:10.20.22.0/24"],
    ["140.82.121.3", "@internet:140.82.121.3"],
    ["2001:db8::1", "@internet:2001:db8::1"],
    ["fd00::1", "@internal:fd00::/64"],
  ])("%s -> %s", (ip, ep) => expect(classifyIp(ip, ctx)).toBe(ep));
});

describe("nodeCidrs", () => {
  it("keeps one /24 per node subnet", () => {
    const node = (...ips: Array<[string, string]>) => ({
      kind: "Node",
      metadata: { name: "n" },
      status: { addresses: ips.map(([type, address]) => ({ type, address })) },
    });
    expect(
      nodeCidrs([
        node(["InternalIP", "10.1.2.3"], ["Hostname", "a"]),
        node(["InternalIP", "10.1.2.9"], ["ExternalIP", "51.0.0.1"]),
        node(["InternalIP", "10.1.5.1"]),
      ]),
    ).toEqual(["10.1.2.0/24", "10.1.5.0/24"]);
  });
});

describe("load balancers", () => {
  it("names the provider from annotations or hostnames", () => {
    expect(lbProvider({ "service.beta.kubernetes.io/scw-loadbalancer-id": "x" }, [])).toBe("Scaleway LB");
    expect(lbProvider({}, ["a.elb.amazonaws.com"])).toBe("AWS ELB");
    expect(lbProvider({ "lbipam.cilium.io/ips": "10.0.0.1" }, [])).toBe("Cilium LB-IPAM");
    expect(lbProvider({ "metallb.universe.tf/address-pool": "p" }, [])).toBe("MetalLB");
  });
  it("is public when an address is public, a hostname, or a public endpoint is declared", () => {
    expect(lbExposure(["10.20.19.200"], null)).toBe("internal");
    expect(lbExposure(["10.20.17.202"], "203.0.113.2")).toBe("public");
    expect(lbExposure(["lb.example.com"], null)).toBe("public");
    expect(PUBLIC_ENDPOINT_ANNOTATION).toBe("servicemap.freelens.io/public-endpoint");
  });
});
