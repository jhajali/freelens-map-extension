import { BASELINE, type Baseline, CIDRS, SUBSCRIBE, type SubscribeRequest, UNSUBSCRIBE } from "../common/ipc";

import type { Collectors } from "./collector";
import type { MapStore } from "./store";

interface IpcLike {
  handle(channel: string, fn: (event: unknown, ...args: any[]) => unknown): void;
}

/** Serves the renderer's subscriptions, baselines and CIDR cache; returns a disposer for the snapshot timer. */
export function registerHandlers(
  ipc: IpcLike,
  collectors: Collectors,
  store: Promise<MapStore>,
  opts: { snapshotMs?: number } = {},
): () => void {
  ipc.handle(SUBSCRIBE, (_e, req: SubscribeRequest) => collectors.subscribe(req));
  ipc.handle(UNSUBSCRIBE, (_e, clusterId: string, subscriber: string) => collectors.unsubscribe(clusterId, subscriber));
  ipc.handle(BASELINE, async (_e, clusterId: string): Promise<Baseline | null> => {
    const saved = await (await store).baseline(clusterId);
    if (saved) return { flows: saved, source: "snapshot" };
    const first = collectors.first(clusterId);
    return first ? { flows: first, source: "since-opened" } : null;
  });
  ipc.handle(CIDRS, async (_e, cluster: string, cidrs: string[]) => (await store).putCidrs(cluster, cidrs));

  const timer = setInterval(async () => {
    for (const id of collectors.running()) {
      const flows = collectors.current(id);
      // an empty or stale result would replace a useful baseline
      if (!flows?.edges.length || !collectors.status(id)?.ok) continue;
      try {
        await (await store).saveSnapshot(id, flows);
      } catch (error) {
        console.error(`[service-map] snapshot for ${id} failed: ${String(error)}`);
      }
    }
  }, opts.snapshotMs ?? 300_000);
  return () => clearInterval(timer);
}
