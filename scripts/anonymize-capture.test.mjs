import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { anonymize } from "./anonymize-capture.mjs";

// Raw captures and the anonymizer config (seed, cluster name, the real names that must not survive) live in captures/,
// git-ignored and never committed; CI has none, so these tests skip there.
const CONFIG = "captures/anonymize.json";
const config = existsSync(CONFIG) ? JSON.parse(readFileSync(CONFIG, "utf8")) : null;
const rawA = config?.captures.a,
  rawB = config?.captures.b;
const FORBIDDEN = config?.forbidden ?? [];
const readAll = (dir) =>
  ["k8s.json", "extra.json", "policies.json", "flows.jsonl", "cluster.json", "prom-cpu.json"]
    .map((f) => readFileSync(join(dir, f), "utf8"))
    .join("\n");
const lines = (dir) =>
  readFileSync(join(dir, "flows.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l).flow)
    .filter(Boolean);

describe.skipIf(!config || !existsSync(rawB))("anonymize", () => {
  const outA = mkdtempSync(join(tmpdir(), "anon-a-")),
    outB = mkdtempSync(join(tmpdir(), "anon-b-"));
  let textB = "";
  // in a hook: Vitest still runs the body of a skipped suite to collect it, and without the config this throws
  beforeAll(() => {
    anonymize(rawB, outB, config);
    anonymize(rawA, outA, { ...config, objectsDir: rawB });
    textB = readAll(outB);
  });

  it("removes every real name, host and internal range", () => {
    for (const word of FORBIDDEN) expect(textB.includes(word), word).toBe(false);
    for (const word of FORBIDDEN) expect(readAll(outA).includes(word), word).toBe(false);
  });

  it("keeps Kubernetes structural names", () => {
    for (const word of [
      "kube-system",
      "kube-dns",
      "hubble-relay",
      "traefik",
      "postgresql-16-1.0.2",
      "app.kubernetes.io/instance",
    ])
      expect(textB.includes(word), word).toBe(true);
  });

  it("keeps Prometheus status strings", () => {
    const body = JSON.parse(readFileSync(join(outB, "prom-cpu.json"), "utf8"));
    expect(body.status).toBe("success");
    expect(body.data.resultType).toBe("vector");
  });

  it("maps a name to the same alias in both captures", () => {
    const nsA = new Set(
      lines(outA)
        .map((f) => f.source?.namespace)
        .filter(Boolean),
    );
    const nsB = new Set(
      lines(outB)
        .map((f) => f.source?.namespace)
        .filter(Boolean),
    );
    expect([...nsA].filter((n) => nsB.has(n)).length).toBeGreaterThan(5);
  });

  it("preserves flow count, ports, protocols and verdicts", () => {
    const raw = readFileSync(join(rawB, "flows.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l).flow)
      .filter(Boolean);
    const anon = lines(outB).filter(Boolean);
    const sig = (fs) =>
      JSON.stringify([
        fs.length,
        [...new Set(fs.map((f) => Object.keys(f.l4 ?? {})[0]))].sort(),
        [...new Set(fs.map((f) => f.l4?.TCP?.destination_port ?? f.l4?.UDP?.destination_port))].sort(),
        fs.filter((f) => f.verdict === "DROPPED").length,
      ]);
    expect(sig(anon)).toBe(sig(raw));
  });

  it("keeps each IP's class and /24 grouping", () => {
    const pairs = new Map();
    const raw = readFileSync(join(rawB, "flows.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l).flow);
    const anon = lines(outB);
    const priv = (ip) => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip);
    raw.filter(Boolean).forEach((f, i) => {
      if (f.IP) pairs.set(f.IP.source, anon[i].IP.source);
    });
    const byNet = new Map();
    for (const [r, a] of pairs) {
      expect(priv(a), `${r} -> ${a}`).toBe(priv(r));
      const rn = r.split(".").slice(0, 3).join("."),
        an = a.split(".").slice(0, 3).join(".");
      if (byNet.has(rn)) expect(byNet.get(rn)).toBe(an);
      else byNet.set(rn, an);
    }
  });
});
