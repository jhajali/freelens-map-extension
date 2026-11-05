import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { FlowsResult } from "../common/graph/flows";

const DAY = 24 * 3600_000;
const ID = /^[A-Za-z0-9._-]+$/;

/** Snapshots of the map's links per cluster, and the node subnets of clusters the user has opened. */
export class MapStore {
  private seq = 0;
  private chain: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly dir: string,
    private readonly now: () => number = Date.now,
  ) {}

  private snapDir(clusterId: string): string {
    // "." and ".." match the pattern but are not plain names
    if (!ID.test(clusterId) || clusterId.startsWith(".")) throw new Error(`invalid cluster id: ${clusterId}`);
    return join(this.dir, clusterId, "snapshots");
  }

  private async write(path: string, data: unknown): Promise<void> {
    const tmp = `${path}.${process.pid}.${this.seq++}.tmp`;
    await writeFile(tmp, JSON.stringify(data));
    await rename(tmp, path);
  }

  private async files(dir: string): Promise<{ at: number; name: string }[]> {
    const names = await readdir(dir).catch(() => []);
    return names.flatMap((name) => (/^\d+\.json$/.test(name) ? [{ at: Number.parseInt(name, 10), name }] : []));
  }

  async saveSnapshot(clusterId: string, flows: FlowsResult): Promise<void> {
    const dir = this.snapDir(clusterId);
    const now = this.now();
    await mkdir(dir, { recursive: true });
    const edges = flows.edges.map((e) => ({ ...e, samples: [] }));
    await this.write(join(dir, `${now}.json`), { ...flows, edges });
    for (const f of await this.files(dir)) {
      if (f.at < now - DAY) await rm(join(dir, f.name), { force: true }).catch(() => undefined);
    }
  }

  async baseline(clusterId: string): Promise<FlowsResult | null> {
    const dir = this.snapDir(clusterId);
    const now = this.now();
    const target = now - DAY;
    const files = (await this.files(dir))
      .filter((f) => f.at <= now)
      .sort((a, b) => Math.abs(a.at - target) - Math.abs(b.at - target));
    for (const f of files) {
      try {
        const data = JSON.parse(await readFile(join(dir, f.name), "utf8")) as FlowsResult;
        if (Array.isArray(data?.edges)) return data;
      } catch {
        // unreadable file: try the next closest
      }
    }
    return null;
  }

  putCidrs(cluster: string, cidrs: string[]): Promise<Record<string, string[]>> {
    // serialised: read-modify-write of one shared file; a failure must not break the chain
    const run = this.chain.then(() => this.mergeCidrs(cluster, cidrs));
    this.chain = run.catch(() => undefined);
    return run;
  }

  private async mergeCidrs(cluster: string, cidrs: string[]): Promise<Record<string, string[]>> {
    const path = join(this.dir, "cidrs.json");
    let all: Record<string, string[]> = {};
    try {
      const data = JSON.parse(await readFile(path, "utf8"));
      if (data && typeof data === "object" && !Array.isArray(data)) all = data;
    } catch {
      // missing or corrupt reads as empty
    }
    all[cluster] = cidrs;
    await mkdir(this.dir, { recursive: true });
    await this.write(path, all);
    return all;
  }
}
