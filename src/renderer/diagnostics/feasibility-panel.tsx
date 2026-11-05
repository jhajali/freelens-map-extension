import { Renderer } from "@freelensapp/extensions";
import { useState } from "react";
import { SPIKE_HUBBLE, type SpikeHubbleResult } from "../../common/ipc";
import { MapIpcRenderer } from "../ipc";
import { loadAvoid } from "../map/libavoid";

// Spike buttons for Milestone 1 (removed in M2): each runs one risky integration and shows what happened.
const { K8sApi, Catalog, Navigation, Component } = Renderer;

type Result = Record<string, string>;

async function prometheus(): Promise<string> {
  const cluster = Catalog.getActiveCluster();
  if (!cluster) return "no active cluster";
  const api = K8sApi.KubeJsonApi.forCluster(cluster.id);
  const res = await api.get<{ status: string; data: { result: unknown[] } }>(
    "/api/v1/namespaces/observability/services/prometheus-server:80/proxy/api/v1/query",
    { query: { query: "up" } },
  );
  return `${res.status}, ${res.data.result.length} series`;
}

async function libavoid(): Promise<string> {
  const A = await loadAvoid();
  if (!A) return "load failed (see console)";
  const router = new A.Router(A.RouterFlag.OrthogonalRouting.value);
  router.setRoutingParameter(A.RoutingParameter.shapeBufferDistance, 12);
  const box = (x: number, y: number, w: number, h: number) =>
    new A.ShapeRef(router, new A.Rectangle(new A.Point(x, y), new A.Point(x + w, y + h)));
  const a = box(0, 0, 100, 60),
    b = box(400, 0, 100, 60);
  box(200, -100, 60, 300);
  for (const s of [a, b]) new A.ShapeConnectionPin(s, 1, 0.5, 0.5, true, 0, 15);
  const c = new A.ConnRef(router, new A.ConnEnd(a, 1), new A.ConnEnd(b, 1));
  router.processTransaction();
  const r = c.displayRoute(),
    pts: number[][] = [];
  for (let i = 0; i < r.size(); i++) pts.push([r.at(i).x, r.at(i).y]);
  router.delete();
  return JSON.stringify(pts);
}

async function firstPod() {
  const pods = await K8sApi.podsApi.list({ namespace: "kube-system" });
  if (!pods?.length) throw new Error("no pods in kube-system");
  return pods[0];
}

export function FeasibilityPanel() {
  const [result, setResult] = useState<Result>({});
  const run = (name: string, fn: () => Promise<string>) => async () => {
    setResult((r) => ({ ...r, [name]: "…" }));
    try {
      const out = await fn();
      setResult((r) => ({ ...r, [name]: "OK " + out }));
    } catch (error) {
      setResult((r) => ({ ...r, [name]: "ERROR " + (error instanceof Error ? error.message : String(error)) }));
    }
  };
  const buttons: Array<[string, () => Promise<string>]> = [
    ["prometheus", prometheus],
    [
      "hubble",
      async () => {
        const r = (await MapIpcRenderer.getInstance().invoke(
          SPIKE_HUBBLE,
          Catalog.getActiveCluster()?.id,
        )) as SpikeHubbleResult;
        if (!r.ok) throw new Error(r.error);
        const f = r.flows[0] as { source?: { namespace?: string }; destination?: { namespace?: string } } | undefined;
        return `${r.flows.length} flows, first ${f?.source?.namespace ?? "?"} -> ${f?.destination?.namespace ?? "?"}`;
      },
    ],
    ["libavoid", libavoid],
    [
      "details",
      async () => {
        const p = await firstPod();
        Navigation.showDetails(p.selfLink);
        return p.getName();
      },
    ],
    [
      "logs",
      async () => {
        const p = await firstPod();
        const c = p.getContainers()[0];
        Component.logTabStore.createPodTab({ selectedPod: p, selectedContainer: c });
        return `${p.getName()}/${c.name}`;
      },
    ],
    [
      "shell",
      async () => {
        const t = Component.createTerminalTab({ title: "service-map spike" });
        return String(t.id);
      },
    ],
  ];
  return (
    <div data-testid="feasibility" style={{ marginTop: 24 }}>
      <h3>Diagnostics (M1 spikes)</h3>
      {buttons.map(([name, fn]) => (
        <div key={name}>
          <button type="button" data-spike={name} onClick={run(name, fn)}>
            {name}
          </button>{" "}
          <span data-spike-result={name}>{result[name] ?? ""}</span>
        </div>
      ))}
    </div>
  );
}
