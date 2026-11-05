import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { findPrometheus, promToMetrics } from "./prometheus";

import type { KubeObjectLike } from "./inventory";

const svc = (name: string, ports: Array<{ name?: string; port: number }>, labels?: Record<string, string>) =>
  ({ kind: "Service", metadata: { name, namespace: "mon", labels }, spec: { ports } }) as KubeObjectLike;

describe("prometheus", () => {
  it("finds the common Prometheus services", () => {
    expect(findPrometheus([svc("prometheus-operated", [{ name: "web", port: 9090 }])])).toEqual({
      ns: "mon",
      name: "prometheus-operated",
      port: 9090,
    });
    expect(
      findPrometheus([
        svc("other", [{ port: 1 }]),
        svc("my-prom", [{ port: 80 }], { "app.kubernetes.io/name": "prometheus" }),
      ]),
    ).toEqual({
      ns: "mon",
      name: "my-prom",
      port: 80,
    });
    expect(findPrometheus([svc("other", [{ port: 1 }])])).toBeNull();
  });

  it("turns query results into pod metrics", () => {
    const body = JSON.parse(
      readFileSync(join(import.meta.dirname, "../../../test/fixtures/capture-b/prom-cpu.json"), "utf8"),
    );
    const { cpu } = promToMetrics({ cpu: body });
    expect(Object.keys(cpu).length).toBe(body.data.result.length);
    const r = body.data.result[0];
    expect(cpu[`${r.metric.namespace}/${r.metric.pod}`]).toBe(Number(r.value[1]));
  });

  it("yields empty limits when kube-state-metrics is missing", () => {
    const m = promToMetrics({ cpuLim: { status: "success", data: { result: [] } } });
    expect(m.cpuLim).toEqual({});
    expect(m.memLim).toEqual({});
  });

  it("ignores non-finite values", () => {
    const row = (pod: string, v: string) => ({ metric: { namespace: "a", pod }, value: [1, v] });
    const body = { status: "success", data: { result: [row("n", "NaN"), row("i", "+Inf"), row("ok", "0.25")] } };
    expect(promToMetrics({ cpu: body }).cpu).toEqual({ "a/ok": 0.25 });
  });
});
