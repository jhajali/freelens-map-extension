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
