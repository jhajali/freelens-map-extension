# Service Map — Milestone 2: Live Data Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The map shows live traffic from Hubble Relay and CPU/RAM from Prometheus, says in a Data menu which sources work and the exact fix when one does not, falls back a level automatically, and keeps 24 h of local snapshots as the baseline for "Changes".

**Architecture:** The main process owns one collector per cluster: a reference-counted (leased) `kubectl port-forward` to Hubble Relay, a follow-mode `GetFlows` stream into a bucketed 5-minute window, and a 2.5 s tick that runs the existing `flowsToEdges` (with the renderer's inventory context) and broadcasts a compact `FlowsResult` over the extension IPC. Main also stores snapshots and the other-cluster CIDR cache in the extension's file folder. The renderer keeps loading Kubernetes objects (every 60 s) and Prometheus metrics through the service proxy (every 30 s), merges them with the ticks into a `Snapshot`, and draws it as in M1.

**Tech Stack:** as M1 — TypeScript, React 19 (host), `@freelensapp/extensions` 2.0.0, `@grpc/grpc-js` + `@grpc/proto-loader` (main), `node:dns` (main), Vitest.

**Spec:** `docs/superpowers/specs/2026-11-05-service-map-design.md` — read §4 (sources, fallback levels, Changes), §7 "Live data path", §7b, §8 (window 5 min, tick 2.5 s). M1 plan for conventions: `docs/superpowers/plans/2026-11-05-service-map-m1-foundation.md`.

## Global Constraints

- Everything in the M1 plan's Global Constraints still holds (Freelens `^2.0.0`, read-only toward cluster resources, `src/common/graph/**` imports nothing from Freelens/React/mobx/Node, red only for drops and broken routes, every registration inside an error boundary, local commits only, one `bd` issue per task).
- Rolling window 5 minutes, UI tick 2.5 s (spec §8). Prometheus refresh 30 s, Kubernetes objects refresh 60 s (builder's call, spec §8 leaves it open).
- Port-forwards are reference-counted per cluster and closed when no map page is open (spec §7).
- "Read-only" allows `create pods/portforward` and `get services/proxy`; a denied one shows ✗ with the exact missing permission (spec §7b).
- Snapshots: edge keys + rates only (no samples), per cluster, in `getExtensionFileFolder()`, pruned after 24 h; baseline = closest to 24 h ago, else oldest, else "since the map was opened"; the baseline in use is always named (spec §4).
- Plaintext Relay only; a TLS Relay shows ✗ "TLS enabled, client certs not readable" (spec §7b; reading cert Secrets is a later plan).
- Data-source overrides (Relay/Prometheus service) and the settings dialog are M3; M2 uses discovery and defaults only.

## Decisions taken in this plan (check these)

- **One cluster-wide Relay stream per cluster**, not per-view namespace filters (Roadmap said "namespace-filtered streams"): switching cluster ↔ namespace view would otherwise restart the stream and empty the 5-minute window. Load is bounded by the window's key cap (Task 1). Revisit if the size target (2,000 flows/s) is not met.
- **Hubble-metrics traffic for the "Prometheus only" level is out of M2.** The author's cluster exports no Hubble flow metrics (`prom_hubble_names` capture is empty), so there is nothing to build or test it against. The Data menu says "traffic needs Hubble Relay".
- **The M1 spike panel goes**, with `SPIKE_HUBBLE`, `src/renderer/map/libavoid.ts`, the `libavoid-wasm` Vite plugin and the `libavoid-js` dependency (knip fails on unused files). M3 re-adds libavoid following `docs/spikes/2026-11-05-feasibility.md` spike 4.

## Review Focus

1. **Renderer frame reloaded or crashed without unsubscribing** — main must still close the port-forward. → Task 4: lease expiry test.
2. **Relay goes away mid-session (cilium pod restart, port-forward dies)** — status turns ✗ with the reason, the collector reconnects with backoff, the window survives. → Task 4.
3. **Very many distinct flow kinds (scanners, many Internet IPs)** — memory stays bounded; the Data menu says rates are truncated. → Task 1 key cap, Task 8 status text.
4. **Prometheus found but kube-state-metrics absent (no limits), or empty results** — CPU/RAM shown without "% of limit", no crash. → Task 6.
5. **Snapshot folder with a partial or corrupt file, or files newer than "now" (clock change)** — skipped, never thrown. → Task 5.

---

## File Structure

```text
src/common/graph/window.ts          FlowWindow: 10 s buckets × 30, dedupe by slim flow, key cap
src/common/graph/flows.ts           (modify) weighted entries, explicit windowSec, narrower inventory type
src/common/graph/classify.ts        (modify) clusterCidrs: Record<string, string[]>; nodeCidrs()
src/common/graph/prometheus.ts      findPrometheus(), PROM_QUERIES, promToMetrics()
src/common/ipc.ts                   (rewrite) channels + payload types
src/main/dns.ts                     ReverseDns: cached, async-filled, sync lookup
src/main/collector.ts               Collector per cluster: leases, port-forward + stream, ticks, status
src/main/store.ts                   snapshots (save/prune/baseline) + other-cluster CIDR cache, on disk
src/main/handlers.ts                registers the IPC handlers on a Main.Ipc
src/main/index.ts                   (modify) wires handlers; spike handler removed
src/renderer/map/k8s-source.ts      (modify) returns objects, Prometheus service, node CIDRs
src/renderer/map/live-map.ts        LiveMap: objects + metrics + ticks → Snapshot + statuses
src/renderer/map/data-menu.tsx      Data ▾ menu: ✓/✗ per source, level, fix line
src/renderer/map/nodes.tsx          (modify) CPU/RAM (% of limit) and flows/s on cards
src/renderer/map/service-map-page.tsx (modify) uses LiveMap; Data menu in the top bar
test/fixture.ts                     (modify) cluster.json CIDRs as arrays; uses promToMetrics
```

Shared types (Task 6 defines them in `src/common/ipc.ts`; every later task uses them):

```ts
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
// FlowInventory is defined in src/common/graph/flows.ts (Task 1) and imported here
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
```

---

### Task 1: Rolling flow window and weighted aggregation

**Files:**
- Create: `src/common/graph/window.ts`, `src/common/graph/window.test.ts`
- Modify: `src/common/graph/flows.ts`, `src/common/graph/flows.test.ts`

**Interfaces:**
- Produces: `class FlowWindow { constructor(opts?: { bucketSec?: number /*10*/; buckets?: number /*30*/; maxKeys?: number /*20000*/ }); add(flow: unknown, nowMs: number): void; entries(nowMs: number): { flows: unknown[]; counts: number[]; windowSec: number; truncated: number } }`.
  - A flow is stored as its slim form (only the fields `flowsToEdges` reads: `verdict`, `is_reply`, `l4`, `IP.source/destination`, `source`/`destination` `{namespace, pod_name, labels}`, `source_names`, `destination_names`), keyed by `JSON.stringify(slim)`, counted per bucket. Replies are dropped on `add`.
  - `windowSec` = time covered: `min(now − first add, buckets × bucketSec)`, at least 1.
  - `truncated` = flows not counted in the current window because the key cap was reached.
- Produces: `export type FlowInventory = Pick<Inventory, "podToWorkload" | "serviceDns" | "serviceDnsByPort" | "clusterIps">` in `flows.ts`, and `flowsToEdges(flows, inv: FlowInventory, ctx, opts?: { reverseDns?; sampleLimit?; counts?: number[]; windowSec?: number; capturedAt?: string })` — `counts[i]` weights flow `i` (default 1) in flows, conns, drops and sample counts; `windowSec`/`capturedAt` override the values derived from flow times.

- [ ] **Step 1: Write failing tests** in `window.test.ts`:
  - `"counts identical flows once per key and expires them after the window"`: add the same flow 3× at t=0, 1× at t=5 s → `entries(10_000)` has 1 flow with count 4; `entries(301_000)` has 0 flows.
  - `"reports the covered span while the window fills"`: first add at t=0 → `entries(60_000).windowSec === 60`; at t=900_000 → `300`.
  - `"caps distinct keys and counts the rest as truncated"`: `maxKeys: 2`, three different flows → 2 entries, `truncated === 1`.
  - `"drops replies"`: a flow with `is_reply: true` → 0 entries.
  - in `flows.test.ts`, `"weights flows by count and uses the given window"`: one SYN flow with `counts: [10]`, `windowSec: 5` → `flowsPerSec === 2`, `connsPerSec === 2`; the capture-b test `"produces the prototype's 171 links"` still passes unchanged.
- [ ] **Step 2:** Run `./.superpowers/pnpm exec vitest run src/common/graph` → FAIL (`./window` missing; weighting ignored).
- [ ] **Step 3:** Implement `FlowWindow` in `window.ts`; extend `flowsToEdges` options as above and narrow its `inv` parameter type.
- [ ] **Step 4:** Run the same command → PASS.
- [ ] **Step 5:** Commit `feat(graph): rolling flow window and weighted aggregation`.

### Task 2: Other-cluster CIDRs as lists

**Files:**
- Modify: `src/common/graph/classify.ts`, `src/common/graph/types.ts` (`Snapshot.clusterCidrs`), `src/common/graph/flows.ts` (`toSnapshot`), `test/fixture.ts`, `src/common/graph/classify.test.ts`

**Interfaces:**
- Produces: `IpContext.clusterCidrs: Record<string, string[]>` (cluster name → CIDRs); `Snapshot.clusterCidrs` the same; `toSnapshot(inv, flows, cluster, clusterCidrs: Record<string, string[]>)`.
- Produces: `nodeCidrs(nodes: KubeObjectLike[]): string[]` in `classify.ts` — the distinct `/24`s of every `status.addresses[type=InternalIP]` IPv4 address, sorted (IPv6 node addresses: their `/64`).
- `test/fixture.ts` wraps each string CIDR of `cluster.json` in an array (the committed fixtures keep their format).

- [ ] **Step 1: Write failing tests** in `classify.test.ts`: the existing `classifyIp` cases rewritten with `clusterCidrs: { dev: ["10.20.19.0/24"], mgmt: ["10.20.21.0/24", "10.20.31.0/24"] }`, plus `["10.20.31.7", "@cluster:mgmt"]`; `"nodeCidrs keeps one /24 per node subnet"`: nodes with InternalIPs `10.1.2.3`, `10.1.2.9`, `10.1.5.1` and an ExternalIP `51.0.0.1` → `["10.1.2.0/24", "10.1.5.0/24"]`.
- [ ] **Step 2:** Run `./.superpowers/pnpm exec vitest run src/common/graph` → FAIL.
- [ ] **Step 3:** Change the types, loop over each cluster's list in `classifyIp`, add `nodeCidrs`, adapt `test/fixture.ts` and every caller the type check names (`./.superpowers/pnpm exec tsc -p src/tsconfig.json`).
- [ ] **Step 4:** Run `./.superpowers/pnpm test:unit` → PASS (all M1 tests included).
- [ ] **Step 5:** Commit `feat(graph): several CIDRs per known cluster`.

### Task 3: Reverse DNS in main

**Files:**
- Create: `src/main/dns.ts`, `src/main/dns.test.ts`

**Interfaces:**
- Produces: `class ReverseDns { constructor(resolve?: (ip: string) => Promise<string[]> /* default node:dns promises.reverse */, opts?: { max?: number /*2000*/; timeoutMs?: number /*2000*/ }); lookup(ip: string): string | null }` — returns the cached first hostname, or `null` and starts one background lookup for an uncached IP; a failed or timed-out lookup is cached as `null`; the cache evicts the oldest entry above `max`. Plugs into `flowsToEdges(…, { reverseDns: dns.lookup.bind(dns) })`.

- [ ] **Step 1: Write failing tests:** `"answers from the cache after the first lookup"` (fake resolver resolves `["dns.google"]`; first `lookup` → `null`, after `await` a tick → `"dns.google"`, resolver called once for two more lookups); `"caches failures"` (resolver rejects → `null`, not retried); `"evicts the oldest entry above max"` (`max: 2`, three IPs → the first is looked up again).
- [ ] **Step 2:** Run `./.superpowers/pnpm exec vitest run src/main/dns.test.ts` → FAIL.
- [ ] **Step 3:** Implement `ReverseDns`.
- [ ] **Step 4:** Same command → PASS.
- [ ] **Step 5:** Commit `feat(main): cached reverse DNS for public IPs`.

### Task 4: Collector per cluster

**Files:**
- Create: `src/main/collector.ts`, `src/main/collector.test.ts`

**Interfaces:**
- Consumes: `openPortForward` (M1 `src/main/hubble/port-forward.ts`), `streamFlows` (M1 `relay-client.ts`, returns a cancel function, `onEnd(error?)`), `FlowWindow` (Task 1), `flowsToEdges` (Task 1), `ReverseDns` (Task 3), `SubscribeRequest`, `Tick`, `SourceStatus` (types block above).
- Produces:

  ```ts
  interface CollectorDeps {
    openPortForward: typeof openPortForward; streamFlows: typeof streamFlows; dns: ReverseDns;
    broadcast: (tick: Tick) => void; now: () => number;
    setInterval: typeof setInterval; clearInterval: typeof clearInterval; setTimeout: typeof setTimeout;
  }
  class Collectors {
    constructor(deps: CollectorDeps, opts?: { tickMs?: number /*2500*/; leaseMs?: number /*45000*/; retryMs?: number[] /*[2000, 5000, 15000, 30000]*/ });
    subscribe(req: SubscribeRequest): SourceStatus;   // starts or refreshes; also updates the inventory context
    unsubscribe(clusterId: string, subscriber: string): void;
    current(clusterId: string): FlowsResult | null;   // last tick's result, for snapshots (Task 5)
    stopAll(): void;
  }
  ```

  - Relay target: `kube-system/hubble-relay` port 80, stream in follow mode with no namespace filter.
  - One collector per `clusterId`; it stops (stream cancelled, port-forward closed, ticks cleared) when its last subscriber unsubscribes or every lease is older than `leaseMs` (checked on each tick). A subscriber renews its lease by calling `subscribe` again.
  - Each tick broadcasts `Tick { clusterId, flows: flowsToEdges(window entries, inv, ip, { counts, windowSec, capturedAt: now ISO, reverseDns }), status, truncated, l7 }`; `l7` is true once any flow carried an `l7` field. While disconnected, `flows` is the last window anyway (it keeps aging) and `status.ok` is false.
  - On a stream or port-forward error: status ✗, close the port-forward, retry after `retryMs[min(attempt, 3)]`; a successful connection resets the attempt count.
  - Status text (`detail` / `fix`), matched on the error message:
    - `/forbidden.*portforward/i` → `"port-forward denied"` / `'needs "create" on "pods/portforward" in kube-system'`
    - `/not ?found/i` → `"Hubble Relay not found in kube-system"` / `"enable it: cilium hubble enable --relay"`
    - `/(ECONNRESET|Protocol error|http2|TLS|SSL)/i` on the gRPC stream before any flow → `"TLS enabled, client certs not readable"` / `null`
    - anything else → the message / `null`; connected → `"live"` / `null`.

- [ ] **Step 1: Write failing tests** with fake deps (fake port-forward resolving `{ localPort: 1, close: vi.fn() }`, fake `streamFlows` capturing `onFlow`/`onEnd`, fake timers via `vi.useFakeTimers()`):
  - `"streams, ticks and broadcasts the window's links"`: subscribe, push two capture-b flows through `onFlow`, advance 2.5 s → one broadcast for the cluster with `flows.edges.length > 0` and `status.ok === true`.
  - `"keeps one port-forward per cluster and closes it with the last subscriber"`: two subscribers on `c1`, one on `c2` → `openPortForward` called twice; unsubscribe both `c1` subscribers → `c1`'s `close` called, `c2`'s not.
  - `"closes a cluster whose subscribers stop renewing their lease"` (Review Focus 1): subscribe, advance 50 s with no renewal → `close` called and no further broadcasts.
  - `"reconnects with backoff and keeps the window"` (Review Focus 2): after flows, call `onEnd(new Error("Connection dropped"))` → next tick `status.ok === false` and still has edges; advance 2 s → `openPortForward` called again.
  - `"names the missing permission"`: port-forward rejects with `'Error from server (Forbidden): … "pods/portforward"'` → returned/broadcast status `fix` contains `pods/portforward`.
- [ ] **Step 2:** Run `./.superpowers/pnpm exec vitest run src/main/collector.test.ts` → FAIL.
- [ ] **Step 3:** Implement `Collectors` in `collector.ts`.
- [ ] **Step 4:** Same command → PASS.
- [ ] **Step 5:** Commit `feat(main): per-cluster Hubble collector with leases and reconnect`.

### Task 5: Snapshots and the CIDR cache on disk

**Files:**
- Create: `src/main/store.ts`, `src/main/store.test.ts`

**Interfaces:**
- Produces:

  ```ts
  class MapStore {
    constructor(dir: string, now?: () => number);          // dir = await extension.getExtensionFileFolder()
    saveSnapshot(clusterId: string, flows: FlowsResult): Promise<void>; // samples stripped; prunes files > 24 h
    baseline(clusterId: string): Promise<FlowsResult | null>; // closest to now − 24 h; ignores unreadable files and files dated after now
    putCidrs(cluster: string, cidrs: string[]): Promise<Record<string, string[]>>; // merges and returns every cached cluster
  }
  ```

  - Layout: `<dir>/<clusterId>/snapshots/<epoch-ms>.json`, `<dir>/cidrs.json`. `clusterId` is used as a directory name only after `/^[A-Za-z0-9._-]+$/` (Freelens ids are hex); anything else throws.
  - Written via a `*.tmp` file renamed over the target, so a crash never leaves a partial file under the final name.
  - The "since-opened" fallback is not here: Task 6 keeps the first tick of a session in memory.

- [ ] **Step 1: Write failing tests** in a `mkdtemp` directory with an injected clock:
  - `"stores rates without samples and prunes after 24 h"`: save at t0 and t0+25 h → only the second file exists; its edges have `samples: []`.
  - `"picks the snapshot closest to 24 h ago, else the oldest"`: files written directly at now−23 h and now−2 h → `baseline` returns the −23 h one; with only −2 h → that one; with none → `null`.
  - `"skips a corrupt file and one dated in the future"` (Review Focus 5): a file containing `{"edg` and one named `now+1h` → `baseline` returns the valid one, does not throw.
  - `"merges CIDRs across clusters"`: `putCidrs("a", ["10.0.1.0/24"])`, then `putCidrs("b", […])` → both returned, and persisted across a new `MapStore` on the same dir.
  - `"rejects a cluster id that is not a plain name"`: `saveSnapshot("../x", …)` rejects.
- [ ] **Step 2:** Run `./.superpowers/pnpm exec vitest run src/main/store.test.ts` → FAIL.
- [ ] **Step 3:** Implement `MapStore` with `node:fs/promises`.
- [ ] **Step 4:** Same command → PASS.
- [ ] **Step 5:** Commit `feat(main): local snapshots and other-cluster CIDR cache`.

### Task 6: IPC surface and main wiring

**Files:**
- Rewrite: `src/common/ipc.ts` (types block above; `SPIKE_HUBBLE` and `SpikeHubbleResult` removed)
- Create: `src/main/handlers.ts`, `src/main/handlers.test.ts`
- Modify: `src/main/index.ts`; Delete: `src/renderer/diagnostics/feasibility-panel.tsx`, `src/renderer/map/libavoid.ts`; Modify: `vite.config.mjs` (drop `libavoidWasm`), `package.json` (drop `libavoid-js`), `src/renderer/map/service-map-page.tsx` (drop the Diagnostics `<details>`) and its test's `vi.mock`

**Interfaces:**
- Consumes: `Collectors` (Task 4), `MapStore` (Task 5).
- Produces: `registerHandlers(ipc: { handle(channel: string, fn: (event: unknown, ...args: any[]) => unknown): void }, collectors: Collectors, store: MapStore, opts?: { snapshotMs?: number /*300000*/ }): () => void` (returns a disposer that clears the snapshot timer):
  - `SUBSCRIBE(req: SubscribeRequest) → SourceStatus`; `UNSUBSCRIBE(clusterId, subscriber) → void`;
  - `BASELINE(clusterId) → Baseline | null`: `store.baseline` if any, else the first non-empty tick of this main-process session for the cluster (`source: "since-opened"`), else `null`;
  - `CIDRS(cluster, cidrs) → Record<string, string[]>` via `store.putCidrs`;
  - every `snapshotMs`, `store.saveSnapshot(id, collectors.current(id))` for each running cluster with a result.
- `index.ts`: `onActivate` creates `ReverseDns`, `Collectors` (broadcast = `ipc.broadcast(TICK, tick)`), `MapStore(await this.getExtensionFileFolder())`, calls `registerHandlers`; `onDeactivate` calls the disposer and `collectors.stopAll()`.

- [ ] **Step 1: Write failing tests** with a fake `ipc` recording handlers, a fake `Collectors` and a real `MapStore` in a temp dir: `"answers the baseline from disk first, then from the session's first tick"`; `"saves a snapshot of every running cluster on the timer"` (fake timers, advance 5 min → one file per cluster); `"returns the merged CIDR cache"`.
- [ ] **Step 2:** Run `./.superpowers/pnpm exec vitest run src/main` → FAIL.
- [ ] **Step 3:** Implement `handlers.ts`, rewrite `ipc.ts`, wire `index.ts`, remove the spike code and libavoid as listed.
- [ ] **Step 4:** `./.superpowers/pnpm test:unit` → PASS; `tsc -p src/main`, `tsc -p src/renderer`, `vite build` and `vite build --mode main` (run directly, see M1 ledger: nested pnpm fails locally) → no errors; knip production pass → no unused files.
- [ ] **Step 5:** Commit `feat(main): live-data IPC; spike panel removed`.

### Task 7: Prometheus metrics through the service proxy

**Files:**
- Create: `src/common/graph/prometheus.ts`, `src/common/graph/prometheus.test.ts`
- Modify: `test/fixture.ts` (use `promToMetrics`)

**Interfaces:**
- Produces:

  ```ts
  interface PromService { ns: string; name: string; port: number }
  function findPrometheus(services: KubeObjectLike[]): PromService | null;
  const PROM_QUERIES: Record<keyof PodMetrics, string>;   // cpu, mem, cpuLim, memLim — the four queries of scripts/capture.sh, verbatim
  function promToMetrics(results: Partial<Record<keyof PodMetrics, unknown>>): PodMetrics; // each value = a Prometheus /api/v1/query JSON body
  const promPath = (p: PromService) => `/api/v1/namespaces/${p.ns}/services/${p.name}:${p.port}/proxy/api/v1/query`;
  ```

  - `findPrometheus`: first Service, in this name order, `prometheus-server`, `prometheus-operated`, `kube-prometheus-stack-prometheus`, `prometheus-k8s`, `prometheus`, then any with label `app.kubernetes.io/name: prometheus`; port = the one named `http`/`web`, else 9090, else 80, else the first.
  - `promToMetrics`: missing or non-`success` bodies yield empty maps for that metric (Review Focus 4); keys `"<namespace>/<pod>"`.

- [ ] **Step 1: Write failing tests:** `"finds the common Prometheus services"` (a `prometheus-operated` with ports `web:9090` → `{…, port: 9090}`; a labelled `my-prom` with port 80 only → 80; none → `null`); `"turns query results into pod metrics"` (capture-b `prom-cpu.json` body → same map the M1 fixture loader produced); `"yields empty limits when kube-state-metrics is missing"` (`cpuLim` body with `result: []`, `memLim` absent → `{}` for both, no throw).
- [ ] **Step 2:** Run `./.superpowers/pnpm exec vitest run src/common/graph/prometheus.test.ts` → FAIL.
- [ ] **Step 3:** Implement; switch `test/fixture.ts` to `promToMetrics`.
- [ ] **Step 4:** `./.superpowers/pnpm test:unit` → PASS.
- [ ] **Step 5:** Commit `feat(graph): Prometheus discovery and pod metrics`.

### Task 8: LiveMap — sources merged in the renderer

**Files:**
- Modify: `src/renderer/map/k8s-source.ts`, `src/renderer/map/k8s-source.test.ts`
- Create: `src/renderer/map/live-map.ts`, `src/renderer/map/live-map.test.ts`

**Interfaces:**
- Consumes: `loadK8sSnapshot` internals, `buildInventory`, `toSnapshot`, `nodeCidrs` (Task 2), `findPrometheus`/`promToMetrics`/`PROM_QUERIES`/`promPath` (Task 7), IPC types (Task 6).
- Produces in `k8s-source.ts`: `loadK8sObjects(list: List): Promise<{ objects: KubeObjectLike[]; unreadable: string[]; nodes: KubeObjectLike[] }>` (adds `/api/v1/nodes`, not part of the core "unreadable" set); `loadK8sSnapshot` stays, built on it.
- Produces in `live-map.ts`:

  ```ts
  interface LiveDeps {
    list: List; query: (path: string, query: string) => Promise<unknown>;   // KubeJsonApi.forCluster(id).get(path, { query: { query } })
    invoke: (channel: string, ...args: unknown[]) => Promise<any>; listen: (channel: string, fn: (...args: any[]) => void) => () => void;
    setInterval: typeof setInterval; clearInterval: typeof clearInterval;
  }
  interface LiveState { snapshot: Snapshot | null; baseline: Baseline | null; sources: SourceStatus[]; level: string; truncated: number; l7: boolean }
  class LiveMap {
    constructor(clusterId: string, cluster: string, deps: LiveDeps);
    start(onChange: (s: LiveState) => void): void;   // objects now + every 60 s, metrics now + every 30 s, subscribe now + every 20 s (lease), listen TICK
    stop(): void;                                      // unsubscribe, clear timers, remove listener
  }
  ```

  - `level`: `"Hubble + Prometheus"`, `"Hubble only"`, `"Prometheus only"`, `"Kubernetes only"` from which of `hubble`/`prometheus` are ok.
  - `sources`:
    - `kubernetes`: ✓ `"objects listed"`, or ✗ `"<n> lists not readable"` / `'needs "list" on <resources>'`.
    - `prometheus`: ✗ `"no Prometheus service found"` / `"install Prometheus; overriding the service comes with Settings"`; ✗ on a `/forbidden/i` error `"service proxy denied"` / `'needs "get" on "services/proxy" in <ns>'`; ✓ `"<ns>/<name>"`.
    - `hubble`: the latest tick's status; before the first tick, the `SUBSCRIBE` answer. When ok and `!l7`, `fix` = `"enable L7 visibility for HTTP codes and latency"`; when `truncated > 0`, `detail` gains `" · <n> flow kinds over the cap, rates partial"` (Review Focus 3).
  - Ticks for another `clusterId` are ignored. `subscriber` = a random id per `LiveMap`.
  - Snapshot = `toSnapshot(inventory, tick.flows ?? empty, cluster, cidrs)`; the inventory is rebuilt only when objects or metrics change; `cidrs` = the `CIDRS` answer for `nodeCidrs(nodes)`. `baseline` asked once after the first tick.

- [ ] **Step 1: Write failing tests** with fake deps and capture-b data (objects via the fake `list` from `k8s-source.test.ts`, the four `prom-*.json` bodies via the fake `query`, a fake IPC that answers `SUBSCRIBE` with `{ ok: true, … }` and lets the test emit `TICK`):
  - `"reaches the Hubble + Prometheus level and draws the tick's links"`: after a tick with capture-b's `flowsToEdges` result → `level === "Hubble + Prometheus"`, `snapshot.edges.length === 171`, a workload with metrics has `cpu > 0`.
  - `"falls back to Kubernetes only and says why"`: `query` rejects with `Error("… forbidden …")`, `SUBSCRIBE` answers ✗ → `level === "Kubernetes only"`, the prometheus source's `fix` contains `services/proxy`.
  - `"ignores ticks of other clusters"`.
  - `"renews its lease and unsubscribes on stop"`: advance 20 s → `SUBSCRIBE` invoked again; `stop()` → `UNSUBSCRIBE` invoked, listener removed.
- [ ] **Step 2:** Run `./.superpowers/pnpm exec vitest run src/renderer/map` → FAIL.
- [ ] **Step 3:** Implement `loadK8sObjects` and `LiveMap`.
- [ ] **Step 4:** Same command → PASS; `./.superpowers/pnpm test:unit` → PASS.
- [ ] **Step 5:** Commit `feat(map): live map state from Kubernetes, Prometheus and Hubble`.

### Task 9: Live page — Data menu, card metrics, link rates

**Files:**
- Create: `src/renderer/map/data-menu.tsx`, `src/renderer/map/data-menu.test.tsx` (jsdom)
- Modify: `src/renderer/map/service-map-page.tsx`, `src/renderer/map/service-map-page.test.tsx`, `src/renderer/map/nodes.tsx`, `src/renderer/map/service-map.module.scss`

**Interfaces:**
- Consumes: `LiveMap`, `LiveState` (Task 8).
- Produces: `DataMenu({ state }: { state: LiveState })` — a `<details>` labelled `Data: <level>`; one row per source: `✓`/`✗`, name (`Kubernetes`, `Prometheus`, `Hubble Relay`), `detail`, and `fix` on its own line when set; the baseline line `Changes baseline: snapshot from <HH:MM>` / `since the map was opened` / `none yet`.
- `ServiceMapPage({ extension, params, live? })` (and `MapPage`, which passes `live` through): `live` defaults to a `LiveMap` for the active cluster (`KubeJsonApi.forCluster`, `MapIpcRenderer.getInstance()`); started in an effect, stopped in its cleanup (created inside the effect — StrictMode rule in AGENTS.md). The M1 `load` prop is replaced by `live` (tests pass a fake with `start`/`stop`). Layout re-runs only when the set of node ids or edge ids changes; rate changes re-render edges in place (edge `data` updated, no ELK run per tick).
- Cards: `CPU <fmtCpu>(<p>%) · RAM <fmtMem>(<p>%)` (the `(%)` part only with a limit; formats from the prototype: `<1` core → `<n>m`, else 2 decimals; ≥1 GiB → `<n.n>Gi`, else `<n>Mi`), `<rate> flows/s` from the sum of the card's in- and outbound link rates; "CPU/RAM need Prometheus" stays when the prometheus source is ✗.

- [ ] **Step 1: Write failing tests:** `data-menu.test.tsx`: `"lists every source with its fix"` (state with prometheus ✗ fix `needs "get" on "services/proxy" in observability` → text present, summary `Data: Hubble only`); `"names the baseline in use"`. `service-map-page.test.tsx`: replace the `load` fake with a fake `live` that emits capture-b state; `"shows CPU and RAM with % of limit on cards"` (some card text matches `/CPU \d+m \(\d+%\)/`); `"does not lay out again when only rates change"` (spy on `layoutGraph` via `vi.mock("./layout", …)` keeping the real implementation; second emit with changed rates only → called once); the M1 page tests still pass with the fake.
- [ ] **Step 2:** Run `./.superpowers/pnpm exec vitest run src/renderer/map` → FAIL.
- [ ] **Step 3:** Implement `DataMenu`, the page changes and the card rows; the Data menu replaces the M1 `Data: Kubernetes only` note in the top bar.
- [ ] **Step 4:** `./.superpowers/pnpm test:unit` → PASS; all eight `tsc -p` programs, both `vite build` runs, Biome and both knip passes → clean.
- [ ] **Step 5:** Commit `feat(map): live page with Data menu and card metrics`.

### Task 10: Check in Freelens

**Files:** none (results recorded in `docs/spikes/2026-11-05-feasibility.md`, section "M2 check", no cluster names or IPs, no screenshots committed)

- [ ] **Step 1:** Build, copy `dist/` into the installed extension (M1 ledger note) and reload the cluster frame; open the map on the development cluster.
- [ ] **Step 2:** Data menu shows `Data: Hubble + Prometheus`, all three ✓, and the L7 hint if no flow has L7. Links carry rates that change between ticks; cards show CPU/RAM with % where limits exist.
- [ ] **Step 3:** Leave the page (another sidebar item): within 60 s no `kubectl port-forward svc/hubble-relay` process remains (`pgrep -fl "port-forward svc/hubble-relay"` → nothing). Reopen → it comes back and rates resume.
- [ ] **Step 4:** Kill the port-forward process while the page is open → Hubble ✗ with the reason, then ✓ again within ~30 s; rates keep showing meanwhile.
- [ ] **Step 5:** After 5 minutes open, a file exists under the extension folder's `<clusterId>/snapshots/`; the Data menu's baseline line says `snapshot from <HH:MM>`.
- [ ] **Step 6:** Commit `docs: M2 check in Freelens`.

---

## Roadmap after M2 (unchanged from M1, minus what M2 did)

- **M3 — Full UI:** details panel, toolbar rows, search, quick views (incl. the Changes view over M2's baseline), Filters, Layout menu, Settings dialog + `appPreferences` (thresholds, named networks, public endpoints, palette, anonymize, Relay/Prometheus overrides), persistence, libavoid routing (re-added) with live drag re-route, particles, Policy layer, All-clusters view, export, Freelens actions.
- **M4 — Release:** README (data sources, minimal ClusterRole incl. `pods/portforward` and `services/proxy`), icon attribution, CI and integration sessions, Renovate exclusions, publish.
- **Later:** Hubble-metrics traffic for the Prometheus-only level; TLS Relay with client certs; namespace-filtered Relay streams if the size target needs them.
