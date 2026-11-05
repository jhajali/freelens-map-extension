#!/usr/bin/env node
// Turns a raw cluster capture (scripts/capture.sh output, never committed) into a test fixture that keeps the
// structure, ports, protocols, rates and counts but none of the real names, hostnames or IP ranges.
//
//   node scripts/anonymize-capture.mjs <rawDir> <outDir> [objectsDir]
//
// The seed and the capture's own cluster name come from captures/anonymize.json (git-ignored), { seed, self }: a
// public seed would let anyone confirm a guessed name by hashing it. Names are rewritten word by word (split on - . /): generic Kubernetes and software words stay, every other word
// becomes "n" + 5 hex chars of sha256(seed + word), so a name maps to the same alias in every capture made with the
// same seed. IPv4 addresses keep their last octet and their /24 grouping: private /24s move inside 10.200.0.0/13,
// public /24s inside 198.18.0.0/15 (benchmark range, treated as public by the classifier).
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const KEEP = new Set(
  `kube system dns public node lease cilium secrets hubble relay peer traefik internal external gateway api apis ui ui2
  backend frontend worker web webserver daemon server client postgresql postgres pg mysql redis mongodb mongo rabbitmq kafka clickhouse
  elasticsearch neo4j metabase dagster sftpgo sftp windmill velero cert manager reloader observability prometheus grafana otel
  telemetry collector agent operator kb csi kubeblocks apps app io k8s svc cluster local default controller webhook cainjector code
  location explorer auth rpc validation metrics state exporter envoy coredns snapshot archive wal sidekiq ui http https grpc tcp udp
  v1 v1beta1 v1alpha1 networking gateway kubernetes instance name component part of managed by version helm sh chart heritage
  release revision hash pod template generation statefulset role master replica primary secondary data log logs proxy nginx
  ingress lb ipam ips main dev prod uat demo mgmt staging test tests job cron 1 2 3 data dagit storage minio
  backup restore node exporter kafka ui zookeeper broker schema registry connect www status health live ready
  reserved world host remote unmanaged init apiserver unknown ingress`
    .split(/\s+/)
    .filter(Boolean),
);
// Only annotations the map reads survive (Helm release, LB provider/IPAM, the public-endpoint annotation).
const KEEP_ANNOTATIONS =
  /^(meta\.helm\.sh\/|lbipam\.cilium\.io\/|servicemap\.freelens\.io\/|service\.beta\.kubernetes\.io\/|metallb\.universe\.tf\/|cloud\.google\.com\/)/;

const hex = (seed, s) =>
  createHash("sha256")
    .update(seed + "\0" + s)
    .digest("hex");
const isPrivate = (a, b) => a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);

export function anonymize(rawDir, outDir, { seed, self, objectsDir = rawDir }) {
  if (!seed || !self) throw new Error("anonymize needs { seed, self } (captures/anonymize.json)");
  const words = new Map(),
    nets = new Map();
  const word = (w) => {
    if (KEEP.has(w) || /^\d+$/.test(w) || /^[0-9a-f]{5,10}$/.test(w) || w.length <= 2) return w;
    if (!words.has(w)) words.set(w, "n" + hex(seed, w).slice(0, 5));
    return words.get(w);
  };
  const ip = (s) =>
    s.replace(/\b(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\b/g, (m, a, b, c, d) => {
      const key = `${a}.${b}.${c}`;
      if (!nets.has(key)) {
        const h = parseInt(hex(seed, key).slice(0, 4), 16);
        nets.set(key, isPrivate(+a, +b) ? `10.${200 + (h >> 13)}.${h & 255}` : `198.${18 + (h & 1)}.${(h >> 1) & 255}`);
      }
      return `${nets.get(key)}.${d}`;
    });
  const str = (s) =>
    ip(s).replace(/[A-Za-z][A-Za-z0-9]*/g, (w) => (/[A-Z]/.test(w) && w !== w.toLowerCase() ? w : word(w)));
  // Values only (keys are structural); label/annotation keys stay, their values are rewritten.
  const walk = (v, key = "") => {
    if (typeof v === "string")
      return /^(kind|apiVersion|status|resultType|type|verdict|Type|protocol|phase|traffic_direction|ipVersion|reason|operator|effect|policy_match_type)$/.test(
        key,
      )
        ? v
        : str(v);
    if (Array.isArray(v)) return v.map((x) => walk(x, key));
    if (v && typeof v === "object") {
      const o = {};
      for (const [k, x] of Object.entries(v)) {
        if (
          k === "managedFields" ||
          k === "env" ||
          k === "envFrom" ||
          k === "args" ||
          k === "command" ||
          k === "volumes" ||
          k === "volumeMounts"
        )
          continue;
        if (k === "annotations") {
          o[k] = Object.fromEntries(
            Object.entries(x)
              .filter(([ak]) => KEEP_ANNOTATIONS.test(ak))
              .map(([ak, av]) => [ak, walk(av)]),
          );
          continue;
        }
        // maps keyed by pod/instance/component names (e.g. KubeBlocks status.currentRevisions, status.components)
        if (/Revisions$|^revisions$|^membersStatus$|^message$|^components$/.test(key)) {
          o[str(k)] = walk(x, k);
          continue;
        }
        o[k] = walk(x, k);
      }
      return o;
    }
    return v;
  };
  // Hubble flows: keep only what the map reads; node names/labels and ethernet are dropped.
  const slimEp = (e = {}) => ({
    identity: e.identity,
    namespace: e.namespace,
    pod_name: e.pod_name,
    workloads: e.workloads,
    labels: (e.labels || []).filter((l) => l.startsWith("reserved:")),
  });
  const slimFlow = (f) => ({
    time: f.time,
    verdict: f.verdict,
    drop_reason_desc: f.drop_reason_desc,
    IP: f.IP,
    l4: f.l4,
    source: slimEp(f.source),
    destination: slimEp(f.destination),
    Type: f.Type,
    is_reply: f.is_reply,
    traffic_direction: f.traffic_direction,
    source_names: f.source_names,
    destination_names: f.destination_names,
    destination_service: f.destination_service,
  });

  mkdirSync(outDir, { recursive: true });
  for (const f of ["k8s.json", "extra.json", "policies.json"])
    writeFileSync(join(outDir, f), JSON.stringify(walk(JSON.parse(readFileSync(join(objectsDir, f), "utf8")))));
  for (const m of ["cpu", "mem", "cpulim", "memlim"])
    writeFileSync(
      join(outDir, `prom-${m}.json`),
      JSON.stringify(walk(JSON.parse(readFileSync(join(objectsDir, `prom_${m}.json`), "utf8")))),
    );
  const out = [];
  for (const line of readFileSync(join(rawDir, "flows.jsonl"), "utf8").split("\n")) {
    if (!line.trim()) continue;
    const flow = JSON.parse(line).flow;
    out.push(JSON.stringify({ flow: flow ? walk(slimFlow(flow)) : null }));
  }
  writeFileSync(join(outDir, "flows.jsonl"), out.join("\n") + "\n");
  const clustersFile = "captures/prototype-scripts/clusters.json";
  const cidrs = existsSync(clustersFile) ? JSON.parse(readFileSync(clustersFile, "utf8")) : {};
  writeFileSync(
    join(outDir, "cluster.json"),
    JSON.stringify(
      {
        self: str(self),
        clusterCidrs: Object.fromEntries(Object.entries(cidrs).map(([k, v]) => [str(k), ip(v)])),
      },
      null,
      1,
    ),
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const config = JSON.parse(readFileSync("captures/anonymize.json", "utf8"));
  anonymize(process.argv[2], process.argv[3], { ...config, objectsDir: process.argv[4] ?? process.argv[2] });
}
