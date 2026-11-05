import { describe, expect, it } from "vitest";
import { nameOf } from "./nodes";

import type { Snapshot, Workload } from "../../common/graph/types";

describe("nameOf", () => {
  const s = { cluster: "dev", loadBalancers: [] } as unknown as Snapshot;
  const w = { id: "w1", name: "shop-mongodb-mongodb", release: "shop-mongodb" } as Workload;
  const byId = new Map([["w1", w]]);

  it("names what each node shows", () => {
    expect(nameOf("w1", s, byId)).toBe("mongodb");
    expect(nameOf("ns:shop", s, byId)).toBe("shop");
    expect(nameOf("cluster:dev", s, byId)).toBe("dev");
    expect(nameOf("gateway:gw", s, byId)).toBe("Gateway");
    expect(nameOf("internet", s, byId)).toBe("Internet (inbound)");
  });
});
