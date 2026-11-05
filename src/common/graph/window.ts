// Rolling window of slimmed Hubble flows, counted per distinct key and per time bucket.
interface Bucket {
  counts: Map<string, number>;
  truncated: number;
}

interface RawFlow {
  is_reply?: boolean;
  verdict?: string;
  l4?: Record<string, { destination_port?: number; flags?: Record<string, boolean> } | undefined>;
  IP?: { source?: string; destination?: string };
  source?: { namespace?: string; pod_name?: string; labels?: string[] };
  destination?: { namespace?: string; pod_name?: string; labels?: string[] };
  source_names?: string[];
  destination_names?: string[];
}

// Only what flowsToEdges reads: source_port and the other flags would make every connection its own key.
function slimL4(l4: RawFlow["l4"]): unknown {
  const proto = Object.keys(l4 ?? {})[0];
  if (!proto) return undefined;
  const p = l4?.[proto];
  const flags: Record<string, boolean> = {};
  if (p?.flags?.SYN) flags.SYN = true;
  if (p?.flags?.ACK) flags.ACK = true;
  return { [proto]: { destination_port: p?.destination_port, ...(Object.keys(flags).length ? { flags } : {}) } };
}

export class FlowWindow {
  private readonly bucketMs: number;
  private readonly buckets: number;
  private readonly maxKeys: number;
  private readonly byIdx = new Map<number, Bucket>();
  private readonly keys = new Map<string, { slim: unknown; refs: number }>();
  private firstMs: number | null = null;

  constructor(opts: { bucketSec?: number; buckets?: number; maxKeys?: number } = {}) {
    this.bucketMs = (opts.bucketSec ?? 10) * 1000;
    this.buckets = opts.buckets ?? 30;
    this.maxKeys = opts.maxKeys ?? 20000;
  }

  add(raw: unknown, nowMs: number): void {
    const f = raw as RawFlow | null;
    if (!f || f.is_reply) return;
    this.firstMs ??= nowMs;
    this.prune(nowMs);
    // arrival time, not the flow's: the cluster's clock may differ from ours
    const idx = this.cur(nowMs);
    const slim = {
      verdict: f.verdict,
      is_reply: f.is_reply,
      l4: slimL4(f.l4),
      IP: f.IP && { source: f.IP.source, destination: f.IP.destination },
      source: f.source && { namespace: f.source.namespace, pod_name: f.source.pod_name, labels: f.source.labels },
      destination: f.destination && {
        namespace: f.destination.namespace,
        pod_name: f.destination.pod_name,
        labels: f.destination.labels,
      },
      source_names: f.source_names,
      destination_names: f.destination_names,
    };
    const key = JSON.stringify(slim);
    let b = this.byIdx.get(idx);
    if (!b) this.byIdx.set(idx, (b = { counts: new Map(), truncated: 0 }));
    const known = this.keys.get(key);
    if (!known && this.keys.size >= this.maxKeys) {
      b.truncated++;
      return;
    }
    const n = b.counts.get(key);
    if (n === undefined) {
      if (known) known.refs++;
      else this.keys.set(key, { slim, refs: 1 });
    }
    b.counts.set(key, (n ?? 0) + 1);
  }

  entries(nowMs: number): { flows: unknown[]; counts: number[]; windowSec: number; truncated: number } {
    this.prune(nowMs);
    const total = new Map<string, number>();
    let truncated = 0;
    for (const b of this.byIdx.values()) {
      truncated += b.truncated;
      for (const [k, n] of b.counts) total.set(k, (total.get(k) ?? 0) + n);
    }
    const span = this.firstMs === null ? 0 : Math.round((nowMs - this.firstMs) / 1000);
    const flows: unknown[] = [];
    const counts: number[] = [];
    for (const [k, n] of total) {
      const e = this.keys.get(k);
      if (!e) continue;
      flows.push(e.slim);
      counts.push(n);
    }
    return {
      flows,
      counts,
      windowSec: Math.max(1, Math.min(span, (this.buckets * this.bucketMs) / 1000)),
      truncated,
    };
  }

  private cur(nowMs: number): number {
    return Math.floor(nowMs / this.bucketMs);
  }

  private prune(nowMs: number): void {
    const oldest = this.cur(nowMs) - this.buckets;
    for (const [idx, b] of this.byIdx) {
      if (idx > oldest) continue;
      this.byIdx.delete(idx);
      for (const k of b.counts.keys()) {
        const e = this.keys.get(k);
        if (e && --e.refs <= 0) this.keys.delete(k);
      }
    }
  }
}
