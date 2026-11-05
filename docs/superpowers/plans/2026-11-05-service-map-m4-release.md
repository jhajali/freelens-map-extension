# Service Map — Milestone 4: Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Version 0.1.0 of `freelens-service-map-extension` is documented, checked in CI against Freelens dev on kind, published to npm and proposed to the Freelens marketplace.

**Architecture:** No new product code. The README and NOTICE describe the extension as built in M1 to M3. Renovate learns which dependencies Freelens does not have. The template's integration helpers lose their `Example` CRD code and gain map-page sessions on a kind cluster without Cilium, where the map runs on its Kubernetes-only level. The template's tag and release workflows publish. The marketplace listing is a pull request to `freelensapp/freelens-marketplace`.

**Tech Stack:** as M3; Vitest + Playwright over CDP for the integration sessions (template pattern); kind 0.33.0 / Kubernetes 1.37.0 (pinned in `integration-tests.yaml`).

**Spec:** `docs/superpowers/specs/2026-11-05-service-map-design.md`, especially §2 (what it is not), §4 (LoadBalancer exposure, the public-endpoint annotation), §6 (settings), §7b (permissions, Relay TLS, other clusters), §9 (fixtures). The M3 plan's "Roadmap after M3" line is the scope: `docs/superpowers/plans/2026-11-05-service-map-m3-full-ui.md:408`. Template conventions: `AGENTS.md` ("Workflows" and the integration test section after it).

## Global Constraints

- Everything in the M1 to M3 Global Constraints still holds (Freelens `^2.0.0`, read-only toward cluster resources, every registration in an error boundary, one `bd` issue per task, no emoji in source or Markdown).
- **Local commits only.** Pushing to GitHub, creating a tag, publishing to npm and opening the marketplace PR are outward actions: each is a separate step that waits for the user's go.
- Commit messages are plain sentences, no Conventional Commits prefix (`AGENTS.md`).
- **No real cluster data in the repository**: no real cluster names, IPs, hostnames or screenshots of real clusters. Screenshots, if any, come from the kind cluster of the integration sessions or from the anonymized fixtures.
- Toolchain on this machine: `./.superpowers/pnpm` (pnpm 12 launcher), Node 24 from nvm on `PATH`; nested `pnpm <script>` fails, so run tools with `./.superpowers/pnpm exec <tool>` or `dlx`.
- Package name `freelens-service-map-extension` (free on npm as of 2026-11-05). Repository `https://github.com/jhajali/freelens-map-extension` (public).

## Decisions taken in this plan (check these)

- **The minimal ClusterRole ships as a file**, `deploy/service-map-reader.yaml`, which the README embeds and links. It has `get`, `list` on exactly the lists in `src/renderer/map/k8s-source.ts` (`LISTS`, `INSTANCE_SETS`, `nodes`), `create` on `pods/portforward` and `get` on `pods` (for the Hubble Relay port-forward), and `get` on `services/proxy` (Prometheus). The spec's "the user can scope portforward to kube-system" is a README note, not a second file.
- **No Secret access and no TLS Relay in 0.1.0.** The code reads no Secret: a TLS Relay shows ✗ "TLS enabled, client certs not readable" (spec §7b fallback). The README says so; TLS stays in "Later".
- **Integration sessions run without Cilium.** kind's default CNI has no Hubble, so the map shows the Kubernetes-only level and the Data menu shows Hubble ✗. That is what most first-time users see, and it needs no Cilium install in CI. Traffic rendering stays covered by the unit tests on the anonymized captures.
- **A missing Hubble Relay is not an error in the logs.** The sessions fail on any `error:` line in the main log. A cluster without Relay is a normal state shown in the Data menu, so if the collector logs it at error level, the level drops to warn (Task 3, Step 4).
- **Marketplace icon** is the extension's `MapIcon` SVG rendered to a 256x256 PNG with Playwright (already a devDependency); no new tool.
- **First publish uses an `NPM_TOKEN` repository secret.** The template's release workflow takes the token when set and otherwise uses provenance via OIDC, which npm only allows for a package that already exists. After 0.1.0 the user may switch the package to trusted publishing and delete the secret.

## Review Focus

1. **A user with only the documented ClusterRole** opens the map: every source the role grants shows ✓ and nothing asks for more. A role that misses one list breaks the inventory silently. → Task 2, Step 3 checks each rule with `kubectl auth can-i --as` against the files the code reads.
2. **A cluster without Hubble Relay** (kind, most clusters): the page renders namespaces and workloads, the Data menu explains Hubble ✗, and no error is logged. → Task 3 session and Step 4.
3. **The published tarball misses a runtime file** (`dist/hubble-proto/`, `dist/libavoid.wasm`, `NOTICE`): the extension installs and then fails when it loads. → Task 4, Step 1 asserts the file list of `pnpm pack --dry-run`.
4. **"Show on map" from a Freelens list** opens the map on the right namespace with the workload selected. → Task 3 session.
5. **npm provenance rejects the publish** because `package.json` `repository.url` does not match the GitHub repository (it currently names `freelens-service-map-extension`, the repo is `freelens-map-extension`). → Task 4, Step 2.

## File Structure

- Create `deploy/service-map-reader.yaml`: the minimal ClusterRole and a commented-out binding example.
- Rewrite `README.md`: the extension's README; the template's text goes.
- Modify `NOTICE`: unchanged content, now shipped in the tarball.
- Modify `.renovaterc.json`: six exclusions in the catalog rule.
- Modify `integration/__tests__/extension-helpers.ts`: drop the `Example` CRD helpers, add `applyFixtures`/`deleteFixtures` for `integration/fixtures/`.
- Create `integration/fixtures/kustomization.yaml`, `namespace.yaml`, `web.yaml`, `client.yaml`: namespace `integration-tests`, Deployment + Service `web`, Deployment `client`.
- Create `integration/__tests__/service-map.tests.ts`: the map-page session.
- Modify `package.json`: `version`, `repository.url`, `files` (add `NOTICE`).
- Create (outside this repo, in a fork of `freelensapp/freelens-marketplace`): `extensions/freelens-service-map-extension/extension.yaml` and `icon.png`.

---

### Task 1: Renovate exclusions

The catalog rule (`.renovaterc.json`, `matchPackageNames: ["!@freelensapp/**"]`) sends every dependency to the Freelens catalog. Freelens's `pnpm-workspace.yaml` (checked on 2026-11-05) has none of the six runtime dependencies, so each fails its lookup on the Dependency Dashboard.

**Files:** Modify `.renovaterc.json`

- [ ] **Step 1:** Add to the catalog rule's `matchPackageNames`: `"!@grpc/grpc-js"`, `"!@grpc/proto-loader"`, `"!elkjs"`, `"!@xyflow/react"`, `"!html-to-image"`, `"!libavoid-js"`. Extend that rule's `description` with one sentence: these are the extension's own runtime libraries, which Freelens does not have; Renovate updates them from npm.
- [ ] **Step 2:** Run `./.superpowers/pnpm dlx --package renovate@latest renovate-config-validator .renovaterc.json`. Expected: `Config validated successfully`.
- [ ] **Step 3:** Run `./.superpowers/pnpm dlx @biomejs/biome@2.6.3 check .renovaterc.json`. Expected: no errors.
- [ ] **Step 4:** Commit: `Renovate: update the extension's own libraries from npm`.

### Task 2: README, ClusterRole and NOTICE

**Files:** Create `deploy/service-map-reader.yaml`; rewrite `README.md`; modify `package.json` (`files`)

- [ ] **Step 1: The ClusterRole.** `deploy/service-map-reader.yaml`, `kind: ClusterRole`, `metadata.name: freelens-service-map-reader`, rules (verbs as in "Decisions"):
  - `""`: `pods`, `services`, `namespaces`, `nodes`: `get`, `list`; `pods/portforward`: `create`; `services/proxy`: `get`
  - `apps`: `deployments`, `statefulsets`, `daemonsets`: `get`, `list`
  - `networking.k8s.io`: `ingresses`, `networkpolicies`: `get`, `list`
  - `gateway.networking.k8s.io`: `httproutes`, `gateways`: `get`, `list`
  - `cilium.io`: `ciliumnetworkpolicies`, `ciliumclusterwidenetworkpolicies`: `get`, `list`
  - `apps.kubeblocks.io`: `clusters`, `instancesets`: `get`, `list`; `workloads.kubeblocks.io`: `instancesets`: `get`, `list`

  Below it, a commented `ClusterRoleBinding` example for a group `service-map-users`.
- [ ] **Step 2:** Check that no list the code reads is missing: every path in `LISTS`, `INSTANCE_SETS` and `/api/v1/nodes` of `src/renderer/map/k8s-source.ts` maps to one rule. Run `grep -n '"/api' src/renderer/map/k8s-source.ts` and compare line by line.
- [ ] **Step 3:** With the kind cluster (`kind-kind` context, create it with `kind create cluster` if absent): `kubectl --context kind-kind apply -f deploy/service-map-reader.yaml`, bind it to user `reader` (`kubectl create clusterrolebinding sm-reader --clusterrole=freelens-service-map-reader --user=reader`), then for each rule `kubectl --context kind-kind auth can-i <verb> <resource> --as=reader` (for example `create pods/portforward -n kube-system`, `get services/proxy -n monitoring`, `list deployments.apps -A`). Expected: `yes` for every rule, `no` for `get secrets`. Delete the binding and the role afterwards.
- [ ] **Step 4: README.** Replace the template text. Sections, in order:
  1. Title `Freelens Service Map`, one paragraph (from `package.json` `description`), npm and license badges only.
  2. **Features**: the zoom levels (all clusters, cluster, namespace by Helm release), live traffic, the details panel, Color by layers, quick views, search, export, anonymized names (spec §1, §3).
  3. **Requirements**: Freelens 2.0 or newer. Optional, each raising the level: Cilium with Hubble Relay (traffic), Prometheus (CPU/RAM). A table of the data-source levels and what each shows (spec §4 / Data menu).
  4. **Install**: the Freelens Extensions page with the package name `freelens-service-map-extension`; the marketplace once listed.
  5. **Permissions**: "read-only toward cluster resources" as spec §7b states it (port-forward and service proxy are allowed, as Freelens's own port-forward needs them), the YAML of `deploy/service-map-reader.yaml` embedded, a note that `pods/portforward` can be narrowed to the Relay namespace with a Role, and that the Data menu names any missing permission.
  6. **Hubble Relay**: plaintext Relay (Cilium's default) works; TLS Relay is not supported in 0.1.0 and shows the Data menu message.
  7. **Public endpoints**: the annotation `servicemap.freelens.io/public-endpoint` on a Service, with a 4-line YAML example, and the per-cluster setting that does the same (spec §4).
  8. **Settings**: the per-cluster settings of spec §6, one line each.
  9. **Privacy**: no agent, nothing installed in the cluster, nothing sent anywhere; the anonymize setting for screenshots and exports.
  10. **Development**: `pnpm install`, `pnpm build`, `pnpm test:unit`, `pnpm test:integration`, with a pointer to `AGENTS.md`.
  11. **License and attribution**: MIT; the Kubernetes icons from kubernetes/community under CC-BY-4.0, as in `NOTICE`; based on the Freelens example extension.
- [ ] **Step 5:** Add `"NOTICE"` to `files` in `package.json` (npm includes README and LICENSE on its own, NOTICE only when listed).
- [ ] **Step 6:** Run `./.superpowers/pnpm dlx @biomejs/biome@2.6.3 check README.md package.json` and `./.superpowers/pnpm exec yamllint deploy/` (or `pnpm trunk:check` if yamllint is not on `PATH`). Expected: clean.
- [ ] **Step 7:** Commit: `README, minimal ClusterRole and NOTICE for the release`.

### Task 3: Map-page integration sessions (bead freelens-map-extension-8oa)

**Files:** Modify `integration/__tests__/extension-helpers.ts`; create `integration/fixtures/*.yaml`, `integration/__tests__/service-map.tests.ts`

**Interfaces:**
- Consumes (existing in `extension-helpers.ts`): the CDP connection with the error collector, `installExtension`, `openKindCluster`, `disconnectKindCluster`, `kubectl`, the namespace-filter helper. Read the file for their exact names before writing the session; keep them.
- Produces: `applyFixtures(): void` and `deleteFixtures(): void` (`kubectl apply -k` / `delete -k --ignore-not-found --wait` of `integration/fixtures/`), replacing the CRD helpers (`crdName`, the `examples/<version>` apply/delete around lines 40-51 and 660-700).

- [ ] **Step 1: Fixtures.** `integration/fixtures/`: `namespace.yaml` (`integration-tests`), `web.yaml` (Deployment `web`, 1 replica, image `registry.k8s.io/pause:3.10`, label `app.kubernetes.io/name: web`; Service `web` port 80), `client.yaml` (Deployment `client`, same image), `kustomization.yaml` listing them. Kubernetes manifests keep kubectl's unindented sequences (formatted by yamlfmt: copy `integration/fixtures/.yamlfmt.yaml` from `freelensapp/freelens-example-extension` main; the yamlfmt-only rule for `integration/fixtures/` is already in `.trunk/trunk.yaml`).
- [ ] **Step 2: Helpers.** Remove the `Example` CRD code; add `applyFixtures`/`deleteFixtures`; make sure `pnpm type:check:integration` passes (`./.superpowers/pnpm exec tsc -p integration`).
- [ ] **Step 3: Write the session** `service-map.tests.ts`, one `it` per view, each navigating from the sidebar itself (template rule):
  - `it("lists the namespace on the cluster view")`: open the kind cluster, DOM-`click()` the extension's sidebar link (`[data-testid^="link-for-sidebar-item-"]` whose text is `Service map`), then wait for a `.react-flow__node` with text `integration-tests`.
  - `it("opens the namespace view with both workloads")`: double-click that node; expect nodes with text `web` and `client`, and the breadcrumb (`nav[aria-label="Breadcrumb"]`) to contain `integration-tests`.
  - `it("explains the missing Hubble Relay in the Data menu")`: open the Data menu; expect the Hubble row to show ✗ and the text `Hubble Relay not found in kube-system`.
  - `it("shows a Deployment on the map from its menu")`: open the Deployments page from the sidebar, select `integration-tests` in the namespace filter, open the row menu of `web`, click `Show on map`; expect the map page with the details panel showing `web`.
  - Every view: no text of the extension's `ErrorPage`.
  - Setup: disconnect the cluster, `deleteFixtures()`, `applyFixtures()`, `kubectl rollout status` both Deployments, connect. Teardown as the template: stop collecting errors, disconnect, `deleteFixtures()`, then check the errors.
- [ ] **Step 4:** Run against the local Freelens dev (CDP on 9223, kind cluster in Kubeconfig Syncs): `./.superpowers/pnpm exec vitest run --config vitest.integration.config.ts`. Expected: `extensions.tests.ts` and `service-map.tests.ts` pass. If the only failure is an `error:` main-log line for the missing Relay, change that log call in `src/main/collector.ts` (or `src/main/hubble/`) to warn level, add a unit test in `collector.test.ts` that a not-found Relay is reported through `errorStatus` without an error log, and rerun.
- [ ] **Step 5:** `.github/workflows/integration-tests.yaml`: confirm it has no step for the removed CRD (it applies nothing itself; sessions do). Expected: no change. If one is needed, edit it in place (local work, not the GitHub action).
- [ ] **Step 6:** Run `./.superpowers/pnpm test:unit`, `./.superpowers/pnpm exec tsc -p integration`, Biome on `integration/`, and `./.superpowers/pnpm dlx knip@6.41.0 --dependencies --files --no-gitignore --no-config-hints`. Expected: all clean.
- [ ] **Step 7:** Commit: `Integration sessions for the map page on kind`. `bd close freelens-map-extension-8oa`.

### Task 4: Package and release 0.1.0

**Files:** Modify `package.json`

- [ ] **Step 1: Tarball contents.** `./.superpowers/pnpm build`, then `./.superpowers/pnpm pack --dry-run`. Expected list includes `dist/main.js`, `dist/renderer.js`, `dist/renderer.css`, `dist/libavoid.wasm`, `dist/hubble-proto/` (every `.proto`), `README.md`, `LICENSE`, `NOTICE`, `package.json`, and nothing from `src/`, `captures/` or `.superpowers/`.
- [ ] **Step 2:** In `package.json`, set `repository.url` to `git+https://github.com/jhajali/freelens-map-extension.git` and `version` to `0.1.0`. Add `"homepage": "https://github.com/jhajali/freelens-map-extension#readme"` and `"bugs": "https://github.com/jhajali/freelens-map-extension/issues"`.
- [ ] **Step 3:** Full gates: `./.superpowers/pnpm test:unit`, every `tsc -p` of `type:check`, Biome check, knip both passes. Expected: clean.
- [ ] **Step 4: Check in Freelens.** Install the packed `freelens-service-map-extension-0.1.0.tgz` on the Extensions page (Replace), open the map on a connected cluster: renders, Data menu sane, no extension errors in the logs.
- [ ] **Step 5:** Commit: `Release 0.1.0`.
- [ ] **Step 6 (user's go):** The user adds the `NPM_TOKEN` secret to the GitHub repository (npm automation token for the account that will own the package). Wait for confirmation.
- [ ] **Step 7 (user's go):** `git push origin main`. `tag.yaml` tags `v0.1.0`; `release.yaml` publishes with `--tag latest` and creates the GitHub release. Watch with `gh run list --limit 5` and `gh run watch <id>`.
- [ ] **Step 8:** `npm view freelens-service-map-extension version`. Expected: `0.1.0`. On the Freelens Extensions page, install by name `freelens-service-map-extension`: it installs and loads.

### Task 5: Freelens marketplace listing

Format from `freelensapp/freelens-marketplace` README and `schema/lens-extension.schema.json` (checked 2026-11-05): `extensions/<npm-name>/extension.yaml` with `name`, `description`, `status` (`official` | `community`), `version`; optional `repository`, `authors`; optional `icon.png` 256x256.

- [ ] **Step 1: Icon.** Render `src/renderer/icons/` `MapIcon`'s SVG to `icon.png`, 256x256, on a transparent background, with a short Playwright script in the scratchpad (`page.setContent` of the SVG at 256 px, `screenshot({ omitBackground: true })`). Check it with `file icon.png`. Expected: `PNG image data, 256 x 256`.
- [ ] **Step 2: Manifest.**

  ```yaml
  name: freelens-service-map-extension
  description: Live service map for Freelens: namespaces, services, databases and traffic from Cilium Hubble
  status: community
  version: 0.1.0
  repository: https://github.com/jhajali/freelens-map-extension
  authors:
    - name: jihed
      surname: haj ali
      github: jhajali
  ```
- [ ] **Step 3:** Validate against the schema in the marketplace checkout (`npm install && npm run build` there regenerates `extensions.json` and fails on an invalid manifest).
- [ ] **Step 4 (user's go):** Fork, branch `add-service-map`, commit both files, open the PR with `gh pr create` titled `Add freelens-service-map-extension`. Report the PR link.
- [ ] **Step 5:** Update the README's Install section to name the marketplace once the PR is merged (follow-up bead if it is still open at the end of the session).

---

## Roadmap after M4

- **Later** (unchanged from M3): per-viewer time window; Hubble-metrics traffic without Relay; TLS Relay; namespace-filtered Relay streams; naming the exact policy behind a verdict; live data for every cluster in the All-clusters view. Open minors stay in beads (`9hh`, `aor`, `64d`, `8yq`).
