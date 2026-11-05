# Feasibility spikes — 2026-11-05

Environment: Freelens 2.0.0 (Homebrew cask, macOS), the development cluster ("Development"), extension 0.1.0-0 installed from the local `.tgz` (status "unverified": local tarball has no checksum).

Screenshots show real cluster names and IPs, so they are kept out of the repository.

## Spike 1 — page, sidebar entry, "Show on map": GO

- "Service map" appears in the cluster sidebar and opens the extension page.
- "Show on map" in a Deployment's row menu opens the page with `namespace=shop`, `select=shop/backend`.
- "Show on map" on a Namespace row opens the page with `namespace=pipeline` and no selection.
- Page params: registering `params: { namespace: "", select: "" }` on the cluster page and reading `params.<name>.get()` works.

## Spike 2 — Prometheus through the Kubernetes service proxy: GO

`Renderer.K8sApi.KubeJsonApi.forCluster(clusterId).get("/api/v1/namespaces/observability/services/prometheus-server:80/proxy/api/v1/query", { query: { query: "up" } })` → `status: success`, 43 series. No port-forward needed for Prometheus.

## Spike 4 — libavoid WebAssembly from the extension bundle: GO

`libavoid.wasm` emitted next to `dist/renderer.js` by a Vite plugin, loaded with `AvoidLib.load(new URL("libavoid.wasm", import.meta.url).href)`. Orthogonal route around an obstacle: `[[50,30],[50,-112],[450,-112],[450,30]]` — identical to the Node test.

## Spike 5 — Freelens UI calls: calls accepted (visual check deferred)

- Details: `Renderer.Navigation.showDetails(pod.selfLink)` — no error.
- Logs: `Renderer.Component.logTabStore.createPodTab({ selectedPod, selectedContainer })` (Pod from `K8sApi.podsApi.list`, container from `pod.getContainers()[0]`) — no error.
- Shell: `Renderer.Component.createTerminalTab({ title })` returns `{ id }` — no error. A pod shell needs a command sent with `terminalStore.sendCommand` (M3).
- Screenshots did not show the drawer/dock opening; M3 verifies each action visually when the real buttons exist.

## Spike 3 — Hubble Relay from the main process: GO

- `Main.Shell.getKubectlPath(clusterId)` + `getEnvironment(clusterId)` → `kubectl port-forward svc/hubble-relay :80 -n kube-system --address 127.0.0.1`; local port parsed from "Forwarding from 127.0.0.1:<port>".
- `@grpc/grpc-js` + `@grpc/proto-loader` with Cilium v1.20.2 `api/v1/{observer,flow,relay}` protos (copied to `dist/hubble-proto/`), insecure channel (Relay is plaintext on this cluster).
- `GetFlows({ number: 20, follow: false })` returned **120 flows**: Relay applies `number` per node (6 nodes). M2 must treat `number` as per-node.
- Result reached the page through `Main.Ipc.handle` / `Renderer.Ipc.invoke` (`spike:hubble`). Some flows have no namespace on either side (host/world), as expected.

## M1 check — Kubernetes-only map in Freelens 2.0.0

- Cluster view of the development cluster: 13 namespace cards, "Data: Kubernetes only".
- Double-click the 12-workload namespace: 12 workload cards in 5 release boxes including "(no Helm release)"; gateway routes drawn as gray dashed "HTTP" links, the route to a backend with no ready pods in red.
- "Show on map" on the `shop/backend` Deployment opens the namespace with the card selected.
- The page must be an `observer`: the host keeps it mounted across navigation and only changes the params.

## M2 check — live data in Freelens 2.0.0

- Installed as a `.tgz` with a new version (`0.1.0-m2.1`): disabling and enabling an extension keeps its old main module (Node caches it by path), so a main-process change needs a new version or a Freelens restart.
- Data menu: `Data: Hubble + Prometheus`; Kubernetes ✓, Prometheus ✓ (found by name), Hubble Relay ✓ live, with the L7 hint (the cluster has no L7 visibility).
- Links carry live rates (DNS links at a few hundredths of a flow per second on this quiet cluster); workload cards show CPU and RAM with % of limit where limits exist, and flows/s equal to the sum of their links.
- Leaving the page closed the `kubectl port-forward svc/hubble-relay` within 4 s (unsubscribe on unmount); reopening started a new one.
- Killing the port-forward while the page was open: a new one ran within 4 s, rates stayed on screen, status back to ✓.
- After 5 minutes a snapshot file existed under the extension's data folder (`<clusterId>/snapshots/<epoch-ms>.json`), and the reopened page's Data menu said `Changes baseline: snapshot from <HH:MM>`; before that it said `since the map was opened`.
- No extension errors in the main or renderer logs.

## M3 check — full UI in Freelens 2.0.0

- Installed as `.tgz` `0.1.0-m3.1`; the build ships `dist/libavoid.wasm` and loads without errors.
- Toolbar: both rows present in spec order (breadcrumb, Color by, Layout, Data, Settings; quick views, Filters, Reset); Data menu `Hubble + Prometheus`.
- Cluster view: 14 namespace cards; drill-in to the 12-workload namespace shows its cards, 5 draggable release boxes and the routed links.
- Details panel on a workload: Open in Freelens, Logs and Shell buttons; sections Exposed via, Network policy, Pods, Labels, Inbound and Outbound peers. Logs opens a log tab in Freelens' dock (the visual check M1 spike 5 deferred).
- No extension errors in the main or renderer logs. Not checked by hand in this run: live re-routing while dragging, PNG/SVG export output, the All-clusters view with several catalog clusters.
