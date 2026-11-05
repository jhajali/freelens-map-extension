import { promises as dnsPromises } from "node:dns";

type Resolve = (ip: string) => Promise<string[]>;

interface Options {
  max?: number;
  timeoutMs?: number;
}

/** Synchronous reverse lookups for flowsToEdges: answers from a cache, resolves in the background. */
export class ReverseDns {
  private readonly cache = new Map<string, string | null>();
  private readonly pending = new Set<string>();
  private readonly max: number;
  private readonly timeoutMs: number;

  constructor(
    private readonly resolve: Resolve = (ip) => dnsPromises.reverse(ip),
    opts: Options = {},
  ) {
    this.max = opts.max ?? 2000;
    this.timeoutMs = opts.timeoutMs ?? 2000;
  }

  lookup(ip: string): string | null {
    if (this.cache.has(ip)) return this.cache.get(ip) ?? null;
    if (this.pending.has(ip)) return null;
    this.pending.add(ip);
    let settled = false;
    // a late answer after the timeout must not store or unmark anything again
    const settle = (name: string | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      this.pending.delete(ip);
      this.store(ip, name);
    };
    const timer = setTimeout(() => settle(null), this.timeoutMs);
    new Promise<string[]>((resolve) => resolve(this.resolve(ip))).then(
      (names) => settle(names[0] ?? null),
      () => settle(null),
    );
    return null;
  }

  private store(ip: string, name: string | null) {
    this.cache.set(ip, name);
    if (this.cache.size <= this.max) return;
    const [oldest] = this.cache.keys();
    this.cache.delete(oldest);
  }
}
