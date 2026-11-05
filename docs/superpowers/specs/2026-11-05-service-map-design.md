# Freelens Service Map — design

Date: 2026-11-05 · Status: draft for approval · Prototype: `.superpowers/brainstorm/*/content/prototype-live.html` (throwaway, built on a real capture of the development cluster)

## 1. Intent

A Freelens extension that replaces "too many tables" with a live map of a cluster: namespaces, then the services inside them, who talks to whom, which service uses which database, what comes in from outside and what leaves. Kiali-like, but inside Freelens and not tied to a service mesh.

Why: the user runs several services per namespace and cannot see connectivity and activity from tables. Success = open the map, see in seconds where traffic flows and where something is wrong, then click through to the real Freelens object.

It will be published for the Freelens community, so it must work on clusters unlike the author's.

## 2. Goals, non-goals, anti-goals

Goals
- Two zoom levels: cluster (namespaces) → namespace (Helm releases → workloads), plus an "All clusters" level.
- Live traffic on links: protocol, throughput, drop/error rate; moving particles.
- Entry and exit points: LoadBalancers, Gateway API routes, Ingress; egress to the Internet, to internal networks, to other known clusters.
- Health and resource layers (CPU, RAM, pod health, traffic, network policy).
- Works with Cilium + Hubble first; degrades gracefully without them.

Non-goals (v1)
- Editing anything in the cluster (read-only extension).
- Being a metrics/alerting product: no long-term storage, no alert rules.
- Tracing (spans); service-mesh specific features (Istio/Linkerd adapters are a later data source, not v1).

Anti-goals — it fails even if it "works" when:
- Normal traffic looks like an error (red/orange hues on healthy links). Red means only "something is wrong".
- The map is a hairball: unrelated namespaces shown just because they share a gateway; nodes stacked on each other; links cutting through boxes.
- It needs an in-cluster install, an agent, or write permissions.
- The UI feels foreign inside Freelens (own theme, own fonts, inconsistent buttons).

## 3. What the user decided (and the prototype validated)

Layout and navigation
- Cluster view: one card per namespace. Double-click opens the namespace. Breadcrumb: All clusters › cluster › namespace.
- Namespace view: workloads grouped in boxes by **Helm release** (label `app.kubernetes.io/instance` / annotation `meta.helm.sh/release-name`; KubeBlocks clusters as their own release); box label shows release + chart version. Cards inside a box show the name without the release prefix (`shop-mongodb-mongodb` → `mongodb`).
- Columns: **inbound on the left → services in the middle → outbound on the right** (flip available). Entry points pinned first, exits pinned last.
- Namespace scope **"n+1" by default**: only links touching the namespace's own workloads, plus the entry path (LB → gateway → service). Toggle n+1 / n+2 / all links. Links between two outside nodes are never shown at n+1.
- Cards inside a release box cannot be dragged; the box can. Other boxes are draggable; dragged positions are remembered per view and per n+1/n+2/all, only for nodes actually dragged.

Nodes
- Official Kubernetes icons (kubernetes/community, CC-BY-4.0 — attribution required).
- Card: kind, ready/desired replicas as dots, restarts, CPU and RAM (with % of limit), traffic rate; DB tag for databases.
- Health shown as a thin left status bar **plus a shape** (● ok, ▲ busy, ■ trouble) — never color alone.
- Outside nodes (dashed): Internet (inbound), Internal network (inbound), Internet (egress), Internal network, named networks, other clusters, other namespaces, the gateway.

Links
- Colored by traffic family, two calm hues validated for color-blindness on Freelens surfaces: **blue = web/API**, **teal = databases, caches, queues**, gray = other (DNS, unknown ports). Red only for drops and broken routes. In "Changes" mode: green new, gray dashed gone.
- Label on the link: protocol + rate (+ drop %). Gateway routes show just "HTTP"; host/path live in the details panel.
- Thin lines (1.25–3 px by rate), small fixed-size arrowheads, glowing particles whose count/speed follow the rate (off with reduced motion).
- Routing: ELK layered layout with thorough crossing minimization and network-simplex placement; **libavoid** (WebAssembly) routes every link orthogonally around boxes with shared pins and nudging, and re-routes live while dragging.

Details panel (right, resizable 320 px–70 %, collapsible)
- Workload: status/DB/release pills, actions (Open in Freelens, Logs, Shell, YAML), tiles (pods, restarts, in/s, out/s), live sparkline, CPU/RAM bars vs limits, exposed via LoadBalancer / HTTPRoute (host+path links), network policy, inbound/outbound peers (click → select link), pods table, metadata/labels.
- Link: source → target (clickable), protocol pills, tiles, sparkline, latency & errors (needs L7), policy verdict, load balancer, HTTPRoutes (host, path, backend, broken flag), connections (pod/IP → pod/IP:port + DNS name).
- Namespace: tiles, entry points, network policy, Helm releases with chart and pods, links.
- Outside node: endpoints with DNS names, entry points, links.

Toolbar (two rows, one button style, one monochrome icon set)
- Row 1: breadcrumb · Color by (CPU / RAM / Pod health / Traffic / Policy) · Show n+1/n+2/all · Layout ▾ · Data ▾ · Settings.
- Row 2: search (highlights + zoom, never hides) · Quick views (Problems, Exposed, Egress, Databases, Drops, Changes) · Filters ▾ (namespaces, protocols with "hide DNS", kind, direction, min traffic + hide idle, node/API-server traffic, labels, time window) · Reset.
- Layout menu: spacing, explode, direction flip, reset positions, link labels, theme, export PNG/SVG, anonymize names.

Visual design
- Follows Freelens' theme (light and dark), Freelens grays and blue accent, Roboto family (Roboto Flex); personality spent only on the traffic. Status colors reserved for status. Keyboard focus visible; reduced motion respected.

## 4. Data model and sources

Normalized graph, built in the extension, independent of the source:
- Nodes: workload (Deployment, StatefulSet, DaemonSet, KubeBlocks InstanceSet/Cluster; owner chain Pod → ReplicaSet → Deployment), namespace, gateway, entry/exit pseudo-nodes, other clusters, named networks.
- Edges keyed by (source, target, protocol/port): flows/s, connections/s, drops, samples (pod IP ↔ pod IP:port + DNS name), plus declared edges (routes, LBs) that have no observed flow.

Sources, in order of richness (all read-only):
1. **Hubble Relay** (gRPC `GetFlows`, follow mode, aggregated in a rolling window) → flows, protocols, drops, verdicts, L7 when enabled.
2. **Prometheus** (HTTP API) → CPU/RAM per pod (`container_cpu_usage_seconds_total`, `container_memory_working_set_bytes`, `kube_pod_container_resource_limits`); Hubble metrics if exported (rates without Relay).
3. **Kubernetes API** → workloads, pods, Services, Endpoints, Ingress, Gateway API (Gateway, HTTPRoute, TCPRoute, GRPCRoute), LoadBalancer status, KubeBlocks CRDs, NetworkPolicy / CiliumNetworkPolicy, Helm labels, kubeconfig contexts (Freelens' cluster list).

Fallback levels shown in the **Data** menu with ✓/✗ per source and a one-line fix (e.g. "enable L7 visibility for HTTP codes and latency"):
- Hubble + Prometheus: everything.
- Prometheus only: resources; traffic only if Hubble metrics are exported.
- Kubernetes only: topology from Services, routes, LBs; no live traffic, no resources.

Classification rules (validated on real data)
- Protocol from L7 when present, else from port (5432 PostgreSQL, 27017 MongoDB, 6379 Redis, 9092 Kafka, 5672 AMQP, 443 HTTPS, 80/8080 HTTP, 53 DNS, 4317/4318 OTLP, 7687 Bolt…), else `TCP/<port>`.
- Destination name: Service DNS name for pod endpoints (selector match, named target ports resolved), Service ClusterIP → service name, Hubble FQDN when DNS visibility is on, else reverse DNS for public IPs.
- External IPs: other cluster if inside a known cluster's node CIDR (ClusterMesh identity first, then node IPs of kubeconfig clusters the user can read), named network from settings, private → "Internal network", public → "Internet".
- LoadBalancer exposure: public if any address is public or a hostname; else internal. Provider from annotations (Scaleway, AWS, GCP, Azure, MetalLB, Cilium LB-IPAM). A private LB fronted by an external LB (e.g. Scaleway in front of LB-IPAM) is made public by the **annotation `servicemap.freelens.io/public-endpoint`** on the Service (author's choice by default; a per-cluster setting can do the same).
- Gateway address belongs to the LB Service with the same IP.
- Problems: not ready, restarts ≥ threshold, CPU/RAM above % of limit (thresholds in settings), drops > 1 %, route with no ready pods.
- Changes (user decision): the main process saves small aggregated snapshots (edge keys + rates, no samples) to the extension's file folder while Freelens runs, per cluster, pruned after 24 h. Baseline = the snapshot closest to 24 h ago, else the oldest available; with no history yet, fall back to "since the map was opened". The panel always says which baseline is used.

## 5. Constraints

- Read-only Kubernetes permissions; no agent, no CRD, no in-cluster component.
- Must run inside Freelens' renderer/main process model and its security policy (see §7).
- Big clusters: aggregate in a background worker; cluster view is always namespace-level; namespace view only loads its own neighborhood; cap particles; virtualize panel tables.
- Community distribution: npm-installable Freelens extension, MIT (or the license the author picks), icon attribution for the Kubernetes icons.

## 6. Settings (per cluster)

Problem thresholds; named networks (CIDR = name); public endpoint per LB (in addition to the annotation); palette (default / color-blind safe); anonymize names; data source overrides (Hubble Relay service, Prometheus service/URL).

## 7. Freelens integration

Target: **Freelens 2.0** (`@freelensapp/extensions` ^2.0.0, released 2026-10-28). Sources: `freelensapp/freelens` main (`docs/extensions/api.md`, `packages/core/src/extensions/…`) and the official template `freelensapp/freelens-example-extension`. The API is 8 days old at time of writing — pin `engines.freelens: ^2.0.0` and expect minor churn.

Scaffolding (verified from the template)
- Start from `freelensapp/freelens-example-extension`: pnpm, Vite 8 (two builds: renderer and `--mode main`), ESM, Node ≥ 24, TypeScript. React is provided by the host and never bundled.
- Ship as an npm package / `.tgz` installable from the Extensions page (also the `freelens://app/extensions/install/<name>` deep link).

Renderer (verified API shapes)
- `clusterPages` + `clusterPageMenus`: a "Service map" page in the cluster sidebar.
- `kubeObjectMenuItems`: **"Show on map"** on Namespace (`v1`) and Deployment/StatefulSet/DaemonSet (`apps/v1`), using the extension's `navigate(pageId, params)` to open the map at that namespace with the object selected.
- Details panel actions: "Open in Freelens" = `Renderer.Navigation.showDetails(selfLink)`; Logs = `logTabStore.createWorkloadTab` / `createPodTab`; Shell = `Renderer.Component.createTerminalTab`. Exact argument shapes to be confirmed in the first spike.
- Every registered component wrapped in our own error boundary (the host has none around pages, drawers and menu items) — a panel bug shows an error in place, never a blank page.

Theme (verified)
- Read `Renderer.Theme.activeTheme` (mobx; `type: "dark" | "light"`, `colors`) and use Freelens' CSS variables (`--mainBackground`, `--contentColor`, `--textColorPrimary`, `--blue`, `--borderColor`, …; `body.theme-light` in light mode). Our tokens (§3) are defined _in terms of_ these variables; only the traffic and status palettes are ours.
- Font: Freelens' `--font-main` (Roboto) and `--font-monospace`; no web-font download.
- Styling: CSS Modules + `var(--…)` (host Tailwind does not reach extensions). Canvas/SVG colors that cannot use CSS variables are read from `activeTheme.colors`, as the official resource-map extension does.

Kubernetes API (verified for built-ins and Gateway API; KubeBlocks/Cilium follow the same pattern, untested)
- Built-in kinds through `Renderer.K8sApi` apis/stores; CRDs (Gateway API, KubeBlocks `apps.kubeblocks.io`, `cilium.io` policies) through `LensExtensionKubeObject` subclasses or path requests with `K8sApi.KubeJsonApi.forCluster(clusterId)`. Missing CRDs are normal (not every cluster has them) and simply switch features off.
- Other clusters for the All-clusters view come from Freelens' catalog (`Renderer.Catalog`).

Live data path (to prove first — unverified)
- **Prometheus:** first try the Kubernetes service proxy through `KubeJsonApi.forCluster(id).get("/api/v1/namespaces/<ns>/services/<svc>:<port>/proxy/api/v1/query?…")`; if that fails, fall back to the main-process port-forward below. Prometheus service auto-discovered (common names/labels), overridable in settings.
- **Hubble Relay:** the extension API exposes no port-forward, so the **main process** (`Main.LensExtension`) spawns `kubectl port-forward` using `Main.Shell.getKubectlPath(clusterId)` and `getEnvironment(clusterId)`, then streams `GetFlows` with `@grpc/grpc-js` and the Hubble observer protos. Aggregation (rolling window, classification, sampling) runs in main — off the UI thread — and the renderer receives a compact aggregated graph over the extension IPC (`Main.Ipc.handle/broadcast` ↔ `Renderer.Ipc.invoke/listen`) on each tick. Port-forwards are reference-counted per cluster and closed when the map page is not open.
- Without a reachable Relay or Prometheus, the fallback levels in §4 apply automatically and the Data menu says why.

Settings (verified mechanism)
- `Common.Store.ExtensionStore` (loaded in both main and renderer `onActivate`), keyed by cluster id (no built-in per-cluster store); a short global entry in `appPreferences`; the full settings dialog lives on the map page. Remembered filters and dragged positions use the same store.

WebAssembly (no blocker found in source; untested)
- Freelens' CSP allows `'unsafe-eval'` and its `freelens-extension://` scheme serves `.wasm` as `application/wasm` with fetch/CORS enabled, so libavoid's `.wasm` is **bundled with the extension** and loaded via `new URL("libavoid.wasm", import.meta.url)` — no CDN at runtime. If loading fails, the map falls back to ELK routes.

Prior art
- The official `freelens-resource-map-extension` (force-directed graph of pods/workloads/services/ingress/Helm with `react-force-graph-2d`). It has no traffic, layering or Hubble; ours is a different tool. No Hubble/Cilium flow map exists for Freelens today.

Feasibility spikes that open the build (each a go/no-go)
1. Hello-world page + "Show on map" menu item + theme variables in Freelens 2.0.
2. Prometheus query through the service proxy from the renderer.
3. Main-process `kubectl port-forward` + `@grpc/grpc-js` `GetFlows` from Hubble Relay, streamed to the renderer over IPC.
4. libavoid `.wasm` loaded from the extension bundle.
5. `showDetails`, logs tab and terminal tab argument shapes.

## 7b. Calls made during review (author's calls — check these)

- **"Read-only" means no writes to cluster resources.** Opening a port-forward (`create pods/portforward`) and using the service proxy (`get services/proxy`) are allowed — Freelens' own port-forward feature needs the same. If RBAC denies them, the affected source shows ✗ in the Data menu with the exact missing permission, and the map falls back a level. The README documents a minimal ClusterRole.
- **Hubble Relay TLS:** plaintext Relay (Cilium's default) works out of the box. For TLS/mTLS Relay, the extension reads the client cert Secret only if RBAC allows it; otherwise the user can point settings at cert files; otherwise Relay shows ✗ "TLS enabled, client certs not readable".
- **Other clusters:** the extension never connects to clusters on its own. The All-clusters view lists every catalog cluster, shows live data only for clusters already connected in Freelens, and offers "Connect" for the rest. The "other cluster" egress class uses node CIDRs cached from clusters the user has connected before.
- **If spike 3 (Relay) fails:** v1 still ships with Prometheus + Kubernetes levels (topology, routes, LBs, resources; traffic from Hubble metrics when exported), and the Relay path becomes the first follow-up. If spike 4 (libavoid) fails, ELK routes are used.
- **Size target for v1:** a cluster of 50 namespaces / 1,000 workloads / 2,000 flows/s stays responsive. Namespace view up to ~150 nodes and ~400 links with live re-routing; above that, re-routing happens on drag end instead of during the drag. Relay is queried with namespace filters for the namespace view, cluster-wide (sampled) only for the cluster view.

## 8. Left to the builder

- Internal module boundaries, state management, test strategy (but: pure graph-building and classification logic must be unit-tested against recorded fixtures like the prototype's capture).
- Test fixtures (user decision): the recorded capture from the author's cluster is **anonymized before it is committed** — namespaces, workload/release names, hostnames, labels and IPs replaced consistently (structure, ports, protocols, rates and counts kept), via a small script that is itself committed so new captures go through it.
- Exact ELK/libavoid tuning values (start from the prototype's).
- Rolling-window size and refresh cadence (start: 5-minute window, UI tick 2.5 s).

## 9. In v1 at the depth the prototype showed (user: "add them all")

Policy layer and per-link verdict (protected / default-allow / dropped); Changes view (new/gone links vs a baseline window); latency & errors section (filled when L7 is on, otherwise explains how to enable it); All-clusters view (this cluster live, others from kubeconfig with cross-cluster links seen from here); export PNG/SVG with anonymize; remembered filters and dragged positions; settings page; fallback levels.

Deeper versions are v2: naming the exact policy that allowed/denied a link; "changed since last deploy"; live data for every cluster in the All-clusters view (ClusterMesh or one connection per context); Istio/Linkerd/Prometheus-only adapters.
