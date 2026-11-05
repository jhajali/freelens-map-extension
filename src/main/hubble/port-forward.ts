import { spawn as nodeSpawn } from "node:child_process";
import { Main } from "@freelensapp/extensions";

interface ChildLike {
  stdout: NodeJS.ReadableStream | null;
  stderr: NodeJS.ReadableStream | null;
  on(event: "exit", listener: (code: number | null) => void): unknown;
  on(event: "error", listener: (error: Error) => void): unknown;
  kill(): unknown;
}
export type Spawner = (command: string, args: string[], options: { env: NodeJS.ProcessEnv }) => ChildLike;

export interface PortForward {
  localPort: number;
  close(): void;
}

interface Deps {
  kubectl?: string;
  env?: NodeJS.ProcessEnv;
  spawn?: Spawner;
  timeoutMs?: number;
}

/** Runs Freelens' kubectl `port-forward svc/<svc> :<port>` for a cluster and resolves the local port it picked. */
export async function openPortForward(
  clusterId: string,
  ns: string,
  svc: string,
  remotePort: number,
  deps: Deps = {},
): Promise<PortForward> {
  const kubectl = deps.kubectl ?? (await Main.Shell.getKubectlPath(clusterId));
  const env = deps.env ?? (await Main.Shell.getEnvironment(clusterId));
  const spawn = deps.spawn ?? (nodeSpawn as unknown as Spawner);
  const child = spawn(kubectl, ["port-forward", `svc/${svc}`, `:${remotePort}`, "-n", ns, "--address", "127.0.0.1"], {
    env,
  });
  return new Promise((resolve, reject) => {
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`port-forward to ${ns}/${svc}:${remotePort} timed out`));
    }, deps.timeoutMs ?? 10_000);
    child.stdout?.on("data", (chunk: Buffer | string) => {
      const match = /Forwarding from 127\.0\.0\.1:(\d+)/.exec(String(chunk));
      if (!match) return;
      clearTimeout(timer);
      resolve({ localPort: Number(match[1]), close: () => child.kill() });
    });
    child.stderr?.on("data", (chunk: Buffer | string) => {
      stderr += String(chunk);
    });
    // without a listener, a failed spawn throws in Freelens' main process
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(new Error(`cannot run kubectl: ${error.message}`));
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      const hint = /forbidden/i.test(stderr) ? ' (RBAC: needs "create" on "pods/portforward")' : "";
      reject(new Error(`kubectl port-forward exited with ${code}${hint}: ${stderr.trim()}`));
    });
  });
}
