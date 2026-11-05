/** IPC channels between the renderer page and the main-process data collector. */
import type { IpContext } from "./graph/classify";
import type { FlowInventory, FlowsResult } from "./graph/flows";

export const SUBSCRIBE = "map:subscribe",
  UNSUBSCRIBE = "map:unsubscribe",
  TICK = "map:tick",
  BASELINE = "map:baseline",
  CIDRS = "map:cidrs";

export type SourceId = "kubernetes" | "prometheus" | "hubble";
export interface SourceStatus {
  id: SourceId;
  ok: boolean;
  detail: string;
  fix: string | null;
}
export interface SubscribeRequest {
  clusterId: string;
  subscriber: string;
  inv: FlowInventory;
  ip: IpContext;
}
export interface Tick {
  clusterId: string;
  flows: FlowsResult | null;
  status: SourceStatus;
  truncated: number;
  l7: boolean;
}
export interface Baseline {
  flows: FlowsResult;
  source: "snapshot" | "since-opened";
}
