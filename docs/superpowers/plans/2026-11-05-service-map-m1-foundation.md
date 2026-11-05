# Service Map — Milestone 1: Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Freelens 2.0 extension that installs, adds a "Service map" page and "Show on map" menu entries, proves the five risky integrations (spikes), and draws the cluster → namespace topology from the Kubernetes API (no live traffic yet) on top of a fully unit-tested graph core.

**Architecture:** Forked from `freelensapp/freelens-example-extension`. All graph logic lives in pure TypeScript under `src/common/graph/` (no Freelens or React imports) and is tested against an anonymized recording of a real cluster. The renderer page turns a `Snapshot` into a view model and draws it with React Flow + ELK. Live data (Hubble/Prometheus), the full UI and release work are Milestones 2–4 (see Roadmap) and get their own plans.

**Tech Stack:** TypeScript 7, React 19 (host-provided), Vite 8, Vitest 5, pnpm 12, Node 24, `@freelensapp/extensions` 2.0.0, `@xyflow/react` 12, `elkjs` 0.9, `libavoid-js` 0.5.0-beta.5 (spike only in M1), `@grpc/grpc-js` (spike only in M1).

**Spec:** `docs/superpowers/specs/2026-11-05-service-map-design.md` (read §3, §4, §7, §7b). Visual reference: the throwaway prototype `.superpowers/brainstorm/18030-1793871128/content/prototype-live.html` — port behavior from it, not its code style.

## Global Constraints

- Freelens target: `engines.freelens: "^2.0.0"`, `@freelensapp/extensions` `2.0.0`; Node `>= 24`; pnpm via the template's `packageManager`.
- Package name `freelens-service-map-extension` (author's call — rename before first publish if desired), license MIT.
- Read-only toward cluster resources: no create/update/delete/patch of any Kubernetes object. Port-forward and service proxy are allowed (spec §7b).
- `src/common/graph/**` imports nothing from `@freelensapp/extensions`, React, mobx or Node built-ins — it must run in renderer, main and Vitest unchanged.
- Red/critical color only for drops and broken routes; healthy traffic is blue (web/API) or teal (databases, caches, queues) or gray (other). Health never by color alone (● ▲ ■).
- Kubernetes icons from `kubernetes/community` (CC-BY-4.0): bundled as SVG files with an attribution line in `README.md` and `NOTICE`.
- No raw data from the author's cluster is ever committed; only output of `scripts/anonymize-capture.mjs`.
- Every Freelens registration (page, menu item, detail item) is wrapped by the template's error-boundary helpers.
- Commits are local only; never push (repo policy: conservative profile).
- Task tracking with `bd` (beads): one issue per task, claimed at start, closed at the end.

## Review Focus

1. **Cluster without Gateway API, KubeBlocks or Cilium CRDs** — listing them returns 404; the map must still render with those features off. → test in Task 6 (`buildInventory` with those lists absent) and Task 10 (page with empty CRD results).
2. **Cluster without Hubble and Prometheus (Kubernetes-only level)** — no edges except declared routes/LBs; page renders, shows "Kubernetes only". → test in Task 8 (`aggregate` with `edges: []`) and Task 10.
3. **Pods with no controller or owned by Job/CronJob/unknown CRD** — must not crash and must not invent workloads. → test in Task 6.
4. **Flows with IPv6, ICMP (no port) or missing pod names** — classification returns something sane (`ICMPv4`, `@internet:<v6>`), never throws. → tests in Task 5 and Task 7.
5. **Namespace with no workloads, workloads with no Helm release, names longer than the card** — namespace card shows 0, "(no Helm release)" box, `shortName` trimming and two-line wrap. → tests in Task 8 (`shortName`) and Task 9 (taller card height for long names).

---

## File Structure

```text
package.json, vite.config.mjs, vitest.config.ts, tsconfig*.json, biome.jsonc, build/, test/   ← from template
NOTICE                                  Kubernetes icon attribution
scripts/anonymize-capture.mjs           raw capture dir → anonymized fixture (deterministic)
scripts/anonymize-capture.test.mjs      (run by vitest via include)
src/common/graph/types.ts               Snapshot, Workload, RawEdge, Route, LoadBalancer, View, Filters …
src/common/graph/classify.ts            ports → protocol, protocol → family, IP class, LB provider/exposure
src/common/graph/inventory.ts           Kubernetes objects (+ pod metrics) → workloads, routes, LBs, service maps
src/common/graph/flows.ts               Hubble flows → RawEdge[] (aggregation, samples, DNS names)
src/common/graph/view.ts                mapEndpoint, aggregate, scope, refine, diff, isProblem, shortName
src/common/graph/fixture.ts             loads test/fixtures/capture-a|b into a Snapshot (tests only)
src/renderer/map/layout.ts              ELK layout + release-box shrink-wrap → React Flow nodes
src/renderer/map/nodes.tsx              Card, NamespaceNode, OutsideNode, ReleaseBox
src/renderer/map/edges.tsx              TrafficEdge (orthogonal rounded path, label)
src/renderer/map/service-map-page.tsx   page: breadcrumb, view state, data loading, React Flow
src/renderer/map/k8s-source.ts          reads Kubernetes objects for the active cluster → Snapshot (no flows)
src/renderer/map/service-map.module.scss tokens defined on Freelens CSS variables
src/renderer/icons/k8s/*.svg            deploy, sts, ds, ns, ing, svc, node, control-plane
src/renderer/menus/show-on-map.tsx      "Show on map" menu items
src/renderer/index.tsx                  registrations
src/main/index.ts                       main entry (spike IPC handlers in M1)
src/renderer/diagnostics/feasibility-panel.tsx   spike buttons (removed in M2)
docs/spikes/2026-11-05-feasibility.md   spike results (go/no-go record)
test/fixtures/capture-a/, capture-b/    anonymized: k8s.json, extra.json, policies.json, flows.jsonl, prom-*.json
```

Shared types (defined in Task 5, used everywhere):

```ts
// src/common/graph/types.ts
export type WorkloadKind = "Deployment" | "StatefulSet" | "DaemonSet" | "KubeBlocks";
export interface PodInfo { name: string; phase: string; restarts: number; cpu: number; mem: number; cpuLim: number | null; memLim: number | null }
export interface Workload { id: string; ns: string; name: string; kind: WorkloadKind; release: string | null; chart: string | null;
  image: string; desired: number; ready: number; db: boolean; labels: Record<string, string>; pods: PodInfo[];
  restarts: number; cpu: number; mem: number; cpuLim: number | null; memLim: number | null }
export interface Route { ns: string; name: string; kind: "HTTPRoute" | "Ingress"; gateway: string | null; host: string | null;
  path: string; service: string; port: number | null; target: string | null }
export interface LbPort { name: string | null; port: number; protocol: string; hostname?: string | null }
export interface LoadBalancer { kind: "Service" | "Gateway"; ns: string; name: string; ips: string[]; ports: LbPort[];
  provider: string; exposure: "public" | "internal"; publicEndpoint: string | null; target: string | null }
/** workload id "ns/name" | "@internet:<ip|fqdn>" | "@internal:<cidr>" | "@cluster:<name>" | "@host" | "@kube-apiserver" | "@<namespace>" */
export type Endpoint = string;
export interface Sample { srcIp: string; srcPod: string | null; dstIp: string; dstPod: string | null; port: number | null; count: number; dns: string | null }
export interface RawEdge { src: Endpoint; dst: Endpoint; proto: string; port: number | null; app: string;
  flowsPerSec: number; connsPerSec: number; dropRate: number; samples: Sample[] }
export interface PolicyRef { kind: string; ns: string | null; name: string }
export interface Snapshot { cluster: string; capturedAt: string; windowSec: number; namespaces: string[]; workloads: Workload[];
  routes: Route[]; loadBalancers: LoadBalancer[]; edges: RawEdge[]; policies: PolicyRef[]; clusterCidrs: Record<string, string> }
export type View = null | string | "@clusters";          // null = cluster view, string = namespace
export type Direction = "all" | "inbound" | "outbound" | "internal";
export interface Filters { hiddenNs: Set<string>; labels: Array<[string, string | null]>; apps: Set<string>; kinds: Set<string>;
  direction: Direction; minRate: number; hideIdle: boolean; infra: boolean;
  problems: boolean; exposed: boolean; dbs: boolean; drops: boolean; changes: boolean }
export interface Thresholds { cpu: number; ram: number; restarts: number }   // defaults 85, 85, 1
export interface MapEdge { id: string; source: string; target: string; rate: number; drops: number; base: number; bdrops: number;
  apps: Map<string, number>; routes: Route[]; lbs: LoadBalancer[]; samples: Sample[]; idx: number[]; synthetic: boolean;
  change?: "new" | "gone" }
export const NO_FILTERS: Filters;   // everything visible, all quick views off, direction "all", minRate 0
```

---

### Task 1: Extension skeleton, page and "Show on map"

**Files:**
- Create: everything from `freelensapp/freelens-example-extension` at commit `e599f13` except `src/renderer/{api,details,menus,pages,preferences}/example*`, `examples/`, `integration/__tests__/example-*`, `skills/`
- Create: `src/renderer/map/service-map-page.tsx` (placeholder content), `src/renderer/menus/show-on-map.tsx`, `src/renderer/icons/map.tsx`, `NOTICE`
- Modify: `package.json` (name, description, repository), `src/renderer/index.tsx`, `src/main/index.ts`, `README.md`
- Test: `src/renderer/menus/show-on-map.test.tsx`

**Interfaces:**
- Produces: `PAGE_ID = "service-map"`; page params `{ namespace?: string; select?: string }` (select = workload id `ns/name`); `ShowOnMapMenuItem({ object, extension })` calling `extension.navigate(PAGE_ID, { namespace, select })`.

- [ ] **Step 1:** `bd init` if `.beads/` is missing; `bd create "M1-T1 skeleton + page + show-on-map"` and claim it.
- [ ] **Step 2:** Copy the template files listed above into the repo root (keep its `build/`, `test/`, configs, error-boundary components); set `package.json` name/description/repository; `pnpm install`.
- [ ] **Step 3: Write the failing test** `show-on-map.test.tsx`: rendering the item for a Deployment `{ metadata: { name: "api", namespace: "shop" } }` and clicking it calls `navigate("service-map", { namespace: "shop", select: "shop/api" })`; for a Namespace `shop` it calls `navigate("service-map", { namespace: "shop" })`.
- [ ] **Step 4:** Run `pnpm test:unit -- show-on-map` → FAIL (module missing).
- [ ] **Step 5:** Implement `show-on-map.tsx`; register in `src/renderer/index.tsx`: `clusterPages` (`id: "service-map"`), `clusterPageMenus` (title "Service map"), `kubeObjectMenuItems` for `Namespace` (`v1`) and `Deployment`/`StatefulSet`/`DaemonSet` (`apps/v1`), each mapped through the template's `withPageErrorBoundary` / `withMenuItemErrorBoundary`.
- [ ] **Step 6:** `pnpm test:unit && pnpm type:check:sources && pnpm build` → all pass, `dist/renderer.js` and `dist/main.js` exist.
- [ ] **Step 7 (spike 1):** Install the build into Freelens (`/Applications/Freelens.app`, Extensions page → local folder or `pnpm pack` tgz), open the development cluster: "Service map" appears in the sidebar; "Show on map" appears on a Deployment and a Namespace and opens the page with the params shown. Record result (go / no-go + screenshot path) in `docs/spikes/2026-11-05-feasibility.md`.
- [ ] **Step 8:** Commit `feat: extension skeleton, service map page, show-on-map`; `bd close`.

### Task 2: Spikes 2, 4, 5 — Prometheus proxy, libavoid wasm, Freelens UI calls

**Files:**
- Create: `src/renderer/diagnostics/feasibility-panel.tsx` (shown on the page behind `?diagnostics`), `src/renderer/map/libavoid.ts`
- Modify: `vite.config.mjs` (copy `node_modules/libavoid-js/dist/libavoid.wasm` into `dist/`), `docs/spikes/2026-11-05-feasibility.md`

**Interfaces:**
- Produces: `loadAvoid(): Promise<Avoid | null>` in `src/renderer/map/libavoid.ts` — loads `new URL("libavoid.wasm", import.meta.url)`, returns `null` on failure (no throw).

- [ ] **Step 1:** Button "Prometheus": `K8sApi.KubeJsonApi.forCluster(clusterId).get("/api/v1/namespaces/observability/services/prometheus-server:80/proxy/api/v1/query", { query: "up" })`; show status, result count, error text.
- [ ] **Step 2:** Button "libavoid": call `loadAvoid()`, route one connector between two rectangles around a third (the scratch test: expect 4 points `[[50,30],[50,-112],[450,-112],[450,30]]` for shapes `(0,0,100,60)`, `(400,0,100,60)`, wall `(200,-100,60,300)` with `shapeBufferDistance` 12); show the points.
- [ ] **Step 3:** Buttons "Details", "Logs", "Shell" on the first pod of `kube-system`: `Renderer.Navigation.showDetails(pod.selfLink)`, `logTabStore.createPodTab(...)`, `createTerminalTab(...)` — read the exact argument shapes from `@freelensapp/extensions` typings and record them.
- [ ] **Step 4:** `pnpm build`, reinstall, run each button on the development cluster. Record per spike: go/no-go, exact call that worked, error if not. A no-go on Prometheus proxy means M2 uses the main-process port-forward for Prometheus; a no-go on libavoid means ELK routes only (spec §7b).
- [ ] **Step 5:** Commit `chore: feasibility spikes 2,4,5`.

### Task 3: Spike 3 — Hubble Relay from the main process

**Files:**
- Create: `src/main/hubble/port-forward.ts`, `src/main/hubble/relay-client.ts`, `src/main/hubble/proto/` (Hubble `observer.proto`, `flow.proto` and imports, from `cilium/cilium` tag matching the cluster's Cilium; record the tag), `src/common/ipc.ts`
- Modify: `src/main/index.ts`, `src/renderer/diagnostics/feasibility-panel.tsx`, `vite.config.mjs` (bundle `@grpc/grpc-js` + `@grpc/proto-loader` into main), `docs/spikes/2026-11-05-feasibility.md`

**Interfaces:**
- Produces: `openPortForward(clusterId: string, ns: string, svc: string, remotePort: number): Promise<{ localPort: number; close(): void }>` (spawns `Main.Shell.getKubectlPath(clusterId)` with `getEnvironment(clusterId)`, `port-forward svc/<svc> :<remotePort> -n <ns>`, parses the "Forwarding from 127.0.0.1:<port>" line, rejects after 10 s).
- Produces: `streamFlows(target: string, opts: { namespaces?: string[]; last?: number }, onFlow: (flow: unknown) => void): () => void` (grpc `Observer.GetFlows`, follow when `last` is undefined).
- Produces IPC channel names in `src/common/ipc.ts`: `"spike:hubble"` (renderer invoke → main returns `{ ok: boolean; flows: unknown[]; error?: string }`).

- [ ] **Step 1:** Write `port-forward.test.ts` with a fake spawner: given stdout `Forwarding from 127.0.0.1:53421 -> 4245`, resolves `localPort` 53421; given exit code 1 with stderr `forbidden`, rejects with a message containing `pods/portforward`.
- [ ] **Step 2:** Run → FAIL; implement `openPortForward` with an injectable spawner; run → PASS.
- [ ] **Step 3:** Implement `streamFlows`, the IPC handler (`Main.Ipc` subclass) that port-forwards `kube-system/hubble-relay:80`, reads 20 flows with `last: 20`, closes the forward; panel button "Hubble" shows the count and the first flow's `source.namespace → destination.namespace`.
- [ ] **Step 4:** `pnpm build`, reinstall, press "Hubble" on the development cluster → 20 flows. Record go/no-go. No-go → spec §7b fallback (ship M2 with Prometheus + Kubernetes levels).
- [ ] **Step 5:** Commit `chore: spike 3 hubble relay via port-forward + grpc`.

### Task 4: Anonymized fixtures

**Files:**
- Create: `scripts/anonymize-capture.mjs`, `scripts/anonymize-capture.test.mjs`, `test/fixtures/capture-a/*`, `test/fixtures/capture-b/*`, `scripts/capture.sh`
- Modify: `vitest.config.ts` (include `scripts/**/*.test.mjs`), `.gitignore` (`captures/` raw dir)

**Interfaces:**
- Produces: `anonymize(rawDir: string, outDir: string, seed: string): void`; fixtures `test/fixtures/capture-{a,b}/{k8s.json, extra.json, policies.json, flows.jsonl, prom-cpu.json, prom-mem.json, prom-cpulim.json, prom-memlim.json}`. capture-a = 09:33 baseline, capture-b = 11:36 current.
- Produces: `scripts/capture.sh <context> <outDir>` — the read-only `kubectl get … -o json`, Hubble `--last 20000 -o jsonpb` and the four Prometheus queries used in the prototype.

- [ ] **Step 1:** The raw dumps are already in `captures/` (git-ignored): `captures/<cluster>-b/` has `flows.jsonl`, `k8s.json`, `extra.json`, `policies.json`, `prom_*.json` (11:36 UTC); `captures/<cluster>-a/` has only `flows.jsonl` (09:33 UTC baseline) — capture-a's fixture reuses capture-b's objects and metrics. The prototype's Python reference (`captures/prototype-scripts/build_graph.py`) shows the exact inventory/flow logic to port in Tasks 6–7.
- [ ] **Step 2: Write the failing tests** in `anonymize-capture.test.mjs`, run on capture-b:
  - the output contains none of: any name or range in the denylist of `captures/anonymize.json` (git-ignored);
  - the same input name maps to the same alias across all files and across capture-a and capture-b (same `seed`);
  - counts preserved: 77 workloads after inventory (Task 6 checks again), same number of flow lines, same set of ports and protocols, same `verdict` counts;
  - IPs keep their class: private → private (10.x), public → public (documentation ranges 198.51.100.0/24, 203.0.113.0/24 are fine), CIDR membership preserved (all IPs of one /24 stay in one /24);
  - Kubernetes structural names are kept: `kube-system`, `kube-dns`, `hubble-relay`, `traefik`, kinds, label keys, chart names like `postgresql-16-1.0.2`.
- [ ] **Step 3:** Run `pnpm vitest run scripts` → FAIL.
- [ ] **Step 4:** Implement `anonymize`: one alias table for namespaces (`ns-1…`), release/workload/service/pod name parts (`app-<n>`, pod hash suffixes regenerated), hostnames (`app-<n>.example.test`), cluster names (`cluster-a…`), IPv4 (/24-preserving remap), label values that equal a mapped name. Deterministic from `seed`.
- [ ] **Step 5:** Run tests → PASS; generate both fixtures with seed `"m1"`; `grep -ri` the forbidden words over `test/fixtures` → no hits.
- [ ] **Step 6:** Commit `test: anonymized cluster captures and anonymizer` (fixtures + script only).

### Task 5: Types and classification

**Files:**
- Create: `src/common/graph/types.ts` (as in File Structure), `src/common/graph/classify.ts`
- Test: `src/common/graph/classify.test.ts`

**Interfaces:**
- Produces:
  - `appForPort(proto: string, port: number | null): string`
  - `familyOf(app: string): "web" | "data" | "other"`
  - `isDatabaseName(nameAndImage: string): boolean`
  - `classifyIp(ip: string, ctx: IpContext): Endpoint` with `IpContext = { self: string; clusterCidrs: Record<string, string>; namedNetworks: Array<{ cidr: string; name: string }>; clusterIps: Record<string, { ns: string; name: string }> }`
  - `lbProvider(annotations: Record<string, string>, hostnames: string[], loadBalancerClass?: string | null): string`
  - `lbExposure(addresses: string[], publicEndpoint: string | null): "public" | "internal"`
  - `PUBLIC_ENDPOINT_ANNOTATION = "servicemap.freelens.io/public-endpoint"`

- [ ] **Step 1: Write failing tests** (`classify.test.ts`):
  - `appForPort("TCP", 5432) === "PostgreSQL"`; 27017 MongoDB; 6379 Redis; 3306 MySQL; 9092 Kafka; 5672 AMQP; 443 HTTPS; 80 and 8080 HTTP; 53 DNS; 4317 "OTLP gRPC"; 4318 "OTLP HTTP"; 7687 Bolt; 9200 Elasticsearch; `appForPort("TCP", 3003) === "TCP/3003"`; `appForPort("ICMPv4", null) === "ICMPv4"`.
  - `familyOf`: HTTP, HTTPS, "OTLP HTTP", "TCP/8080" → web; PostgreSQL, Redis, MongoDB, Kafka, AMQP, Bolt, "TCP/6432" → data; DNS, "TCP/9100", "UDP/51820" → other.
  - `isDatabaseName("shop-postgresql postgres:16")` true; `isDatabaseName("kafka-ui provectuslabs/kafka-ui")` false (names ending `-ui` excluded).
  - `classifyIp` with ctx `{ self: "dev", clusterCidrs: { dev: "10.20.19.0/24", mgmt: "10.20.21.0/24" }, namedNetworks: [{ cidr: "10.20.22.0/24", name: "SigNoz" }], clusterIps: { "10.98.0.10": { ns: "kube-system", name: "kube-dns" } } }`: `10.20.19.100` → `"@host"`; `10.20.21.5` → `"@cluster:mgmt"`; `10.98.0.10` → `"@kube-system"`; `10.20.22.110` → `"@internal:10.20.22.0/24"` (naming happens in the view, not here); `140.82.121.3` → `"@internet:140.82.121.3"`; `2001:db8::1` → `"@internet:2001:db8::1"`; `fd00::1` → `"@internal:fd00::/64"`.
  - `lbProvider({ "service.beta.kubernetes.io/scw-loadbalancer-id": "x" }, [])` → "Scaleway LB"; `lbProvider({}, ["a.elb.amazonaws.com"])` → "AWS ELB"; `lbProvider({ "lbipam.cilium.io/ips": "10.0.0.1" }, [])` → "Cilium LB-IPAM"; metallb annotation → "MetalLB".
  - `lbExposure(["10.20.19.200"], null)` → internal; `lbExposure(["10.20.17.202"], "203.0.113.2")` → public; `lbExposure(["lb.example.com"], null)` → public.
- [ ] **Step 2:** `pnpm vitest run src/common/graph/classify` → FAIL.
- [ ] **Step 3:** Implement. IPv4 /24 bucket for `@internal`, IPv6 /64; private = RFC1918, 100.64/10, fc00::/7, fe80::/10.
- [ ] **Step 4:** Run → PASS. Commit `feat(graph): types and classification`.

### Task 6: Inventory from Kubernetes objects

**Files:**
- Create: `src/common/graph/inventory.ts`, `src/common/graph/fixture.ts`
- Test: `src/common/graph/inventory.test.ts`

**Interfaces:**
- Consumes: Task 5 types and `isDatabaseName`, `lbProvider`, `lbExposure`, `PUBLIC_ENDPOINT_ANNOTATION`.
- Produces: `buildInventory(objects: KubeObjectLike[], metrics: PodMetrics): Inventory` where
  `KubeObjectLike = { kind: string; apiVersion?: string; metadata: { name: string; namespace?: string; labels?: Record<string,string>; annotations?: Record<string,string>; ownerReferences?: Array<{ kind: string; name: string }> }; spec?: any; status?: any }`,
  `PodMetrics = { cpu: Record<string, number>; mem: Record<string, number>; cpuLim: Record<string, number>; memLim: Record<string, number> }` keyed `"ns/pod"`,
  `Inventory = { namespaces: string[]; workloads: Workload[]; routes: Route[]; loadBalancers: LoadBalancer[]; policies: PolicyRef[]; podToWorkload: Record<string, string>; serviceDns: Record<string, string>; serviceDnsByPort: Record<string, string>; clusterIps: Record<string, { ns: string; name: string }> }` (`serviceDnsByPort` key `"<workloadId>|<port>"`).
- Produces: `loadFixture(name: "capture-a" | "capture-b"): { objects: KubeObjectLike[]; metrics: PodMetrics; flows: unknown[] }` (tests only).

- [ ] **Step 1: Write failing tests** against `loadFixture("capture-b")`:
  - 77 workloads; 18 of kind `KubeBlocks`; every KubeBlocks workload `db === true` and `release` = its KubeBlocks cluster name;
  - a workload whose pods are owned by a ReplicaSet maps to the Deployment (`podToWorkload["<ns>/<pod>"] === "<ns>/<deployment>"`);
  - namespaces `kube-system`, `kube-node-lease`, `kube-public`, `cilium-secrets` are excluded from `namespaces` and `workloads`;
  - 24 routes from HTTPRoutes; the route whose backend has 0 pods has `target === null` and its service equals an existing workload name (broken-route case);
  - load balancers: 2 `Service` + 1 `Gateway`; the Gateway's `provider` equals the provider of the Service with the same IP; all `exposure === "internal"`;
  - a Service annotated `servicemap.freelens.io/public-endpoint: 203.0.113.9` (add it to a cloned object in the test) → `exposure "public"`, `publicEndpoint "203.0.113.9"`;
  - Review Focus 1: `buildInventory(objects.filter(o => !["HTTPRoute","Gateway","InstanceSet","Cluster"].includes(o.kind)), metrics)` returns 59 workloads, 0 routes, no throw;
  - Review Focus 3: a bare Pod (no ownerReferences) and a Pod owned by `Job` produce no workload and no throw.
- [ ] **Step 2:** Run → FAIL. Implement (port `build_graph.py` inventory logic from the prototype session: owner chain, selector matching for Service → workload, named target ports resolved through pod container ports, Helm release from `meta.helm.sh/release-name` then `app.kubernetes.io/instance`, chart from `helm.sh/chart`).
- [ ] **Step 3:** Run → PASS. Commit `feat(graph): kubernetes inventory`.

### Task 7: Flows to edges

**Files:**
- Create: `src/common/graph/flows.ts`
- Test: `src/common/graph/flows.test.ts`

**Interfaces:**
- Consumes: `Inventory`, `classifyIp`, `appForPort`.
- Produces: `flowsToEdges(flows: unknown[], inv: Inventory, ctx: IpContext, opts?: { reverseDns?: (ip: string) => string | null; sampleLimit?: number }): { edges: RawEdge[]; windowSec: number; capturedAt: string }` — skips replies (`is_reply`), skips flows where src === dst and host→host, counts SYN-without-ACK as connections, `dropRate = drops / flows`, keeps the `sampleLimit` (default 6) most frequent samples per edge, DNS from `serviceDnsByPort` then `serviceDns` then ClusterIP map then `reverseDns` (public IPs only).

- [ ] **Step 1: Write failing tests** on `loadFixture("capture-b")` with `ctx` built from the fixture's cluster CIDR map:
  - `windowSec` between 355 and 365; `edges.length === 171` (the prototype's count on the raw capture; the anonymizer preserves structure, so a different count means the anonymizer or the port is wrong — fix that, never the number);
  - every edge with `port === 5432` has `app === "PostgreSQL"`; at least one edge has `dst` starting `@cluster:` (the mgmt cluster);
  - an edge from the DB-heaviest workload to its Postgres has a sample whose `dns` ends with `.svc.cluster.local`;
  - Review Focus 4: a synthetic flow with `IP.ipVersion: "IPv6"` and an ICMPv4 flow without `l4.TCP` produce edges with `app` "ICMPv4" / `@internet:<v6>` and no throw; a flow with no `pod_name` maps through `classifyIp`.
- [ ] **Step 2:** Run → FAIL. Implement. Run → PASS. Commit `feat(graph): hubble flows to edges`.

### Task 8: View model — aggregate, scope, refine, diff

**Files:**
- Create: `src/common/graph/view.ts`
- Test: `src/common/graph/view.test.ts`

**Interfaces:**
- Consumes: `Snapshot`, `Filters`, `Thresholds`, `MapEdge`, `familyOf`.
- Produces:
  - `mapEndpoint(ep: Endpoint, view: View, s: Snapshot, f: Filters, named: Array<{ cidr: string; name: string }>): string | null` — node ids: workload id, `ns:<ns>`, `gateway`, `internet`, `lan`, `world`, `internal`, `net:<name>`, `cluster:<name>`, `infra`.
  - `aggregate(s: Snapshot, view: View, rates: number[], f: Filters, named?: …, list?: RawEdge[]): MapEdge[]` — includes gateway route edges (`HTTP`, broken flag when target has 0 ready pods), LB entry edges from `internet` (public) or `lan` (internal).
  - `scope(edges: MapEdge[], s: Snapshot, view: View, hops: 0 | 1 | 2): MapEdge[]` — n+1 = links touching the namespace's workloads plus entry links into kept nodes.
  - `refine(edges: MapEdge[], s: Snapshot, view: View, f: Filters, t: Thresholds): { edges: MapEdge[]; keep: Set<string> | null }`.
  - `diff(current: MapEdge[], baseline: MapEdge[]): MapEdge[]`.
  - `isProblem(w: Workload, t: Thresholds): boolean`; `shortName(w: Workload): string`.
  - `pipeline(s, view, rates, f, hops, t, baseline?: RawEdge[]): { edges: MapEdge[]; keep: Set<string> | null }`.

- [ ] **Step 1: Write failing tests** on the capture-b snapshot (inventory + flows):
  - cluster view (`view null`, `NO_FILTERS`): every node id is `ns:*`, `lan`, `world`, `internal`, `cluster:*` or `infra` (infra only with `f.infra`); no edge has `source === target`;
  - namespace view of the fixture namespace that has 12 workloads (alias of the "shop" namespace) at `hops 1`: no edge where neither end is one of its workloads except edges whose source is `lan`/`internet`; at `hops 0` strictly more edges;
  - broken route: the gateway → validation-alias edge is `synthetic` with `routes[0].path === "/api/validations/"`-alias and the target has `ready 0`;
  - `f.apps = new Set(["DNS"])` removes every edge whose only app is DNS;
  - `f.problems`: kept nodes include every workload with `restarts >= 1`;
  - `f.exposed` at cluster view: every kept edge is within 2 hops downstream of `lan`/`internet`, and none ends at `world` or `internal`;
  - `diff` of capture-b vs capture-a at cluster view: at least one `change: "new"` and one `"gone"` edge; `diff(x, x)` is empty;
  - `shortName` of `{ name: "shop-mongodb-mongodb", release: "shop-mongodb" }` → `"mongodb"`; with `release: null` → unchanged;
  - Review Focus 2: `aggregate({ ...snapshot, edges: [] }, null, [], NO_FILTERS)` returns only synthetic route/LB edges and does not throw;
  - Review Focus 5: a namespace with no workloads yields `[]` from `scope` and no throw.
- [ ] **Step 2:** Run → FAIL. Implement by porting the prototype's `mapEp/aggregate/scope/refine/diff/pipeline` (functions are named the same there). Run → PASS.
- [ ] **Step 3:** Commit `feat(graph): view model`.

### Task 9: Layout

**Files:**
- Create: `src/renderer/map/layout.ts`
- Test: `src/renderer/map/layout.test.ts`

**Interfaces:**
- Consumes: `MapEdge`, `shortName`.
- Produces: `layoutGraph(view: View, nodes: LayoutNode[], edges: MapEdge[], opts: { space: number; dir: "RIGHT" | "LEFT" }): Promise<{ nodes: RfNode[]; routes: Record<string, Point[]>; abs: Record<string, Point> }>`;
  `LayoutNode = { id: string; type: "card" | "ns" | "ext"; w: number; h: number; group?: string }`;
  `cardHeight(w: Workload): number` → 122, or 138 when `shortName(w).length > 24`; ns card 100; ext 56; card width 230, ns 210, ext 180.
  `RfNode` = React Flow node: release boxes `type "grp"`, children `parentId`, `extent: "parent"`, `draggable: false`.
- ELK options (exact): `elk.algorithm layered`, `elk.direction <dir>`, `elk.hierarchyHandling INCLUDE_CHILDREN`, `elk.spacing.nodeNode 28*space`, `elk.layered.spacing.nodeNodeBetweenLayers 110*space`, `elk.spacing.componentComponent 40*space`, `elk.spacing.edgeNode 20*space`, `elk.layered.crossingMinimization.strategy LAYER_SWEEP`, `elk.layered.thoroughness 60`, `elk.layered.crossingMinimization.greedySwitch.type TWO_SIDED`, `elk.layered.nodePlacement.strategy NETWORK_SIMPLEX`, `elk.edgeRouting ORTHOGONAL`, `elk.spacing.edgeEdge 10`, `elk.layered.spacing.edgeEdgeBetweenLayers 12`, `elk.json.edgeCoords ROOT`; layer constraint FIRST for `internet`/`lan` and pure sources, LAST for `world`/`internal`/`net:*` and pure sinks; release boxes shrink-wrapped to their cards with padding 16 (sides, bottom) and 40 (top).

- [ ] **Step 1: Write failing tests** with capture-b at `hops 0, 1, 2` for the three biggest fixture namespaces and the cluster view: no two leaf nodes overlap; no leaf outside a box overlaps a box; inside every box, min child x − box x = 16, box bottom − max child bottom = 16, min child y − box y = 40; a workload with a 30-character short name gets height 138.
- [ ] **Step 2:** Run → FAIL. Implement. Run → PASS (elkjs runs in Node).
- [ ] **Step 3:** Commit `feat(map): layout`.

### Task 10: Kubernetes-only map page

**Files:**
- Create: `src/renderer/map/k8s-source.ts`, `src/renderer/map/nodes.tsx`, `src/renderer/map/edges.tsx`, `src/renderer/map/service-map.module.scss`, `src/renderer/icons/k8s/*.svg`
- Modify: `src/renderer/map/service-map-page.tsx`, `package.json` (add `@xyflow/react`, `elkjs` as dependencies)
- Test: `src/renderer/map/service-map-page.test.tsx` (jsdom), `src/renderer/map/k8s-source.test.ts`

**Interfaces:**
- Consumes: `buildInventory`, `pipeline`, `layoutGraph`, `cardHeight`, `PAGE_ID` params.
- Produces: `loadK8sSnapshot(clusterId: string, list: (apiPath: string) => Promise<KubeObjectLike[] | null>): Promise<Snapshot>` — `list` returns `null` on 404/403 (missing CRD or RBAC); lists: deployments, statefulsets, daemonsets, pods, services, ingresses (`networking.k8s.io/v1`), httproutes + gateways (`gateway.networking.k8s.io/v1`), instancesets (`workloads.kubeblocks.io/v1` then `apps.kubeblocks.io/v1alpha1`), clusters (`apps.kubeblocks.io/v1`), networkpolicies, ciliumnetworkpolicies, ciliumclusterwidenetworkpolicies. Snapshot `edges: []`, metrics empty.
- Produces: `ServiceMapPage({ extension, params })` — breadcrumb (cluster › namespace), cluster view ↔ namespace view on double-click, `?namespace=` and `select` honored, "Data: Kubernetes only" label, tokens from Freelens CSS variables (`--mainBackground`, `--contentColor`, `--textColorPrimary`, `--borderColor`, `--blue`; light via `body.theme-light`), status bar + glyph on cards, link colors per `familyOf` (blue web, teal data, gray other, red broken), orthogonal rounded edges from `routes`.

- [ ] **Step 1: Write failing tests:** `loadK8sSnapshot` with a fake `list` that returns `null` for every CRD path → Snapshot with 59 workloads (Review Focus 1) and no throw; page test renders capture-b's snapshot (edges cleared) and shows one card per namespace and the text "Kubernetes only" (Review Focus 2); with `params.namespace` set to the 12-workload namespace it renders 12 cards and a "(no Helm release)" box.
- [ ] **Step 2:** Run → FAIL. Implement, porting node/edge visuals and CSS tokens from the prototype (spec §3 "Visual design"); the Kubernetes API calls go through `K8sApi.KubeJsonApi.forCluster(clusterId).get(path)` in the real `list`.
- [ ] **Step 3:** `pnpm test:unit && pnpm type:check:sources && pnpm build` → PASS.
- [ ] **Step 4:** Install in Freelens, open the development cluster → cluster view with 13 namespace cards; double-click the 12-workload namespace → release boxes with cards, gateway routes drawn as gray dashed "HTTP" links; "Show on map" on a Deployment opens it selected. Screenshot into `docs/spikes/`.
- [ ] **Step 5:** Commit `feat(map): kubernetes-only service map page`.

---

## Roadmap after M1 (each gets its own plan once M1 is merged)

- **M2 — Live data:** main-process Hubble aggregator (rolling 5-min window, namespace-filtered streams, sampling), Prometheus client (proxy or port-forward per spike 2), Data menu with ✓/✗ and the exact missing permission, fallback levels, local snapshots for Changes (24 h retention, "since opened" fallback), reverse DNS in main, other-cluster CIDR cache from connected clusters.
- **M3 — Full UI:** details panel (all sections in spec §3), toolbar rows, search, quick views, Filters panel, Layout menu, Settings dialog + `appPreferences`, persistence (ExtensionStore keyed by cluster), libavoid routing with live drag re-route, particles/reduced motion, Policy layer, Changes view, All-clusters view, export PNG/SVG + anonymize, Freelens actions (details/logs/shell/YAML), "Show on map" selection focus.
- **M4 — Release:** README (features, data sources, minimal ClusterRole, the public-endpoint annotation, icon attribution), CI from the template, `pnpm pack` + npm publish, Freelens extension catalog listing.
