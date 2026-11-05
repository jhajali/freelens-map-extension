import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";

// The .proto files are copied next to dist/main.js at build time (Cilium v1.20.2, api/v1).
const protoDir = join(dirname(fileURLToPath(import.meta.url)), "hubble-proto");

type ObserverClient = grpc.Client & { GetFlows(request: object): grpc.ClientReadableStream<{ flow?: unknown }> };
let Observer: (new (target: string, creds: grpc.ChannelCredentials) => ObserverClient) | null = null;

function observer() {
  if (!Observer) {
    const def = protoLoader.loadSync(join(protoDir, "observer/observer.proto"), {
      includeDirs: [protoDir],
      keepCase: true,
      longs: String,
      enums: String,
      defaults: false,
      oneofs: true,
    });
    const pkg = grpc.loadPackageDefinition(def) as unknown as { observer: { Observer: typeof Observer } };
    Observer = pkg.observer.Observer;
  }
  return Observer!;
}

/** Streams Hubble flows from Relay at `target` (host:port). `last` set = finite history, unset = follow. Returns a cancel function. */
export function streamFlows(
  target: string,
  opts: { namespaces?: string[]; last?: number },
  onFlow: (flow: unknown) => void,
  onEnd?: (error?: Error) => void,
): () => void {
  const client = new (observer())(target, grpc.credentials.createInsecure());
  const nsFilter = opts.namespaces?.length
    ? opts.namespaces.flatMap((ns) => [{ source_pod: [`${ns}/`] }, { destination_pod: [`${ns}/`] }])
    : undefined;
  const call = client.GetFlows({
    number: opts.last ?? 0,
    follow: opts.last === undefined,
    ...(nsFilter ? { whitelist: nsFilter } : {}),
  });
  call.on("data", (resp) => resp.flow && onFlow(resp.flow));
  call.on("error", (error: grpc.ServiceError) => {
    if (error.code !== grpc.status.CANCELLED) onEnd?.(error);
  });
  call.on("end", () => {
    onEnd?.();
    client.close();
  });
  return () => {
    call.cancel();
    client.close();
  };
}
