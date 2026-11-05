import { type FlowsResult, flowsToEdges } from "../common/graph/flows";
import { FlowWindow } from "../common/graph/window";

import type { SourceStatus, SubscribeRequest, Tick } from "../common/ipc";
import type { ReverseDns } from "./dns";
import type { openPortForward, PortForward } from "./hubble/port-forward";
import type { streamFlows } from "./hubble/relay-client";

export interface CollectorDeps {
  openPortForward: typeof openPortForward;
  streamFlows: typeof streamFlows;
  dns: ReverseDns;
  broadcast: (tick: Tick) => void;
  now: () => number;
  setInterval: typeof setInterval;
  clearInterval: typeof clearInterval;
  setTimeout: typeof setTimeout;
  clearTimeout: typeof clearTimeout;
}

interface Options {
  tickMs?: number;
  leaseMs?: number;
  retryMs?: number[];
  /** a stream with no flow for this long is restarted */
  idleMs?: number;
}

const status = (ok: boolean, detail: string, fix: string | null = null): SourceStatus => ({
  id: "hubble",
  ok,
  detail,
  fix,
});

/** Maps a port-forward or stream error to what the user sees; `beforeFlow` is a stream error before any flow. */
export function errorStatus(message: string, beforeFlow: boolean, ns = "kube-system"): SourceStatus {
  if (/forbidden[\s\S]*portforward/i.test(message))
    return status(false, "port-forward denied", `needs "create" on "pods/portforward" in ${ns}`);
  // Cilium serves a TLS Relay on 443, a plaintext one on 80
  const port = /does not have a service port (\d+)/.exec(message);
  if (port) return status(false, `Hubble Relay has no port ${port[1]}`, "a TLS Relay (port 443) is not supported yet");
  if (/not ?found/i.test(message))
    return status(false, `Hubble Relay not found in ${ns}`, "enable it: cilium hubble enable --relay");
  if (beforeFlow && /(ECONNRESET|Protocol error|http2|TLS|SSL)/i.test(message))
    return status(false, "TLS enabled, client certs not readable");
  return status(false, message);
}

const target = (req: SubscribeRequest) => {
  const r = req.relay ?? { ns: "kube-system", svc: "hubble-relay", port: 80 };
  return `${r.ns}/${r.svc}:${r.port}`;
};

interface Collector {
  subs: Map<string, number>;
  req: SubscribeRequest;
  window: FlowWindow;
  l7: boolean;
  status: SourceStatus;
  last: FlowsResult | null;
  attempt: number;
  /** nodes Relay reports unavailable on the current stream */
  unavailable: Set<string>;
  lastFlow: number;
  // identity of the live connection attempt; callbacks of an older one are ignored
  conn: object | null;
  pf: PortForward | null;
  cancel: (() => void) | null;
  retry: ReturnType<typeof setTimeout> | null;
  interval: ReturnType<typeof setInterval>;
  stopped: boolean;
}

/** One Hubble Relay port-forward and follow stream per cluster, kept while subscribers hold a lease. */
export class Collectors {
  private readonly byCluster = new Map<string, Collector>();
  private readonly firsts = new Map<string, FlowsResult>();
  private readonly tickMs: number;
  private readonly leaseMs: number;
  private readonly retryMs: number[];
  private readonly idleMs: number;

  constructor(
    private readonly deps: CollectorDeps,
    opts: Options = {},
  ) {
    this.tickMs = opts.tickMs ?? 2500;
    this.leaseMs = opts.leaseMs ?? 180_000;
    this.retryMs = opts.retryMs ?? [2000, 5000, 15000, 30000];
    this.idleMs = opts.idleMs ?? 60_000;
  }

  subscribe(req: SubscribeRequest): SourceStatus {
    let c = this.byCluster.get(req.clusterId);
    if (c && target(req) !== target(c.req)) {
      c.conn = null;
      if (c.retry) this.deps.clearTimeout(c.retry);
      c.retry = null;
      c.attempt = 0;
      this.disconnect(c);
      c.req = req;
      c.status = status(false, "connecting");
      this.connect(c);
    }
    if (!c) {
      c = {
        subs: new Map(),
        req,
        window: new FlowWindow(),
        l7: false,
        status: status(false, "connecting"),
        last: null,
        attempt: 0,
        unavailable: new Set(),
        lastFlow: 0,
        conn: null,
        pf: null,
        cancel: null,
        retry: null,
        interval: this.deps.setInterval(() => this.tick(req.clusterId), this.tickMs),
        stopped: false,
      };
      this.byCluster.set(req.clusterId, c);
      this.connect(c);
    }
    c.req = req;
    c.subs.set(req.subscriber, this.deps.now());
    return c.status;
  }

  unsubscribe(clusterId: string, subscriber: string): void {
    const c = this.byCluster.get(clusterId);
    if (!c) return;
    c.subs.delete(subscriber);
    if (c.subs.size === 0) this.stop(clusterId);
  }

  status(clusterId: string): SourceStatus | null {
    return this.byCluster.get(clusterId)?.status ?? null;
  }

  current(clusterId: string): FlowsResult | null {
    return this.byCluster.get(clusterId)?.last ?? null;
  }

  /** The first result with a link since this instance was created; kept after the collector stops. */
  first(clusterId: string): FlowsResult | null {
    return this.firsts.get(clusterId) ?? null;
  }

  running(): string[] {
    return [...this.byCluster.keys()];
  }

  stopAll(): void {
    for (const id of [...this.byCluster.keys()]) this.stop(id);
  }

  private stop(clusterId: string): void {
    const c = this.byCluster.get(clusterId);
    if (!c) return;
    this.byCluster.delete(clusterId);
    c.stopped = true;
    c.conn = null;
    this.deps.clearInterval(c.interval);
    if (c.retry) this.deps.clearTimeout(c.retry);
    this.disconnect(c);
  }

  private disconnect(c: Collector): void {
    c.cancel?.();
    c.pf?.close();
    c.cancel = null;
    c.pf = null;
  }

  private later(c: Collector, fn: () => void): void {
    c.retry = this.deps.setTimeout(
      () => {
        c.retry = null;
        if (!c.stopped) fn();
      },
      this.retryMs[Math.min(c.attempt, this.retryMs.length - 1)],
    );
    c.attempt++;
  }

  private live(c: Collector): SourceStatus {
    return status(true, c.unavailable.size ? `live · ${c.unavailable.size} nodes unavailable` : "live");
  }

  private connect(c: Collector): void {
    const conn = {};
    c.conn = conn;
    const fail = (error: Error) => {
      if (c.conn !== conn) return;
      c.conn = null;
      c.status = errorStatus(error.message, false, c.req.relay?.ns);
      this.disconnect(c);
      this.later(c, () => this.connect(c));
    };
    const relay = c.req.relay ?? { ns: "kube-system", svc: "hubble-relay", port: 80 };
    this.deps.openPortForward(c.req.clusterId, relay.ns, relay.svc, relay.port).then((pf) => {
      // stopped or superseded meanwhile: never leave this kubectl running
      if (c.conn !== conn) return pf.close();
      c.pf = pf;
      this.follow(c, true);
    }, fail);
  }

  /** Opens a flow stream on the open port-forward; `live` sets the status at once, else the first flow does. */
  private follow(c: Collector, live: boolean): void {
    const pf = c.pf;
    if (!pf) return;
    // a stream of its own identity: callbacks of a stream replaced or stopped are ignored
    const conn = {};
    c.conn = conn;
    c.unavailable.clear();
    c.lastFlow = this.deps.now();
    let flowSeen = false;
    const fail = (error: Error, beforeFlow: boolean) => {
      if (c.conn !== conn) return;
      c.conn = null;
      c.status = errorStatus(error.message, beforeFlow, c.req.relay?.ns);
      this.disconnect(c);
      this.later(c, () => this.connect(c));
    };
    let cancel: () => void;
    try {
      cancel = this.deps.streamFlows(
        `127.0.0.1:${pf.localPort}`,
        {},
        (flow) => {
          if (c.conn !== conn) return;
          // a connection counts as successful once it delivers, so a Relay that closes at once still backs off
          if (!flowSeen) c.attempt = 0;
          flowSeen = true;
          c.lastFlow = this.deps.now();
          if (!c.status.ok) c.status = this.live(c);
          if ((flow as { l7?: unknown } | null)?.l7) c.l7 = true;
          c.window.add(flow, this.deps.now());
        },
        (error) => fail(error ?? new Error("Relay closed the stream"), !flowSeen),
        (e) => {
          if (c.conn !== conn) return;
          const down = e.state === "NODE_UNAVAILABLE" || e.state === "NODE_ERROR";
          for (const n of e.nodes) down ? c.unavailable.add(n) : c.unavailable.delete(n);
          if (c.status.ok) c.status = this.live(c);
          // Relay does not reconnect to a node in error within the stream
          if (e.state === "NODE_ERROR") {
            this.restart(c);
            this.later(c, () => this.follow(c, true));
          }
        },
      );
    } catch (error) {
      // e.g. the .proto files missing next to dist/main.js; a throw here would be an unhandled rejection
      return fail(error instanceof Error ? error : new Error(String(error)), false);
    }
    if (c.conn !== conn) return cancel();
    c.cancel = cancel;
    if (live) c.status = this.live(c);
  }

  /** Ends the current stream and keeps the port-forward. */
  private restart(c: Collector): void {
    c.conn = null;
    c.cancel?.();
    c.cancel = null;
  }

  private tick(clusterId: string): void {
    const c = this.byCluster.get(clusterId);
    if (!c) return;
    const now = this.deps.now();
    for (const [s, t] of c.subs) if (now - t > this.leaseMs) c.subs.delete(s);
    if (c.subs.size === 0) return this.stop(clusterId);
    if (c.cancel && now - c.lastFlow >= this.idleMs) {
      c.status = status(false, `no flows for ${Math.round(this.idleMs / 1000)} s`);
      this.restart(c);
      this.follow(c, false);
    }
    // flowsToEdges runs on renderer-sent data; a throw from a timer would be uncaught in main
    try {
      const e = c.window.entries(now);
      c.last = flowsToEdges(e.flows, c.req.inv, c.req.ip, {
        counts: e.counts,
        windowSec: e.windowSec,
        capturedAt: new Date(now).toISOString(),
        reverseDns: (ip) => this.deps.dns.lookup(ip),
      });
      if (c.last.edges.length && !this.firsts.has(clusterId)) this.firsts.set(clusterId, c.last);
      this.deps.broadcast({ clusterId, flows: c.last, status: c.status, truncated: e.truncated, l7: c.l7 });
    } catch (error) {
      console.error(`[service-map] tick for ${clusterId} failed: ${String(error)}`);
    }
  }
}
