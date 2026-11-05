// Merges the three data sources of the map in the renderer: Kubernetes objects, Prometheus metrics, Hubble ticks.
import { nodeCidrs } from "../../common/graph/classify";
import { type FlowsResult, toSnapshot } from "../../common/graph/flows";
import { buildInventory, type Inventory, type KubeObjectLike, type PodMetrics } from "../../common/graph/inventory";
import { findPrometheus, PROM_QUERIES, promPath, promToMetrics } from "../../common/graph/prometheus";
import {
  BASELINE,
  type Baseline,
  CIDRS,
  type SourceStatus,
  SUBSCRIBE,
  type SubscribeRequest,
  TICK,
  type Tick,
  UNSUBSCRIBE,
} from "../../common/ipc";
import { type List, loadK8sObjects } from "./k8s-source";

import type { Snapshot } from "../../common/graph/types";

export interface LiveDeps {
  list: List;
  /** `KubeJsonApi.forCluster(id).get(path, { query: { query } })` */
  query: (path: string, query: string) => Promise<unknown>;
  invoke: (channel: string, ...args: unknown[]) => Promise<any>;
  /** Calls `fn` with the message's arguments, without the IPC event: `(ch, fn) => ipc.listen(ch, (_e, ...a) => fn(...a))`. */
  listen: (channel: string, fn: (...args: any[]) => void) => () => void;
  setInterval: typeof setInterval;
  clearInterval: typeof clearInterval;
}

export interface LiveState {
  snapshot: Snapshot | null;
  baseline: Baseline | null;
  sources: SourceStatus[];
  level: string;
  /** workloads with a CPU (resp. memory) sample of at least one pod: the others show no value, not 0 */
  sampled: { cpu: Set<string>; mem: Set<string> };
  truncated: number;
  l7: boolean;
}

const OBJECTS_MS = 60_000,
  METRICS_MS = 30_000,
  LEASE_MS = 20_000;
const EMPTY_FLOWS: FlowsResult = { edges: [], windowSec: 0, capturedAt: "" };
const NO_METRICS: PodMetrics = { cpu: {}, mem: {}, cpuLim: {}, memLim: {} };
const LEVELS = ["Kubernetes only", "Prometheus only", "Hubble only", "Hubble + Prometheus"];
const resource = (path: string) => path.split("/").pop()!;

export class LiveMap {
  private readonly subscriber = globalThis.crypto.randomUUID();
  private timers: ReturnType<typeof setInterval>[] = [];
  private unlisten: (() => void) | null = null;
  private onChange: (s: LiveState) => void = () => {};
  private stopped = false;
  private objects: KubeObjectLike[] | null = null;
  private objectsKey = "";
  private metrics = NO_METRICS;
  private metricsKey = "";
  private nodesKey = "";
  private servicesUnreadable = false;
  private inv: Inventory | null = null;
  private cidrs: Record<string, string[]> = {};
  private sentKey = "";
  private kube: SourceStatus = { id: "kubernetes", ok: false, detail: "listing objects", fix: null };
  private prom: SourceStatus = { id: "prometheus", ok: false, detail: "looking for Prometheus", fix: null };
  private subscribed: SourceStatus = { id: "hubble", ok: false, detail: "connecting", fix: null };
  private tick: Tick | null = null;
  private baseline: Baseline | null = null;
  private baselineAsked = false;

  constructor(
    private readonly clusterId: string,
    private readonly cluster: string,
    private readonly deps: LiveDeps,
  ) {}

  start(onChange: (s: LiveState) => void): void {
    this.onChange = onChange;
    this.unlisten = this.deps.listen(TICK, (tick: Tick) => this.onTick(tick));
    const every = (ms: number, fn: () => Promise<void>) =>
      this.timers.push(this.deps.setInterval(() => void this.guard(fn), ms));
    every(OBJECTS_MS, () => this.loadObjects());
    every(METRICS_MS, () => this.loadMetrics());
    every(LEASE_MS, () => this.subscribe());
    void this.guard(() => this.loadObjects());
  }

  // a timer callback that throws must not become an unhandled rejection nor stop the next run
  private async guard(fn: () => Promise<void>) {
    try {
      await fn();
    } catch (err) {
      console.warn(`[service-map] ${String(err)}`);
      this.emit();
    }
  }

  stop(): void {
    this.stopped = true;
    for (const t of this.timers) this.deps.clearInterval(t);
    this.timers = [];
    this.unlisten?.();
    this.unlisten = null;
    this.deps.invoke(UNSUBSCRIBE, this.clusterId, this.subscriber).catch(() => {});
  }

  private async loadObjects() {
    let loaded: Awaited<ReturnType<typeof loadK8sObjects>>;
    try {
      loaded = await loadK8sObjects(this.deps.list);
    } catch (err) {
      console.warn(`[service-map] objects: ${String(err)}`);
      if (this.stopped) return;
      this.kube = { id: "kubernetes", ok: false, detail: `objects not listed: ${String(err)}`, fix: null };
      this.emit();
      return;
    }
    if (this.stopped) return;
    const { objects, unreadable, nodes } = loaded;
    this.servicesUnreadable = unreadable.includes("/api/v1/services");
    this.kube = unreadable.length
      ? {
          id: "kubernetes",
          ok: false,
          detail: `${unreadable.length} lists not readable`,
          fix: `needs "list" on ${unreadable.map(resource).join(", ")}`,
        }
      : { id: "kubernetes", ok: true, detail: "objects listed", fix: null };
    const first = this.objects === null;
    this.objects = objects;
    const key = JSON.stringify(objects);
    if (key !== this.objectsKey) {
      this.objectsKey = key;
      this.rebuild();
    }
    const own = nodeCidrs(nodes);
    if (JSON.stringify(own) !== this.nodesKey) {
      try {
        this.cidrs = await this.deps.invoke(CIDRS, this.cluster, own);
        this.nodesKey = JSON.stringify(own);
      } catch (err) {
        console.warn(`[service-map] cidrs: ${String(err)}`);
      }
      if (this.stopped) return;
    }
    this.emit();
    await this.subscribeIfChanged();
    if (first) await this.loadMetrics();
  }

  private async loadMetrics() {
    if (!this.objects) return;
    try {
      await this.scrape(this.objects);
    } catch (err) {
      console.warn(`[service-map] metrics: ${String(err)}`);
      this.prom = { id: "prometheus", ok: false, detail: String(err), fix: null };
    }
    if (this.stopped) return;
    this.emit();
    await this.subscribeIfChanged();
  }

  // on a failed query the last good metrics stay; only the status changes
  private async scrape(objects: KubeObjectLike[]) {
    if (this.servicesUnreadable) {
      this.prom = { id: "prometheus", ok: false, detail: "services not readable", fix: null };
      return;
    }
    const svc = findPrometheus(objects.filter((o) => o.kind === "Service"));
    let metrics = NO_METRICS;
    if (!svc) {
      this.prom = {
        id: "prometheus",
        ok: false,
        detail: "no Prometheus service found",
        fix: "install Prometheus; overriding the service comes with Settings",
      };
    } else {
      const keys = Object.keys(PROM_QUERIES) as Array<keyof PodMetrics>;
      try {
        const bodies = await Promise.all(keys.map((k) => this.deps.query(promPath(svc), PROM_QUERIES[k])));
        metrics = promToMetrics(Object.fromEntries(keys.map((k, i) => [k, bodies[i]])));
        this.prom = { id: "prometheus", ok: true, detail: `${svc.ns}/${svc.name}`, fix: null };
      } catch (err) {
        this.prom = /forbidden/i.test(String(err))
          ? {
              id: "prometheus",
              ok: false,
              detail: "service proxy denied",
              fix: `needs "get" on "services/proxy" in ${svc.ns}`,
            }
          : { id: "prometheus", ok: false, detail: String(err), fix: null };
        return;
      }
    }
    if (this.stopped) return;
    const key = JSON.stringify(metrics);
    if (key !== this.metricsKey) {
      this.metricsKey = key;
      this.metrics = metrics;
      this.rebuild();
    }
  }

  private rebuild() {
    if (this.objects) this.inv = buildInventory(this.objects, this.metrics);
  }

  private request(): SubscribeRequest | null {
    const inv = this.inv;
    if (!inv) return null;
    const { podToWorkload, serviceDns, serviceDnsByPort, clusterIps } = inv;
    return {
      clusterId: this.clusterId,
      subscriber: this.subscriber,
      inv: { podToWorkload, serviceDns, serviceDnsByPort, clusterIps },
      ip: { self: this.cluster, clusterCidrs: this.cidrs, namedNetworks: [], clusterIps },
    };
  }

  // metrics change every scrape, the flow inventory rarely: re-send only what main would see differently
  private async subscribeIfChanged() {
    const key = JSON.stringify(this.request());
    if (key !== this.sentKey) await this.subscribe();
  }

  private async subscribe() {
    const req = this.request();
    if (!req || this.stopped) return;
    this.sentKey = JSON.stringify(req);
    try {
      this.subscribed = await this.deps.invoke(SUBSCRIBE, req);
    } catch (err) {
      this.subscribed = { id: "hubble", ok: false, detail: String(err), fix: null };
    }
    if (!this.tick) this.emit();
  }

  private onTick(tick: Tick) {
    if (tick.clusterId !== this.clusterId || this.stopped) return;
    this.tick = tick;
    if (!this.baselineAsked) {
      this.baselineAsked = true;
      this.deps.invoke(BASELINE, this.clusterId).then(
        (b: Baseline | null) => {
          this.baseline = b;
          this.emit();
        },
        (err) => console.warn(`[service-map] baseline: ${String(err)}`),
      );
    }
    this.emit();
  }

  private hubble(): SourceStatus {
    const t = this.tick;
    if (!t) return this.subscribed;
    const s = { ...t.status };
    if (s.ok && !t.l7) s.fix = "enable L7 visibility for HTTP codes and latency";
    if (t.truncated > 0) s.detail += ` · ${t.truncated} flows over the cap, rates partial`;
    return s;
  }

  private emit() {
    if (this.stopped) return;
    const hubble = this.hubble();
    const ws = this.inv?.workloads ?? [];
    const sampled = (m: Record<string, number>) =>
      new Set(ws.filter((w) => w.pods.some((p) => `${w.ns}/${p.name}` in m)).map((w) => w.id));
    this.onChange({
      snapshot: this.inv ? toSnapshot(this.inv, this.tick?.flows ?? EMPTY_FLOWS, this.cluster, this.cidrs) : null,
      baseline: this.baseline,
      sources: [this.kube, this.prom, hubble],
      sampled: { cpu: sampled(this.metrics.cpu), mem: sampled(this.metrics.mem) },
      level: LEVELS[(hubble.ok ? 2 : 0) + (this.prom.ok ? 1 : 0)]!,
      truncated: this.tick?.truncated ?? 0,
      l7: this.tick?.l7 ?? false,
    });
  }
}
