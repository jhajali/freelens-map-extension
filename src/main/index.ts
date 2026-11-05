import { Main } from "@freelensapp/extensions";
import { SPIKE_HUBBLE, type SpikeHubbleResult } from "../common/ipc";
import { openPortForward } from "./hubble/port-forward";
import { streamFlows } from "./hubble/relay-client";

class MapIpcMain extends Main.Ipc {}

export default class ServiceMapMain extends Main.LensExtension {
  async onActivate() {
    const ipc = MapIpcMain.createInstance(this);
    // Spike 3 (M1): port-forward to Hubble Relay and read 20 flows.
    ipc.handle(SPIKE_HUBBLE, async (_event, clusterId: string): Promise<SpikeHubbleResult> => {
      try {
        const pf = await openPortForward(clusterId, "kube-system", "hubble-relay", 80);
        try {
          const flows: unknown[] = [];
          await new Promise<void>((resolve, reject) => {
            const cancel = streamFlows(
              `127.0.0.1:${pf.localPort}`,
              { last: 20 },
              (f) => flows.push(f),
              (e) => (clearTimeout(timer), e ? reject(e) : resolve()),
            );
            // a Relay that never ends the stream would keep kubectl running
            const timer = setTimeout(
              () => (cancel(), reject(new Error("Hubble Relay did not answer within 30 s"))),
              30_000,
            );
          });
          return { ok: true, flows };
        } finally {
          pf.close();
        }
      } catch (error) {
        return { ok: false, flows: [], error: error instanceof Error ? error.message : String(error) };
      }
    });
  }
}
