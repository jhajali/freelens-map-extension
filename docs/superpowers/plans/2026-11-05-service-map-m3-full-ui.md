# Service Map — Milestone 3: Full UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The map becomes the full tool the spec describes: a details panel with Freelens actions, two toolbar rows (Color by, n+1/n+2/all, search, quick views incl. Changes, Filters, Layout, Data, Settings), per-cluster settings and remembered view state, libavoid routing with draggable boxes, particles, the Policy layer, the All-clusters view, and PNG/SVG export with anonymized names.

**Architecture:** View state (filters, hops, layer, positions, layout prefs) and per-cluster settings live in one `Common.Store.ExtensionStore` keyed by cluster id, loaded in main and renderer. The page keeps its M2 data path (`LiveMap` → `pipeline` → ELK) and gains a toolbar, a details panel and a routing step: ELK places nodes once, libavoid routes links around boxes (re-routed while dragging, or on drag end above the size threshold). All new logic that is not drawing lives in pure functions under `src/common/graph/` and is tested against the fixtures.

**Tech Stack:** as M2, plus `libavoid-js` 0.5.0-beta.5 (re-added; WebAssembly bundled as in M1 spike 4) and `html-to-image` (export).

**Spec:** `docs/superpowers/specs/2026-11-05-service-map-design.md` — read §3 in full (it is the UI spec), §4 "Problems" and "Changes", §5, §6, §7 (Renderer, Theme, Settings, WebAssembly), §9. The throwaway prototype `.superpowers/brainstorm/18030-1793871128/content/prototype-live.html` shows every panel and menu; port behaviour, not code style. M2 plan for conventions and the live data path: `docs/superpowers/plans/2026-11-05-service-map-m2-live-data.md`.

## Global Constraints

- Everything in the M1 and M2 Global Constraints still holds (Freelens `^2.0.0`, read-only toward cluster resources, `src/common/graph/**` pure, every registration in an error boundary, local commits only, one `bd` issue per task, no emoji in source).
- Colors (spec §3): **blue = web/API, teal = databases, caches, queues, gray = other**; red only for drops and broken routes; in Changes mode green new, gray dashed gone. Health is a left status bar **plus a shape** (● ok, ▲ busy, ■ trouble), never color alone. Palette "color-blind safe" swaps good/warn/crit to `#0072B2`/`#E69F00`/`#D55E00` (prototype `[data-palette="cb"]`).
- Lines 1.25–3 px by rate; small fixed-size arrowheads; particles whose count/speed follow the rate, off under `prefers-reduced-motion`; at most 4 particles per link and 300 on screen.
- Details panel: right side, resizable 320 px – 70 % of the page width, collapsible.
- Toolbar (spec §3): Row 1 `breadcrumb · Color by (CPU / RAM / Pod health / Traffic / Policy) · Show n+1/n+2/all · Layout ▾ · Data ▾ · Settings`; Row 2 `search · Quick views (Problems, Exposed, Egress, Databases, Drops, Changes) · Filters ▾ · Reset`. One button style (Freelens `Renderer.Component.Button`/`Icon` or the module's chip class), one monochrome icon set (the prototype's Lucide paths).
- Search highlights and zooms, never hides.
- Cards inside a release box cannot be dragged; the box can. Other boxes are draggable. Dragged positions are remembered per view and per n+1/n+2/all, only for nodes actually dragged.
- libavoid re-routes live while dragging up to ~150 nodes / ~400 links; above that, on drag end. If libavoid fails to load, ELK routes are used.
- Settings per cluster (spec §6): problem thresholds; named networks (CIDR = name); public endpoint per LB (in addition to the annotation `servicemap.freelens.io/public-endpoint`); palette (default / color-blind safe); anonymize names; data source overrides (Hubble Relay service, Prometheus service/URL). A short global entry in `appPreferences`; the full dialog on the map page.
- Fonts: Freelens' `--font-main` and `--font-monospace`; no web fonts. Theme from Freelens CSS variables (M1 tokens); colors an SVG/canvas export cannot read from CSS come from `Renderer.Theme.activeTheme`.
- Big clusters (spec §5): panel tables show at most 200 rows with a "show all" control.

## Decisions taken in this plan (check these)

- **"YAML" action = Freelens' details drawer.** Freelens 2.0 exports `showDetails` but no edit-resource tab; the drawer's own Edit button is one click away. The panel shows "Open in Freelens", "Logs", "Shell" (spec §3 lists "Open in Freelens, Logs, Shell, YAML").
- **Filters' "time window" is out of M3.** The Relay window is one per cluster in main (M2); a per-viewer window would need one window per subscriber. The panel states the window ("last 5 min").
- **Changes baseline**: M2's `BASELINE` answer, converted to a `Snapshot` with the current inventory. The "since the map was opened" fallback is improved here: the renderer keeps its own first snapshot once its window is ≥ 300 s, and asks main again after every 5 minutes (M2 deferred minor).
- **Export** uses `html-to-image` (`toPng`, `toSvg`) on the React Flow viewport, the method React Flow documents; a new dependency outside the Freelens catalog (Renovate exclusion in M4).
- **No theme item in the Layout menu.** Spec §3 lists "theme" in the Layout menu, and §3 "Visual design" says the map follows Freelens' theme (light and dark); Freelens has its own theme switch, so the map follows it and offers none of its own.
- **All-clusters view** lists `Renderer.Catalog.getAllClusters()`; this cluster is live, other clusters are cards with "Connect" (navigates to `/cluster/<id>`), cross-cluster links come from this cluster's `@cluster:<name>` endpoints. No connection is opened by the extension (spec §7b).

## Review Focus

1. **A cluster whose stored state is from an older version, or corrupt** (missing keys, a namespace or workload that no longer exists in remembered positions/filters) — defaults fill in, unknown ids are ignored, the page renders. → Task 1 test.
2. **Many dragged nodes, then the cluster changes** (a workload deleted, a release renamed) — remembered positions of missing nodes are ignored, never applied to other nodes; the layout stays overlap-free. → Task 15 test.
3. **Panel on a selection that disappears** (the workload is scaled away, the link expires from the window) — the panel shows "no longer on the map" instead of crashing or showing stale numbers. → Task 10 test.
4. **Search for a name that matches nothing, or matches hundreds** — nothing hidden, no zoom when 0 hits, zoom to fit all hits otherwise. → Task 6 test.
5. **Anonymized export** — no real namespace, workload, release, host, label value or IP string appears anywhere in the exported SVG text (including tooltips and edge labels). → Task 19 test.

---

## File Structure

```text
src/common/store/map-store.ts        ServiceMapStore (ExtensionStore): per-cluster settings + view state, defaults, migration
src/common/graph/layers.ts           score(workload, layer, ...) for Color by; policy verdicts
src/common/graph/history.ts          RateHistory: per-edge and per-node rate ring buffers for sparklines
src/common/graph/anonymize.ts        stable aliases for names/IPs (display and export)
src/common/graph/search.ts           matchNodes(query, nodes, s) → ids
src/common/graph/inventory.ts        (modify) public-endpoint overrides
src/common/ipc.ts                    (modify) SubscribeRequest.relay override
src/main/collector.ts                (modify) Relay override target
src/renderer/map/toolbar.tsx         two toolbar rows; owns no state (props in, callbacks out)
src/renderer/map/filters-menu.tsx    Filters ▾
src/renderer/map/layout-menu.tsx     Layout ▾ (spacing, explode, flip, reset positions, labels, export, anonymize)
src/renderer/map/settings-dialog.tsx Settings dialog
src/renderer/map/preferences.tsx     appPreferences Input/Hint
src/renderer/map/panel/panel.tsx     resizable, collapsible panel shell + selection dispatch
src/renderer/map/panel/workload.tsx  workload details
src/renderer/map/panel/link.tsx      link details
src/renderer/map/panel/namespace.tsx namespace and outside-node details
src/renderer/map/panel/parts.tsx     Tile, Bar, Spark, Pills, Peers, LbTable, capped Table
src/renderer/map/actions.ts          Freelens actions: open details, logs, shell
src/renderer/map/routing.ts          libavoid routes around boxes (re-added loader + router)
src/renderer/map/particles.tsx       moving particles on links
src/renderer/map/export.ts           PNG/SVG export
src/renderer/map/clusters.ts         All-clusters view model from the catalog
src/renderer/map/view-state.ts       useViewState hook over the store (filters, hops, layer, positions, prefs)
src/renderer/map/service-map-page.tsx (modify) composes all of the above
```

Shared types (Task 1 defines them in `src/common/store/map-store.ts`; later tasks import them):

```ts
export type Layer = "cpu" | "ram" | "health" | "traffic" | "policy";
export type Hops = 0 | 1 | 2;                       // 0 = all links
export interface StoredFilters { hiddenNs: string[]; labels: Array<[string, string | null]>; apps: string[]; kinds: string[];
  direction: Direction; minRate: number; hideIdle: boolean; infra: boolean;
  problems: boolean; exposed: boolean; dbs: boolean; drops: boolean; changes: boolean; egress: boolean }
export interface LayoutPrefs { space: number /*1*/; dir: "RIGHT" | "LEFT"; labels: boolean /*true*/; explode: boolean /*false*/; panelWidth: number /*380*/ }
export interface ClusterSettings { thresholds: Thresholds; namedNetworks: NamedNetworks; lbPublic: Record<string, string>;
  palette: "default" | "cb"; anonymize: boolean;
  relay: { ns: string; svc: string; port: number } | null; prometheus: { ns: string; name: string; port: number } | null }
export interface ClusterRecord { settings: ClusterSettings; filters: StoredFilters; hops: Hops; layer: Layer; layout: LayoutPrefs;
  positions: Record<string, Record<string, { x: number; y: number }>> }   // key `${view ?? ""}|${hops}` → node id → position
export const DEFAULT_RECORD: ClusterRecord;  // thresholds DEFAULT_THRESHOLDS, hops 1, layer "health", palette "default", rest empty/false
export function toFilters(f: StoredFilters): Filters;   // arrays → Sets; `egress` → direction "outbound"
```

---

### Task 1: Settings and view-state store

**Files:**
- Create: `src/common/store/map-store.ts`, `src/common/store/map-store.test.ts`
- Modify: `src/main/index.ts`, `src/renderer/index.tsx` (load the store in both `onActivate`), `test/freelens-extensions.ts` (stub as small as the test needs)

**Interfaces:**
- Produces: the shared types above; `class ServiceMapStore extends Common.Store.ExtensionStore<{ clusters: Record<string, ClusterRecord> }>` with `@observable accessor clusters`, `record(clusterId): ClusterRecord` (stored record merged over `DEFAULT_RECORD`, deep for `settings`, `filters`, `layout`), `update(clusterId, patch: Partial<ClusterRecord>): void`, `fromStore`/`toJSON` per the ExtensionStore contract; `configName: "service-map"`.
- Follows AGENTS.md "Decorators": `@observable accessor`, no `makeObservable`.

- [ ] **Step 1: Write failing tests:** `"fills defaults for a cluster with no record"`; `"keeps clusters apart"`; `"merges a partial or older record over the defaults"` (a stored record missing `layout` and `settings.palette` → defaults present, stored values kept — Review Focus 1); `"ignores a corrupt record"` (`clusters: { c1: "x" }` → `DEFAULT_RECORD`); `"toFilters turns arrays into sets and egress into outbound"`.
- [ ] **Step 2:** `./.superpowers/pnpm exec vitest run src/common/store` → FAIL.
- [ ] **Step 3:** Implement; load it in main and renderer (`ServiceMapStore.getInstanceOrCreate().loadExtension(this)`).
- [ ] **Step 4:** Same → PASS; `./.superpowers/pnpm test:unit`, `tsc -p src/main`, `-p src/renderer`, `-p environment-tests` → clean.
- [ ] **Step 5:** Commit `feat(store): per-cluster settings and view state`.

### Task 2: Settings reach the data path

**Files:**
- Modify: `src/common/graph/inventory.ts` (+test), `src/common/ipc.ts`, `src/main/collector.ts` (+test), `src/renderer/map/live-map.ts` (+test)

**Interfaces:**
- Consumes: `ClusterSettings` (Task 1).
- Produces:
  - `buildInventory(objects, metrics, opts?: { lbPublic?: Record<string, string> })` — `lbPublic["ns/name"]` acts like the `servicemap.freelens.io/public-endpoint` annotation on that Service (annotation wins when both are set).
  - `SubscribeRequest.relay?: { ns: string; svc: string; port: number }` — the collector's port-forward target (default `kube-system/hubble-relay:80`); a change of target restarts the collector.
  - `LiveMap` constructor gains `settings: () => ClusterSettings` (read on every load/subscribe): named networks into `IpContext.namedNetworks`, `relay` into SUBSCRIBE, `prometheus` overrides discovery, `lbPublic` into `buildInventory`.

- [ ] **Step 1: Write failing tests:** inventory `"a public-endpoint setting makes an internal LB public"`; collector `"port-forwards to the configured Relay service"` and `"restarts when the Relay target changes"`; live-map `"uses the Prometheus override instead of discovery"` and `"sends named networks with the subscription"`.
- [ ] **Step 2:** `./.superpowers/pnpm exec vitest run src/common/graph/inventory.test.ts src/main/collector.test.ts src/renderer/map/live-map.test.ts` → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Same → PASS; `./.superpowers/pnpm test:unit` → PASS.
- [ ] **Step 5:** Commit `feat: settings drive inventory, Relay and Prometheus`.

### Task 3: Settings dialog and the preferences entry

**Files:**
- Create: `src/renderer/map/settings-dialog.tsx` (+test, jsdom), `src/renderer/map/preferences.tsx` (+test)
- Modify: `src/renderer/index.tsx` (`appPreferences`)

**Interfaces:**
- Consumes: `ServiceMapStore`, `ClusterSettings`.
- Produces: `SettingsDialog({ clusterId, open, onClose })` — sections: Problems (CPU %, RAM %, restarts), Named networks (one `CIDR = name` per line), Public endpoints (one `ns/service = endpoint` per line), Palette (default / color-blind safe), Anonymize names, Data sources (Relay `ns/service:port`, Prometheus `ns/service:port`, empty = auto); Save writes `store.update`; invalid lines are listed under their field and nothing is saved.
  - `parseNamedNetworks(text): { value: NamedNetworks; errors: string[] }`, `parsePublicEndpoints(text)`, `parseService(text): { ns, name, port } | null | "invalid"` exported for tests.
- `appPreferences`: one entry, title `Service map`, Input = a "Color-blind safe palette by default" checkbox stored as the default for clusters without a record, Hint = `Per-cluster settings are on the map page (Settings).`.

- [ ] **Step 1: Write failing tests:** `"parses named networks and reports bad lines"` (`10.0.0.0/24 = lab` ok; `10.0.0/24 = x` → error naming line 2); `"parses ns/service:port"`; dialog `"saves valid settings"` and `"does not save while a field is invalid"`.
- [ ] **Step 2:** `./.superpowers/pnpm exec vitest run src/renderer/map/settings-dialog.test.tsx src/renderer/map/preferences.test.tsx` → FAIL.
- [ ] **Step 3:** Implement with Freelens `Renderer.Component.Dialog`, `Input`, `Checkbox`, `Button` (stubbed minimally in `test/freelens-extensions.ts`).
- [ ] **Step 4:** Same → PASS.
- [ ] **Step 5:** Commit `feat(map): settings dialog and preferences entry`.

### Task 4: View state, filters and n+1/n+2/all

**Files:**
- Create: `src/renderer/map/view-state.ts` (+test)
- Modify: `src/renderer/map/service-map-page.tsx` (+test)

**Interfaces:**
- Consumes: `ServiceMapStore`, `toFilters`, `pipeline` (M1: `pipeline(s, view, rates, f, hops, t, baseline?, named?)`).
- Produces: `useViewState(clusterId): { record: ClusterRecord; set: (patch: Partial<ClusterRecord>) => void; reset: () => void }` (an `observer`-safe hook reading the store); the page passes `toFilters(record.filters)`, `record.hops`, `record.settings.thresholds`, `record.settings.namedNetworks` to `pipeline` and `nodesFor` instead of `NO_FILTERS`/`1`/`DEFAULT_THRESHOLDS`/`[]`. `reset()` restores filters, hops and layer to `DEFAULT_RECORD` (positions and settings are kept).

- [ ] **Step 1: Write failing tests:** `"hops 0 shows links n+1 hides"` (capture-b, the 12-workload namespace: more edges at hops 0 than 1); `"a hidden namespace disappears from the cluster view"`; `"state survives a remount"` (set hops 2, unmount, mount → hops 2).
- [ ] **Step 2–4:** FAIL → implement → PASS (`./.superpowers/pnpm exec vitest run src/renderer/map`).
- [ ] **Step 5:** Commit `feat(map): remembered filters and scope`.

### Task 5: Toolbar rows

**Files:**
- Create: `src/renderer/map/toolbar.tsx` (+test), icons as a `ICONS` path map in the same file (prototype `ICONS`)
- Modify: `src/renderer/map/service-map-page.tsx`, `src/renderer/map/service-map.module.scss`

**Interfaces:**
- Produces: `Toolbar(props: { crumbs: Array<{ label: string; onClick?: () => void }>; layer: Layer; onLayer; hops: Hops; onHops; quick: Record<"problems"|"exposed"|"egress"|"dbs"|"drops"|"changes", boolean>; onQuick(key); onReset; search: string; onSearch; onSearchEnter; menus: { layout: ReactNode; data: ReactNode; filters: ReactNode }; onSettings })` — Row 1 and Row 2 exactly as Global Constraints; the breadcrumb reads `All clusters › <cluster> › <namespace>`; quick-view chips are toggle buttons with `aria-pressed` and the prototype's help text as `title`.
- The page owns state; the toolbar has none.

- [ ] **Step 1: Write failing tests:** `"renders both rows in spec order"` (accessible names in order); `"toggles a quick view"`; `"the breadcrumb navigates"` (All clusters → view `@clusters`, cluster → `null`).
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5:** Commit `feat(map): toolbar`.

### Task 6: Search

**Files:**
- Create: `src/common/graph/search.ts` (+test)
- Modify: `src/renderer/map/service-map-page.tsx`, `src/renderer/map/nodes.tsx`

**Interfaces:**
- Produces: `matchNodes(query: string, ids: string[], nameOf: (id: string) => string): Set<string>` — case-insensitive substring on the displayed name; empty query → empty set. The page dims non-matching nodes (`opacity 0.28`) and outlines matches while a query is set; Enter zooms to fit all matches (`rf.fitView({ nodes, padding: 0.4, duration: 400, maxZoom: 1.3 })`) and does nothing with 0 matches; Escape clears. Nothing is hidden.

- [ ] **Step 1: Write failing tests:** `"matches displayed names case-insensitively"`; `"no match zooms nowhere"` and `"hundreds of matches fit all of them"` (page test with a spy on `fitView` — Review Focus 4).
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5:** Commit `feat(map): search highlights and zooms`.

### Task 7: Quick views and Changes

**Files:**
- Modify: `src/renderer/map/live-map.ts` (+test), `src/renderer/map/service-map-page.tsx` (+test), `src/renderer/map/edges.tsx`

**Interfaces:**
- Consumes: `refine` quick views (M1: `problems`, `exposed`, `dbs`, `drops`, `changes` on `Filters`), `diff`, `BASELINE`.
- Produces:
  - Quick views map to `StoredFilters` flags; "Egress" sets `direction: "outbound"` (via `toFilters`), so Egress and the Filters menu's direction stay one setting.
  - `LiveState.baseline` becomes a `Snapshot` (`toSnapshot(current inventory, baseline flows, …)`) plus `baselineLabel: string` (`snapshot from HH:MM` / `since HH:MM (map opened)` / `none yet`); the renderer keeps its own first snapshot whose `windowSec ≥ 300` as the "since opened" fallback and asks `BASELINE` again every 5 minutes.
  - `DataMenu` (M2) shows `Changes baseline: <baselineLabel>`.
  - Changes mode draws `change: "new"` links green (`--new`), `"gone"` gray dashed (`--gone`), label prefixed `+ new` / `− gone`; with no baseline the Changes chip is disabled with the title `No baseline yet`.

- [ ] **Step 1: Write failing tests:** live-map `"keeps its own baseline once the window is 5 minutes"`, `"asks main again after 5 minutes"`; page `"Changes shows new and gone links"` (baseline = capture-a, current = capture-b: both kinds present); `"Changes is disabled without a baseline"`.
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5:** Commit `feat(map): quick views and Changes`.

### Task 8: Filters menu

**Files:**
- Create: `src/renderer/map/filters-menu.tsx` (+test)

**Interfaces:**
- Produces: `FiltersMenu({ s: Snapshot; filters: StoredFilters; onChange: (f: StoredFilters) => void })` — sections (prototype "Filters" menu): Namespaces (checkbox list, all/none), Protocols (from the snapshot's apps, most common first, plus `HTTP route`; a "Hide DNS" shortcut), Kind (Deployment, StatefulSet, DaemonSet, KubeBlocks, Database), Direction (all/inbound/outbound/internal), Min traffic (`flows/s`, number) + Hide idle, Node/API-server traffic (`infra`), Labels (`key` or `key=value` per line, ANDed). The window is stated as text: `Window: last 5 min`.

- [ ] **Step 1: Write failing tests:** `"hide DNS removes DNS from apps"`; `"labels parse key and key=value"`; `"lists namespaces of the snapshot"`.
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5:** Commit `feat(map): filters menu`.

### Task 9: Color by layers and the Policy layer

**Files:**
- Create: `src/common/graph/layers.ts` (+test)
- Modify: `src/renderer/map/nodes.tsx`, `src/renderer/map/edges.tsx`, `src/renderer/map/service-map.module.scss` (palette `cb`)

**Interfaces:**
- Produces:
  - `score(w: Workload, layer: Layer, ctx: { thresholds: Thresholds; traffic: number; prometheus: boolean; protectedNs: (ns: string) => boolean }): number` in `[0,1]` (prototype `score`: cpu = cpu/cpuLim else cpu/0.5; ram = mem/memLim else mem/1 GiB; health = 1 not ready, 0.7 restarts ≥ threshold, else 0; traffic = flows/s ÷ 2; policy = 0 protected, 1 default-allow; cpu/ram are 0 without Prometheus). Tone: `< 0.6` good ●, `< 0.85` warn ▲, else crit ■.
  - `protectedNamespaces(policies: PolicyRef[]): (ns: string) => boolean` — true when any `CiliumClusterwideNetworkPolicy` exists, or a NetworkPolicy/CiliumNetworkPolicy is in `ns`.
  - `linkVerdict(e: MapEdge, s: Snapshot, protectedNs): "dropped" | "protected" | "default-allow"` — dropped when `drops/rate > 0.01`; protected when the target's namespace is protected; else default-allow. In the Policy layer, links color by verdict: dropped crit, protected `--l-data`, default-allow `--l-other` dashed.
  - The page's `layer` (Task 4 store) drives cards, namespace cards (worst of its workloads) and, for `policy`, links.

- [ ] **Step 1: Write failing tests:** `score` per layer with the prototype's values (e.g. cpu 0.425 of a 0.5 limit → 0.85 → ■); `"cpu and ram are neutral without Prometheus"`; `protectedNamespaces` with and without a clusterwide policy; `linkVerdict` three cases.
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5:** Commit `feat(map): color layers and policy verdicts`.

### Task 10: Details panel shell and selection

**Files:**
- Create: `src/renderer/map/panel/panel.tsx` (+test), `src/renderer/map/panel/parts.tsx` (+test)
- Create: `src/common/graph/history.ts` (+test)
- Modify: `src/renderer/map/service-map-page.tsx`, `src/renderer/map/live-map.ts`

**Interfaces:**
- Produces:
  - `RateHistory` — `push(edges: MapEdge[], t: number)`, `edge(id): number[]`, `node(id): number[]` (sum of in+out), 60 points max (2.5 min at the M2 tick); `LiveState.history: RateHistory` (one instance per LiveMap, updated per tick).
  - `Panel({ selection, … })` — right side, width persisted in the store layout prefs (`panelWidth`, default 380, clamped 320 px … 70 %), drag grip on its left edge, fold button collapses to 12 px. `selection: { kind: "workload" | "link" | "namespace" | "outside"; id: string } | null`; with no selection it shows the prototype's overview (tiles: workloads, links, routes; source line: cluster, window, Data level).
  - Selection: click a node or link selects it; pane click clears; the `select` page param selects and zooms to that node (`fitView` on it, `maxZoom 1.3`) when it is on the map ("Show on map" focus).
  - A selection whose id is no longer on the map shows `<name> is no longer on the map` (Review Focus 3).
  - `parts.tsx`: `Tile`, `Bar` (used/limit, tone by %), `Spark` (`values: number[]`, `collecting…` under 2 points), `Pills`, `Sec` (collapsible section with count), `CappedTable` (200 rows, then `Show all <n>`).

- [ ] **Step 1: Write failing tests:** history `"keeps 60 points per edge and sums nodes"`; panel `"resizes within 320 px and 70 %"`, `"collapses"`, `"says when the selection is gone"`; page `"select param zooms to the node"`; parts `"CappedTable shows 200 rows then a show-all button"`.
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5:** Commit `feat(map): details panel shell and selection`.

### Task 11: Freelens actions

**Files:**
- Create: `src/renderer/map/actions.ts` (+test)
- Modify: `test/freelens-extensions.ts` (stubs for `Navigation.showDetails`, `Component.logTabStore`, `Component.createTerminalTab`, `Component.terminalStore`, `K8sApi.podsApi`)

**Interfaces:**
- Produces (shapes from M1 spike 5, `docs/spikes/2026-11-05-feasibility.md`):
  - `selfLink(w: Workload): string` — `/apis/apps/v1/namespaces/<ns>/<deployments|statefulsets|daemonsets>/<name>`; KubeBlocks → `/apis/apps.kubeblocks.io/v1/namespaces/<ns>/clusters/<name>`.
  - `openInFreelens(w)` → `Renderer.Navigation.showDetails(selfLink(w))`.
  - `openLogs(w)` → the first ready pod of `w.pods` from `K8sApi.podsApi.get({ name, namespace })`, then `logTabStore.createPodTab({ selectedPod, selectedContainer: pod.getContainers()[0] })`.
  - `openShell(w)` → `const tab = createTerminalTab({ title: "<ns>/<pod>" }); terminalStore.sendCommand("kubectl exec -it -n <ns> <pod> -- sh -c 'command -v bash >/dev/null && exec bash || exec sh'", { enter: true, tabId: tab.id })`.
  - Every action catches and reports its error through `Renderer.Component.Notifications.error` instead of throwing into the panel.

- [ ] **Step 1: Write failing tests:** `selfLink` for each kind; each action calls the stubbed host function with the right arguments; `"a failing action shows a notification"`.
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5:** Commit `feat(map): open details, logs and shell from the map`.

### Task 12: Workload details

**Files:**
- Create: `src/renderer/map/panel/workload.tsx` (+test)

**Interfaces:**
- Consumes: `parts.tsx`, `actions.ts`, `RateHistory`, `isProblem`, `linkVerdict`/`protectedNamespaces`, the view's `MapEdge[]`.
- Produces: `WorkloadDetails({ w, s, edges, history, thresholds, prometheus, onSelect })` — spec §3 order: header (kind icon, name, kind/chart, pills: status (`Ready`/`Degraded`/`Problem`), `DB`, release), actions (Open in Freelens, Logs, Shell), tiles (pods `ready/desired`, restarts, in/s, out/s), live sparkline (node history), CPU/RAM bars vs limits (or `CPU/RAM need Prometheus`), Exposed via (LBs targeting it; HTTPRoutes/Ingress with host+path), Network policy (`protected by <kind> <name>` list or `▲ No NetworkPolicy … default allow`), Inbound/Outbound peers (click → select link), Pods table (name, phase, restarts, CPU, RAM — capped), Labels.

- [ ] **Step 1: Write failing tests** (capture-b): a workload with restarts shows the `Problem` pill and its restart tile; peers list both directions and clicking one calls `onSelect` with the link id; a workload without limits shows `(no limit)` bars; a KubeBlocks workload shows its chart.
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5:** Commit `feat(map): workload details`.

### Task 13: Link details

**Files:**
- Create: `src/renderer/map/panel/link.tsx` (+test)

**Interfaces:**
- Produces: `LinkDetails({ e: MapEdge, s, history, protectedNs, l7, onSelect })` — header `source → target` (each clickable), protocol pills (top apps with share), tiles (flows/s, connections/s, drop %), sparkline (edge history), Latency & errors (`needs L7 visibility: enable it in Cilium to see HTTP codes and latency` when `!l7`; with L7 data in samples, the codes it has), Policy verdict, Load balancer table (IP, ports, via; public/internal pill), HTTPRoutes (host, path, backend service, `▲ no ready pods` when broken), Connections (sample rows: `srcPod/IP → dstPod/IP:port`, DNS name, count — capped).

- [ ] **Step 1: Write failing tests:** a gateway route link lists host, path and a broken flag; a DB link lists samples with their Service DNS name; without L7 the latency section shows the enable hint.
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5:** Commit `feat(map): link details`.

### Task 14: Namespace and outside-node details

**Files:**
- Create: `src/renderer/map/panel/namespace.tsx` (+test)

**Interfaces:**
- Produces: `NamespaceDetails({ ns, s, edges, history, protectedNs, onSelect, onOpen })` — tiles (workloads, pods ready/desired, CPU, RAM), entry points (LBs and routes into it), Network policy, Helm releases (chart, pods), links; "Open" drills in. `OutsideDetails({ id, s, edges, onSelect })` — endpoints with DNS names (from samples), entry points (for `internet`/`lan`), links.
- Namespace cards gain the prototype's `CPU · RAM` totals row when Prometheus is ok (M2 deferred ruling).

- [ ] **Step 1: Write failing tests:** namespace details list its releases with charts; `world` details list public IPs with their reverse-DNS names from samples.
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5:** Commit `feat(map): namespace and outside details`.

### Task 15: libavoid routing, draggable boxes, remembered positions

**Files:**
- Create: `src/renderer/map/routing.ts` (+test, Node: libavoid's wasm loads in Node as in M1 spike 4)
- Modify: `package.json` (`libavoid-js` `0.5.0-beta.5`), `vite.config.mjs` (re-add the `libavoidWasm` plugin from M1 git history `361217c:vite.config.mjs`), `src/renderer/map/service-map-page.tsx`, `src/renderer/map/edges.tsx`

**Interfaces:**
- Produces:
  - `loadAvoid(): Promise<Avoid | null>` (M1 `src/renderer/map/libavoid.ts` restored from `361217c`, `new URL("libavoid.wasm", import.meta.url)`; `null` on failure → ELK routes).
  - `avoidRoutes(A: Avoid, boxes: Array<{ id: string; x: number; y: number; w: number; h: number; obstacle: boolean }>, edges: Array<{ id: string; source: string; target: string }>): Record<string, Point[]>` — orthogonal routing, `shapeBufferDistance 12`, `idealNudgingDistance 10`, one pin per side chosen by the router; release boxes are not obstacles, cards/namespace/outside nodes are; the router is deleted after each call.
  - Dragging: release boxes and non-card nodes are draggable; cards inside a box are not. During a drag, routes are recomputed per animation frame when the view has ≤ 150 nodes and ≤ 400 links, else on drag end. On drag end, the node's position is stored under `positions["<view>|<hops>"][id]`; on layout, stored positions override ELK's for ids still present, unknown ids are ignored (Review Focus 2). Layout menu "Reset positions" (Task 18) clears the current key.

- [ ] **Step 1: Write failing tests:** routing `"routes around an obstacle"` (the spike's case: `[[50,30],[50,-112],[450,-112],[450,30]]` or an equivalent path that avoids the box); `"release boxes are not obstacles"`; page/positions `"remembered positions apply only to nodes still present"` (store holds a position for a deleted workload → ignored, other nodes keep ELK positions, no two leaves overlap).
- [ ] **Step 2–4:** FAIL → implement → PASS; `vite build` emits `dist/libavoid.wasm`; knip clean.
- [ ] **Step 5:** Commit `feat(map): libavoid routing and draggable boxes`.

### Task 16: Particles and link styling

**Files:**
- Create: `src/renderer/map/particles.tsx` (+test)
- Modify: `src/renderer/map/edges.tsx`

**Interfaces:**
- Produces: `particlesFor(rate: number, reduced: boolean): { count: number; durSec: number }` — prototype: `count = reduced ? 0 : rate > 0 ? min(1 + floor(rate*2), 4) : 0`, `dur = max(0.9, 5/(1+rate))`; `Particles({ path, color, count, dur })` as SVG `<circle><animateMotion>`; a page-level budget of 300 particles (links sorted by rate, the rest get 0); `prefers-reduced-motion` read once via `matchMedia`. Selection dims unrelated links to 12 % opacity (prototype `focus`).

- [ ] **Step 1: Write failing tests:** `particlesFor` values; `"reduced motion draws no particles"`; `"the budget caps particles at 300"`.
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5:** Commit `feat(map): particles`.

### Task 17: Theme and palette

**Files:**
- Modify: `src/renderer/map/service-map.module.scss`, `src/renderer/map/service-map-page.tsx`

**Interfaces:**
- Produces: the page root gets `data-palette="cb"` when the cluster's palette is color-blind safe (overrides `--good`, `--warn`, `--crit`); fonts from `--font-main` / `--font-monospace`; `themeColors(): Record<string, string>` reads `Renderer.Theme.activeTheme.get().colors` for export (Task 19). Light/dark follow Freelens (`body.theme-light`), no own theme switch (spec §3 "follows Freelens' theme"). Keyboard focus visible on every control (`:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px }`).

- [ ] **Step 1: Write failing test:** `"the color-blind palette is set from settings"` (attribute present).
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5:** Commit `feat(map): palette and theme`.

### Task 18: Layout menu

**Files:**
- Create: `src/renderer/map/layout-menu.tsx` (+test)

**Interfaces:**
- Produces: `LayoutMenu({ prefs: LayoutPrefs; onChange; onResetPositions; onExport: (kind: "png" | "svg") => void; anonymize: boolean; onAnonymize })` — spacing slider (0.6–2, step 0.1, → `layoutGraph` `space`), Explode (ignore release boxes: every card at the root, `group` dropped in `nodesFor`), Flip direction (`RIGHT`/`LEFT`), Reset positions, Link labels on/off, Export PNG / Export SVG, Anonymize names. Changing spacing/explode/direction re-runs the layout.

- [ ] **Step 1: Write failing tests:** each control calls its callback; `"explode removes release boxes"` (page: no `grp` nodes).
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5:** Commit `feat(map): layout menu`.

### Task 19: Anonymized names and export

**Files:**
- Create: `src/common/graph/anonymize.ts` (+test), `src/renderer/map/export.ts` (+test)
- Modify: `package.json` (`html-to-image`, pinned exact), `src/renderer/map/nodes.tsx`, `edges.tsx`, panel files (names through one `nameOf`)

**Interfaces:**
- Produces:
  - `aliases(s: Snapshot): (kind: "ns" | "svc" | "db" | "release" | "cluster" | "net" | "host" | "ip", real: string) => string` — stable per snapshot: `namespace-1`, `svc-3`, `db-2`, `release-1`, `cluster-1`, `net-1`; hostnames → `host-<n>`; IPs → `ip-<n>`; generic outside labels (`Internet`, `Gateway`, …) unchanged.
  - With "Anonymize names" on (setting), every visible name goes through it: cards, boxes, labels, panel, search (search matches aliases).
  - `exportMap(el: HTMLElement, kind: "png" | "svg", colors: Record<string, string>): Promise<Blob>` via `html-to-image` (`toPng`/`toSvg`, background `--mainBackground`), saved with a download link named `service-map-<cluster or alias>-<YYYYMMDD-HHMM>.<ext>`.

- [ ] **Step 1: Write failing tests:** aliases are stable and distinct; `"anonymized export contains no real name"` (render capture-b's namespace view with anonymize on into jsdom, serialize `el.outerHTML` the way `toSvg` would embed it, and assert none of the snapshot's namespace, workload, release, route host, label value or IP strings occurs — Review Focus 5).
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5:** Commit `feat(map): anonymized names and export`.

### Task 20: All-clusters view

**Files:**
- Create: `src/renderer/map/clusters.ts` (+test)
- Modify: `src/renderer/map/service-map-page.tsx`, `src/renderer/map/nodes.tsx`, `src/renderer/map/layout.ts` (`nodesFor` for `@clusters`)

**Interfaces:**
- Produces: `clusterNodes(all: Array<{ id: string; name: string; status: string }>, self: string, edges: MapEdge[]): LayoutNode[]` — one `ext` card per catalog cluster (`cluster:<name>`), self solid-bordered "this cluster · double-click", others dashed "not live here · Connect"; links from `aggregate(s, "@clusters", …)` (M1 `mapEndpoint` already maps to `cluster:<name>`). Double-click self → cluster view; "Connect" on another → `Renderer.Navigation.navigate("/cluster/<id>")`. The breadcrumb's `All clusters` opens this view (`?namespace=@clusters`).

- [ ] **Step 1: Write failing tests:** `"lists every catalog cluster and marks this one"`; `"draws cross-cluster links seen from here"` (capture-b has `@cluster:` endpoints).
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5:** Commit `feat(map): all-clusters view`.

### Task 21: Check in Freelens

**Files:** none (results in `docs/spikes/2026-11-05-feasibility.md`, section "M3 check"; no cluster names, IPs or screenshots committed)

- [ ] **Step 1:** Build, pack with a new version (M2 check note), install, open the development cluster.
- [ ] **Step 2:** Toolbar: each Row 1 and Row 2 control works; quick views narrow the map; Changes shows new/gone against the baseline; search highlights and zooms.
- [ ] **Step 3:** Panel: select a workload, a link, a namespace, the Internet node; each section from spec §3 is present; Open in Freelens, Logs and Shell open the host's drawer/dock tabs (the visual check M1 spike 5 deferred).
- [ ] **Step 4:** Drag a release box: links re-route live; leave and reopen the page: the box is where it was; Reset positions restores ELK's layout.
- [ ] **Step 5:** Settings: set a named network and a threshold; reopen Freelens' preferences entry; palette switch changes the status colors; anonymized PNG and SVG exports open and show no real names.
- [ ] **Step 6:** All clusters: every catalog cluster listed, this one live; light theme follows Freelens.
- [ ] **Step 7:** No extension errors in the main and renderer logs. Commit `docs: M3 check in Freelens`.

---

## Roadmap after M3

- **M4 — Release:** README (features, data sources, minimal ClusterRole incl. `pods/portforward` and `services/proxy`, the public-endpoint annotation, settings), Kubernetes icon attribution in README and NOTICE, CI from the template, map-page integration sessions on kind, Renovate exclusions (`libavoid-js`, `@grpc/*`, `elkjs`, `@xyflow/react`, `html-to-image`), `pnpm pack` + npm publish, Freelens extension catalog listing.
- **Later:** per-viewer time window; Hubble-metrics traffic without Relay; TLS Relay; namespace-filtered Relay streams; naming the exact policy behind a verdict; live data for every cluster in the All-clusters view.
