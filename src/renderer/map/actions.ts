import { Renderer } from "@freelensapp/extensions";

import type { Workload } from "../../common/graph/types";

const PLURAL = { Deployment: "deployments", StatefulSet: "statefulsets", DaemonSet: "daemonsets" } as const;

export function selfLink(w: Workload): string {
  if (w.kind === "KubeBlocks") return `/apis/apps.kubeblocks.io/v1/namespaces/${w.ns}/clusters/${w.name}`;
  return `/apis/apps/v1/namespaces/${w.ns}/${PLURAL[w.kind]}/${w.name}`;
}

// PodInfo has no ready flag; phase Running is the closest signal.
function firstRunningPod(w: Workload) {
  const pod = w.pods.find((p) => p.phase === "Running");
  if (!pod) throw new Error(`No running pod for ${w.ns}/${w.name}`);
  return pod;
}

function guard<A extends unknown[]>(fn: (...a: A) => void | Promise<void>) {
  return async (...a: A) => {
    try {
      await fn(...a);
    } catch (e) {
      Renderer.Component.Notifications.error(e instanceof Error ? e.message : String(e));
    }
  };
}

export const openInFreelens = (w: Workload) => void guard(() => Renderer.Navigation.showDetails(selfLink(w)))();

export const openLogs = guard(async (w: Workload) => {
  const { name } = firstRunningPod(w);
  const pod = await Renderer.K8sApi.podsApi.get({ name, namespace: w.ns });
  if (!pod) throw new Error(`Pod ${w.ns}/${name} not found`);
  const selectedContainer = pod.getContainers()[0];
  if (!selectedContainer) throw new Error(`Pod ${w.ns}/${name} has no containers`);
  Renderer.Component.logTabStore.createPodTab({ selectedPod: pod, selectedContainer });
});

const DNS_NAME = /^[a-z0-9]([-a-z0-9.]*[a-z0-9])?$/;

export const openShell = guard(async (w: Workload) => {
  const { name } = firstRunningPod(w);
  // both go unquoted into a command typed in the user's shell
  if (!DNS_NAME.test(w.ns) || !DNS_NAME.test(name))
    throw new Error(`Refusing to open a shell: invalid name ${w.ns}/${name}`);
  const pod = await Renderer.K8sApi.podsApi.get({ name, namespace: w.ns });
  if (!pod) throw new Error(`Pod ${w.ns}/${name} not found`);
  if (!pod.getContainers()[0]) throw new Error(`Pod ${w.ns}/${name} has no containers`);
  const tab = Renderer.Component.createTerminalTab({ title: `${w.ns}/${name}` });
  await Renderer.Component.terminalStore.sendCommand(
    `kubectl exec -it -n ${w.ns} ${name} -- sh -c 'command -v bash >/dev/null && exec bash || exec sh'`,
    { enter: true, tabId: tab.id },
  );
});
