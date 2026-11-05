import { describe, expect, it } from "vitest";
import { type ClusterRecord, DEFAULT_RECORD, ServiceMapStore, toFilters } from "./map-store";

const make = (clusters: Record<string, unknown> = {}, defaultPalette?: "default" | "cb") => {
  const s = new ServiceMapStore();
  s.fromStore({ clusters: clusters as Record<string, ClusterRecord>, defaultPalette });
  return s;
};

describe("ServiceMapStore", () => {
  it("fills defaults for a cluster with no record", () => {
    expect(make().record("c1")).toEqual(DEFAULT_RECORD);
  });

  it("keeps clusters apart", () => {
    const s = make();
    s.update("a", { hops: 2 });
    expect(s.record("a").hops).toBe(2);
    expect(s.record("b").hops).toBe(1);
  });

  it("merges a partial or older record over the defaults", () => {
    const s = make({
      c1: { layer: "cpu", settings: { anonymize: true, thresholds: { cpu: 50 } }, filters: { infra: true } },
    });
    const r = s.record("c1");
    expect(r.layer).toBe("cpu");
    expect(r.layout).toEqual(DEFAULT_RECORD.layout);
    expect(r.settings.palette).toBe("default");
    expect(r.settings.anonymize).toBe(true);
    expect(r.settings.thresholds).toEqual({ cpu: 50, ram: 85, restarts: 1 });
    expect(r.filters.infra).toBe(true);
    expect(r.filters.direction).toBe("all");
  });

  it("ignores a corrupt record", () => {
    expect(make({ c1: "x" }).record("c1")).toEqual(DEFAULT_RECORD);
  });

  it("uses defaultPalette when the cluster has no stored palette", () => {
    const s = make({ c1: { settings: { palette: "default" } } }, "cb");
    expect(s.record("c2").settings.palette).toBe("cb");
    expect(s.record("c1").settings.palette).toBe("default");
    expect(make({}).record("c").settings.palette).toBe("default");
  });

  it("coerces invalid stored fields to defaults", () => {
    const r = make({
      c1: {
        layer: "bogus",
        hops: 9,
        filters: { hiddenNs: 5, apps: "ab", direction: "up", minRate: NaN },
        layout: { space: "x", dir: "UP" },
        settings: { palette: "x", lbPublic: [], namedNetworks: "n" },
        positions: [],
      },
    }).record("c1");
    expect(r.layer).toBe("health");
    expect(r.hops).toBe(1);
    expect(r.filters).toEqual(DEFAULT_RECORD.filters);
    expect(r.layout).toEqual(DEFAULT_RECORD.layout);
    expect(r.settings).toEqual(DEFAULT_RECORD.settings);
    expect(r.positions).toEqual({});
    expect(() => toFilters(r.filters)).not.toThrow();
  });

  it("does not share defaults between clusters", () => {
    const s = make();
    s.record("a").positions.x = {};
    s.record("a").filters.hiddenNs.push("n");
    expect(s.record("b").positions).toEqual({});
    expect(s.record("b").filters.hiddenNs).toEqual([]);
    expect(DEFAULT_RECORD.positions).toEqual({});
  });

  it("ignores a non-object clusters value", () => {
    expect(make([] as never).clusters).toEqual({});
    expect(make("x" as never).clusters).toEqual({});
  });

  it("round-trips through toJSON", () => {
    const s = make();
    s.update("a", { layer: "ram" });
    expect(make(s.toJSON().clusters).record("a").layer).toBe("ram");
  });
});

describe("toFilters", () => {
  it("turns arrays into sets", () => {
    const f = toFilters({ ...DEFAULT_RECORD.filters, hiddenNs: ["a"], apps: ["x"], kinds: ["Deployment"] });
    expect(f.hiddenNs).toEqual(new Set(["a"]));
    expect(f.apps).toEqual(new Set(["x"]));
    expect(f.kinds).toEqual(new Set(["Deployment"]));
  });
});
