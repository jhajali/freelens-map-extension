import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { openPortForward, type Spawner } from "./port-forward";

function fakeChild() {
  const child = Object.assign(new EventEmitter(), {
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: vi.fn(),
  });
  return child;
}

describe("openPortForward", () => {
  it("resolves the local port kubectl reports", async () => {
    const child = fakeChild();
    const spawn: Spawner = vi.fn(() => child);
    const pending = openPortForward("c1", "kube-system", "hubble-relay", 80, { kubectl: "/k", env: {}, spawn });
    child.stdout.write("Forwarding from 127.0.0.1:53421 -> 4245\n");
    const pf = await pending;
    expect(pf.localPort).toBe(53421);
    expect(spawn).toHaveBeenCalledWith(
      "/k",
      ["port-forward", "svc/hubble-relay", ":80", "-n", "kube-system", "--address", "127.0.0.1"],
      { env: {} },
    );
    pf.close();
    expect(child.kill).toHaveBeenCalled();
  });

  it("names the missing permission when kubectl is forbidden", async () => {
    const child = fakeChild();
    const pending = openPortForward("c1", "kube-system", "hubble-relay", 80, {
      kubectl: "/k",
      env: {},
      spawn: () => child,
    });
    child.stderr.write(
      'Error from server (Forbidden): pods "x" is forbidden: cannot create resource "pods/portforward"\n',
    );
    child.emit("exit", 1);
    await expect(pending).rejects.toThrow(/pods\/portforward/);
  });

  it("gives up after the timeout", async () => {
    const child = fakeChild();
    const pending = openPortForward("c1", "ns", "svc", 80, {
      kubectl: "/k",
      env: {},
      spawn: () => child,
      timeoutMs: 20,
    });
    await expect(pending).rejects.toThrow(/timed out/);
    expect(child.kill).toHaveBeenCalled();
  });

  it("rejects when kubectl cannot be started", async () => {
    const child = fakeChild();
    const pending = openPortForward("c1", "kube-system", "hubble-relay", 80, {
      kubectl: "/missing",
      env: {},
      spawn: () => child,
    });
    child.emit("error", Object.assign(new Error("spawn /missing ENOENT"), { code: "ENOENT" }));
    await expect(pending).rejects.toThrow(/cannot run kubectl.*ENOENT/);
  });
});
