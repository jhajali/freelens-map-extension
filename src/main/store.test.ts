import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MapStore } from "./store";

import type { FlowsResult } from "../common/graph/flows";

const H = 3600_000;
const T0 = 1_800_000_000_000;

const flows = (): FlowsResult => ({
  windowSec: 300,
  capturedAt: "2027-01-01T00:00:00Z",
  edges: [{ samples: [{}] }] as unknown as FlowsResult["edges"],
});

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "map-store-"));
});
afterEach(() => rm(dir, { recursive: true, force: true }));

const snapDir = (id = "c1") => join(dir, id, "snapshots");
const put = async (at: number, body = JSON.stringify(flows()), id = "c1") => {
  await mkdir(snapDir(id), { recursive: true });
  await writeFile(join(snapDir(id), `${at}.json`), body);
};

describe("MapStore", () => {
  it("stores rates without samples and prunes after 24 h", async () => {
    let now = T0;
    const store = new MapStore(dir, () => now);
    await store.saveSnapshot("c1", flows());
    now = T0 + 25 * H;
    await store.saveSnapshot("c1", flows());
    expect(await readdir(snapDir())).toEqual([`${now}.json`]);
    const saved = await store.baseline("c1");
    expect(saved?.edges.every((e) => e.samples.length === 0)).toBe(true);
  });

  it("picks the snapshot closest to 24 h ago, else the oldest", async () => {
    const now = T0;
    const mark = (n: number) => ({ ...flows(), windowSec: n });
    await put(now - 23 * H, JSON.stringify(mark(23)));
    await put(now - 2 * H, JSON.stringify(mark(2)));
    expect((await new MapStore(dir, () => now).baseline("c1"))?.windowSec).toBe(23);
    await rm(join(snapDir(), `${now - 23 * H}.json`));
    expect((await new MapStore(dir, () => now).baseline("c1"))?.windowSec).toBe(2);
    expect(await new MapStore(dir, () => now).baseline("none")).toBeNull();
  });

  it("skips a corrupt file and one dated in the future", async () => {
    const now = T0;
    await put(now - 24 * H, '{"edg');
    await put(now + H, JSON.stringify({ ...flows(), windowSec: 1 }));
    await put(now - 3 * H, JSON.stringify({ ...flows(), windowSec: 3 }));
    expect((await new MapStore(dir, () => now).baseline("c1"))?.windowSec).toBe(3);
  });

  it("merges CIDRs across clusters", async () => {
    await new MapStore(dir).putCidrs("a", ["10.0.1.0/24"]);
    const all = await new MapStore(dir).putCidrs("b", ["10.0.2.0/24"]);
    expect(all).toEqual({ a: ["10.0.1.0/24"], b: ["10.0.2.0/24"] });
    expect(await new MapStore(dir).putCidrs("a", ["10.0.9.0/24"])).toEqual({
      a: ["10.0.9.0/24"],
      b: ["10.0.2.0/24"],
    });
  });

  it("keeps both clusters when putCidrs runs concurrently", async () => {
    const store = new MapStore(dir);
    await Promise.all([store.putCidrs("a", ["10.0.1.0/24"]), store.putCidrs("b", ["10.0.2.0/24"])]);
    expect(await new MapStore(dir).putCidrs("c", [])).toEqual({
      a: ["10.0.1.0/24"],
      b: ["10.0.2.0/24"],
      c: [],
    });
  });

  it("rejects a cluster id that is not a plain name", async () => {
    const store = new MapStore(dir);
    await expect(store.saveSnapshot("../x", flows())).rejects.toThrow();
    await expect(store.baseline("a/b")).rejects.toThrow();
  });
});
