import { Renderer } from "@freelensapp/extensions";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { openInFreelens, openLogs, openShell, selfLink } from "./actions";

import type { Workload } from "../../common/graph/types";

const w = (kind: Workload["kind"], pods: Array<[string, string]> = []) =>
  ({
    kind,
    ns: "shop",
    name: "web",
    pods: pods.map(([name, phase]) => ({ name, phase })),
  }) as unknown as Workload;

const C = Renderer.Component;
const notify = vi.mocked(C.Notifications.error);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(Renderer.K8sApi.podsApi.get).mockReset();
  vi.mocked(C.terminalStore.sendCommand).mockReset();
});

describe("selfLink", () => {
  it("maps each kind to its API path", () => {
    expect(selfLink(w("Deployment"))).toBe("/apis/apps/v1/namespaces/shop/deployments/web");
    expect(selfLink(w("StatefulSet"))).toBe("/apis/apps/v1/namespaces/shop/statefulsets/web");
    expect(selfLink(w("DaemonSet"))).toBe("/apis/apps/v1/namespaces/shop/daemonsets/web");
    expect(selfLink(w("KubeBlocks"))).toBe("/apis/apps.kubeblocks.io/v1/namespaces/shop/clusters/web");
  });
});

describe("actions", () => {
  it("openInFreelens shows the details of the self link", () => {
    openInFreelens(w("Deployment"));
    expect(Renderer.Navigation.showDetails).toHaveBeenCalledWith("/apis/apps/v1/namespaces/shop/deployments/web");
  });

  it("openLogs opens a log tab for the first Running pod", async () => {
    const pod = { getContainers: () => ["c0", "c1"] };
    vi.mocked(Renderer.K8sApi.podsApi.get).mockResolvedValue(pod as never);
    await openLogs(
      w("Deployment", [
        ["p0", "Pending"],
        ["p1", "Running"],
        ["p2", "Running"],
      ]),
    );
    expect(Renderer.K8sApi.podsApi.get).toHaveBeenCalledWith({ name: "p1", namespace: "shop" });
    expect(C.logTabStore.createPodTab).toHaveBeenCalledWith({ selectedPod: pod, selectedContainer: "c0" });
  });

  it("openShell opens a terminal tab and sends the exec command", async () => {
    vi.mocked(Renderer.K8sApi.podsApi.get).mockResolvedValue({ getContainers: () => ["c0"] } as never);
    await openShell(w("Deployment", [["p1", "Running"]]));
    expect(C.createTerminalTab).toHaveBeenCalledWith({ title: "shop/p1" });
    expect(C.terminalStore.sendCommand).toHaveBeenCalledWith(
      "kubectl exec -it -n shop p1 -- sh -c 'command -v bash >/dev/null && exec bash || exec sh'",
      { enter: true, tabId: "tab-1" },
    );
  });

  it("a failing action shows a notification", async () => {
    vi.mocked(Renderer.K8sApi.podsApi.get).mockRejectedValue(new Error("boom"));
    await openLogs(w("Deployment", [["p1", "Running"]]));
    expect(notify).toHaveBeenCalledTimes(1);
    expect(String(notify.mock.calls[0][0])).toContain("boom");
    await openShell(w("Deployment"));
    expect(notify).toHaveBeenCalledTimes(2);
    vi.mocked(Renderer.Navigation.showDetails).mockImplementationOnce(() => {
      throw new Error("nav");
    });
    openInFreelens(w("Deployment"));
    expect(notify).toHaveBeenCalledTimes(3);
  });

  it("openShell refuses a pod name that is not a DNS name, before any terminal tab", async () => {
    await openShell(w("Deployment", [["a;rm -rf ~", "Running"]]));
    expect(notify).toHaveBeenCalledTimes(1);
    expect(C.createTerminalTab).not.toHaveBeenCalled();
    expect(C.terminalStore.sendCommand).not.toHaveBeenCalled();
  });

  it("openShell refuses a namespace that is not a DNS name", async () => {
    await openShell({ ...w("Deployment", [["p1", "Running"]]), ns: "x$(id)" } as Workload);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(C.createTerminalTab).not.toHaveBeenCalled();
  });

  it("openShell opens no tab when the pod is missing or has no containers", async () => {
    vi.mocked(Renderer.K8sApi.podsApi.get).mockResolvedValue(undefined as never);
    await openShell(w("Deployment", [["p1", "Running"]]));
    vi.mocked(Renderer.K8sApi.podsApi.get).mockResolvedValue({ getContainers: () => [] } as never);
    await openShell(w("Deployment", [["p1", "Running"]]));
    expect(notify).toHaveBeenCalledTimes(2);
    expect(C.createTerminalTab).not.toHaveBeenCalled();
  });

  it("openShell shows a notification when sendCommand rejects", async () => {
    vi.mocked(Renderer.K8sApi.podsApi.get).mockResolvedValue({ getContainers: () => ["c0"] } as never);
    vi.mocked(C.terminalStore.sendCommand).mockRejectedValue(new Error("send"));
    await openShell(w("Deployment", [["p1", "Running"]]));
    expect(String(notify.mock.calls[0][0])).toContain("send");
  });
});
