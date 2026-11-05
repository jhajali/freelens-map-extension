#!/bin/sh
# Records a raw, read-only capture of a cluster for test fixtures: Kubernetes objects, ~6 min of Hubble flows and
# pod metrics. The output contains real names and IPs — keep it in captures/ (git-ignored) and commit only the
# output of scripts/anonymize-capture.mjs.
#   scripts/capture.sh <kube-context> <outDir> [prometheus-namespace/service:port]
set -eu
ctx=$1; out=$2; prom=${3:-observability/prometheus-server:80}
k() { kubectl --context "$ctx" "$@"; }
mkdir -p "$out"
k get deploy,sts,ds,svc,ing,pods -A -o json > "$out/k8s.json"
k get httproute,gateway,instanceset,clusters.apps.kubeblocks.io -A -o json > "$out/extra.json" 2>/dev/null || echo '{"items":[]}' > "$out/extra.json"
k get networkpolicy,ciliumnetworkpolicy,ciliumclusterwidenetworkpolicy -A -o json > "$out/policies.json" 2>/dev/null || echo '{"items":[]}' > "$out/policies.json"
relay=$(k -n kube-system get svc hubble-relay -o jsonpath='{.spec.clusterIP}')
k -n kube-system exec ds/cilium -c cilium-agent -- hubble observe --server "$relay:80" --last 20000 --not --namespace kube-system -o jsonpb > "$out/flows.jsonl"
ns=${prom%%/*}; svcport=${prom#*/}
q() { k get --raw "/api/v1/namespaces/$ns/services/$svcport/proxy/api/v1/query?query=$(printf '%s' "$2" | jq -sRr @uri)" > "$out/prom_$1.json"; }
q cpu 'sum by (namespace,pod) (rate(container_cpu_usage_seconds_total{container!=""}[5m]))'
q mem 'sum by (namespace,pod) (container_memory_working_set_bytes{container!=""})'
q cpulim 'sum by (namespace,pod) (kube_pod_container_resource_limits{resource="cpu"})'
q memlim 'sum by (namespace,pod) (kube_pod_container_resource_limits{resource="memory"})'
