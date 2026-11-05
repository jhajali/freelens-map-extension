import { AvoidLib } from "libavoid-js";

export type Avoid = ReturnType<typeof AvoidLib.getInstance>;

let loading: Promise<Avoid | null> | null = null;

/** Loads libavoid from the extension bundle once; resolves null (never throws) when WebAssembly is unavailable. */
export function loadAvoid(): Promise<Avoid | null> {
  loading ??= AvoidLib.load(new URL(/* @vite-ignore */ "libavoid.wasm", import.meta.url).href)
    .then(() => AvoidLib.getInstance())
    .catch((error: unknown) => {
      console.warn("[service-map] libavoid unavailable, falling back to ELK routes", error);
      return null;
    });
  return loading;
}
