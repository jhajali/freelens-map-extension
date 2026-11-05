# Freelens Service Map

[![npm](https://img.shields.io/npm/v/freelens-service-map-extension.svg)](https://www.npmjs.com/package/freelens-service-map-extension)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

A live map of your cluster inside [Freelens](https://freelens.app): namespaces,
the services inside them, who talks to whom, which service uses which
database, what comes in from outside and what leaves. Traffic comes from
Cilium Hubble when the cluster has it; without it the map still shows the
topology from the Kubernetes API.

## Features

- **Three zoom levels.** All clusters, one cluster (its namespaces), one
  namespace (its workloads, grouped by Helm release). "Service map" in the
  cluster sidebar opens it; "Show on map" in the menu of a Namespace,
  Deployment, StatefulSet or DaemonSet opens it on that object.
- **Live traffic.** Links carry protocol, rate and drops, with particles that
  follow the rate. Red means only that something is wrong.
- **Entry and exit points.** LoadBalancers, Gateway API routes and Ingress on
  the way in; the Internet, internal networks and other clusters on the way
  out.
- **Details panel.** Status, pods, CPU and RAM against limits, inbound and
  outbound peers, exposure, network policy, and buttons that open the object,
  its logs or a shell in Freelens.
- **Color by** CPU, RAM, pod health, traffic or network policy; quick views
  for problems, exposed services, egress, databases, drops and changes over
  the last 24 hours; search; filters.
- **Export** as PNG or SVG, with names anonymized if you choose.

## Requirements

Freelens 2.0 or newer. Each optional data source adds to what the map shows,
and the **Data** menu on the map says which ones it found, with a fix for the
missing ones:

| Data sources found  | The map shows                                                              |
| ------------------- | -------------------------------------------------------------------------- |
| Kubernetes only     | Topology from workloads, Services, routes and LoadBalancers; no live data. |
| Prometheus          | Plus CPU and RAM per workload.                                             |
| Hubble Relay        | Plus live traffic: flows, protocols, drops, verdicts.                      |
| Hubble + Prometheus | Everything.                                                                |
- **Hubble Relay**: Cilium with Hubble Relay enabled
  (`cilium hubble enable --relay`). Found as `kube-system/hubble-relay`
  unless set otherwise in Settings.
- **Prometheus**: found by its usual service names (`prometheus-server`,
  `prometheus-operated`, `kube-prometheus-stack-prometheus`,
  `prometheus-k8s`, `prometheus`) unless set otherwise in Settings.

## Install

In Freelens, open **Extensions**, enter `freelens-service-map-extension` and
press **Install**.

## Permissions

The extension is read-only toward cluster resources. It installs nothing in
the cluster and runs no agent. It opens a port-forward to Hubble Relay and
reaches Prometheus through the API server's service proxy, as Freelens's own
port-forward does. The least a user needs for every data source is this
ClusterRole, also in [`deploy/service-map-reader.yaml`](deploy/service-map-reader.yaml):

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: freelens-service-map-reader
rules:
  - apiGroups: [""]
    resources: [pods, services, namespaces, nodes]
    verbs: [get, list]
  - apiGroups: [""]
    resources: [pods/portforward]
    verbs: [create]
  - apiGroups: [""]
    resources: [services/proxy]
    verbs: [get]
  - apiGroups: [apps]
    resources: [deployments, statefulsets, daemonsets]
    verbs: [get, list]
  - apiGroups: [networking.k8s.io]
    resources: [ingresses, networkpolicies]
    verbs: [get, list]
  - apiGroups: [gateway.networking.k8s.io]
    resources: [httproutes, gateways]
    verbs: [get, list]
  - apiGroups: [cilium.io]
    resources: [ciliumnetworkpolicies, ciliumclusterwidenetworkpolicies]
    verbs: [get, list]
  - apiGroups: [apps.kubeblocks.io]
    resources: [clusters, instancesets]
    verbs: [get, list]
  - apiGroups: [workloads.kubeblocks.io]
    resources: [instancesets]
    verbs: [get, list]
```

- `pods/portforward` is only needed in the namespace of Hubble Relay; a Role
  there can grant it instead of the ClusterRole.
- `services/proxy` is only needed in the namespace of Prometheus.
- The resources of a CRD the cluster does not have (Gateway API, Cilium,
  KubeBlocks) are skipped.
- When a permission is missing, the Data menu names it, and the map falls
  back to the sources it can read.

## Hubble Relay and TLS

A plaintext Relay, Cilium's default, works as is. A Relay with TLS is not
supported yet: the Data menu shows "TLS enabled, client certs not readable".

## Public endpoints

A LoadBalancer is public when one of its addresses is public or a hostname.
A private LoadBalancer behind an external one (for example a cloud load
balancer in front of Cilium LB-IPAM) can be marked public with an annotation
whose value is the address users reach:

```yaml
metadata:
  annotations:
    servicemap.freelens.io/public-endpoint: shop.example.com
```

The **Public endpoints** setting does the same without changing the Service.

## Settings

The map's Settings button opens the settings of the current cluster:

- **Problems**: the CPU %, RAM % and restart thresholds above which a workload
  counts as a problem.
- **Named networks**: `CIDR = name` lines; egress to such a network shows
  under its name instead of "Internal network".
- **Public endpoints**: `namespace/service = endpoint` lines, as the
  annotation above.
- **Palette**: a color-blind safe palette for the status colors.
- **Anonymize names**: replaces names on the map and in exports, for
  screenshots.
- **Data sources**: the Hubble Relay and Prometheus services, as
  `namespace/service:port`, when they are not found on their own.

## Privacy

The extension talks to the clusters you open in Freelens, through Freelens.
The only other requests are reverse DNS lookups of the public IPs your
workloads talk to, through your system's resolver, to name them on the map.
The history of traffic snapshots (24 hours, rates only) stays in Freelens's
extension storage on your machine.

## Development

```bash
pnpm install
pnpm build              # dist/ for Freelens
pnpm test:unit
pnpm type:check
pnpm test:integration   # against Freelens dev and a kind cluster
```

To try a change, install the checkout's directory on the Extensions page of
Freelens dev. The build, test and CI conventions are in [`AGENTS.md`](AGENTS.md).

## License and attribution

MIT, see [`LICENSE`](LICENSE). The Kubernetes icons are from
[kubernetes/community](https://github.com/kubernetes/community/tree/master/icons),
licensed under CC-BY-4.0, copyright the Kubernetes Authors. The project
started from the
[Freelens example extension](https://github.com/freelensapp/freelens-example-extension)
(MIT). See [`NOTICE`](NOTICE).
