import { describe, expect, it } from "vitest";
import { FlowWindow } from "./window";

const flow = (n = 1, extra: object = {}) => ({
  verdict: "FORWARDED",
  IP: { source: `10.0.0.${n}`, destination: "10.0.1.1" },
  l4: { TCP: { destination_port: 80 } },
  source: { namespace: "a", pod_name: `p${n}`, labels: [] },
  destination: { namespace: "b", pod_name: "q", labels: [] },
  ...extra,
});

describe("FlowWindow", () => {
  it("counts identical flows once per key and expires them after the window", () => {
    const w = new FlowWindow();
    for (let i = 0; i < 3; i++) w.add(flow(), 0);
    w.add(flow(), 5_000);
    const r = w.entries(10_000);
    expect(r.flows).toHaveLength(1);
    expect(r.counts).toEqual([4]);
    expect(w.entries(301_000).flows).toHaveLength(0);
  });

  it("reports the covered span while the window fills", () => {
    const w = new FlowWindow();
    w.add(flow(), 0);
    expect(w.entries(60_000).windowSec).toBe(60);
    expect(w.entries(900_000).windowSec).toBe(300);
  });

  it("caps distinct keys and counts the rest as truncated", () => {
    const w = new FlowWindow({ maxKeys: 2 });
    for (const n of [1, 2, 3]) w.add(flow(n), 0);
    const r = w.entries(1_000);
    expect(r.flows).toHaveLength(2);
    expect(r.truncated).toBe(1);
  });

  it("drops replies", () => {
    const w = new FlowWindow();
    w.add(flow(1, { is_reply: true }), 0);
    expect(w.entries(1_000).flows).toHaveLength(0);
  });

  it("buckets by arrival, whatever the flow's own time says", () => {
    const w = new FlowWindow();
    w.add(flow(1, { time: new Date(0).toISOString() }), 400_000);
    w.add(flow(2, { time: new Date(9e12).toISOString() }), 400_000);
    expect(w.entries(400_000).flows).toHaveLength(2);
  });

  it("keys by destination port and SYN/ACK only", () => {
    const w = new FlowWindow();
    const tcp = (source_port: number, flags: object) =>
      flow(1, { l4: { TCP: { destination_port: 80, source_port, flags } } });
    w.add(tcp(1111, { SYN: true }), 0);
    w.add(tcp(2222, { SYN: true, PSH: true }), 0);
    const r = w.entries(1_000);
    expect(r.flows).toHaveLength(1);
    expect(r.counts).toEqual([2]);
  });
});
