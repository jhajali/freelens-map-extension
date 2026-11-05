import { Main } from "@freelensapp/extensions";
import { TICK } from "../common/ipc";
import { Collectors } from "./collector";
import { ReverseDns } from "./dns";
import { registerHandlers } from "./handlers";
import { openPortForward } from "./hubble/port-forward";
import { streamFlows } from "./hubble/relay-client";
import { MapStore } from "./store";

class MapIpcMain extends Main.Ipc {}

export default class ServiceMapMain extends Main.LensExtension {
  private collectors: Collectors | null = null;
  private dispose: (() => void) | null = null;

  onActivate() {
    const ipc = MapIpcMain.createInstance(this);
    const collectors = new Collectors({
      openPortForward,
      streamFlows,
      dns: new ReverseDns(),
      broadcast: (tick) => ipc.broadcast(TICK, tick),
      now: Date.now,
      setInterval,
      clearInterval,
      setTimeout,
      clearTimeout,
    });
    this.collectors = collectors;
    const store = this.getExtensionFileFolder().then((dir) => new MapStore(dir));
    // the handlers get the original promise and report the error per call; this branch only keeps it handled
    store.catch((e) => console.error(`[service-map] extension folder unavailable: ${String(e)}`));
    this.dispose = registerHandlers(ipc, collectors, store);
  }

  onDeactivate() {
    this.dispose?.();
    this.collectors?.stopAll();
  }
}
