import { useContext } from "react";
import { linkVerdict } from "../../../common/graph/layers";
import { AliasContext, nameOf } from "../nodes";
import styles from "../service-map.module.scss";
import { CappedTable, Pills, Sec, Spark, Tile, Tiles } from "./parts";

import type { RateHistory } from "../../../common/graph/history";
import type { MapEdge, Snapshot } from "../../../common/graph/types";

export interface LinkDetailsProps {
  e: MapEdge;
  s: Snapshot;
  history: RateHistory;
  protectedNs: (ns: string) => boolean;
  l7: boolean;
  /** an endpoint id of the link, to select it */
  onSelect: (id: string) => void;
}

const VERDICT = {
  dropped: ["Dropped", "var(--crit)"],
  protected: ["Protected", "var(--good)"],
  "default-allow": ["Default allow", "var(--warn)"],
} as const;

export function LinkDetails({ e, s, history, protectedNs, l7, onSelect }: LinkDetailsProps) {
  const byId = new Map(s.workloads.map((w) => [w.id, w]));
  const a = useContext(AliasContext);
  const total = [...e.apps.values()].reduce((a, v) => a + v, 0);
  const apps = [...e.apps].sort((a, b) => b[1] - a[1]).slice(0, 5);
  // idx points at the raw links this one aggregates
  const conns = e.idx.reduce((a, i) => a + (s.edges[i]?.connsPerSec ?? 0), 0);
  const verdict = VERDICT[linkVerdict(e, s, protectedNs)];
  const end = (id: string) => (
    <button type="button" className={styles.chip} data-testid="link-end" onClick={() => onSelect(id)}>
      {nameOf(id, s, byId, a)}
    </button>
  );

  return (
    <>
      <div className={styles.st}>
        {end(e.source)} → {end(e.target)}
      </div>
      {apps.length > 0 && (
        <Pills items={apps.map(([a, r]) => [`${a} ${Math.round((r / (total || 1)) * 100)}%`, "var(--l-web)"])} />
      )}
      <Tiles>
        <Tile k="flows/s" v={e.synthetic ? "–" : e.rate.toFixed(2)} />
        {!e.synthetic && <Tile k="connections/s" v={conns.toFixed(2)} />}
        <Tile
          k="drop %"
          v={e.rate ? `${((e.drops / e.rate) * 100).toFixed(1)}%` : "–"}
          warn={e.rate > 0 && e.drops / e.rate > 0.01}
        />
      </Tiles>
      <Sec title="Traffic (live)">
        <Spark values={history.edge(e.id)} />
      </Sec>
      <Sec title="Latency & errors">
        {/* Sample has no HTTP code or latency fields, so nothing can be derived even with L7 on */}
        <div className={styles.note}>
          {l7
            ? "L7 is on, but the captured flows carry no HTTP codes or latency for this link"
            : "needs L7 visibility: enable it in Cilium to see HTTP codes and latency"}
        </div>
      </Sec>
      <Sec title="Policy">
        <Pills items={[[verdict[0], verdict[1]]]} />
      </Sec>
      {e.lbs.length > 0 && (
        <Sec title="Load balancer" n={e.lbs.length}>
          <CappedTable
            head={
              <tr>
                <th>IP</th>
                <th>Ports</th>
                <th>Via</th>
                <th />
              </tr>
            }
            rows={e.lbs.map((l) => (
              <tr key={`${l.kind}/${l.ns}/${l.name}`}>
                <td className={styles.mono}>{l.ips.map((ip) => a("ip", ip)).join(", ")}</td>
                <td className={styles.mono}>{l.ports.map((p) => `${p.port}/${p.protocol}`).join(" ")}</td>
                <td>
                  {l.kind} {a("obj", `${l.ns}/${l.name}`)}
                </td>
                <td>
                  <Pills items={[[l.exposure, l.exposure === "public" ? "var(--warn)" : "var(--muted)"]]} />
                </td>
              </tr>
            ))}
          />
        </Sec>
      )}
      {e.routes.length > 0 && (
        <Sec title="HTTPRoutes" n={e.routes.length}>
          <CappedTable
            head={
              <tr>
                <th>Host</th>
                <th>Path</th>
                <th>Backend</th>
              </tr>
            }
            rows={e.routes.map((r) => (
              <tr key={`${r.kind}/${r.ns}/${r.name}/${r.host}${r.path}/${r.service}:${r.port}`}>
                <td>{r.host ? a("host", r.host) : "*"}</td>
                <td>{a("path", r.path || "/")}</td>
                <td>
                  {a("svc", `${r.ns}/${r.service}`)}
                  {r.port != null && `:${r.port}`}
                  {r.target === null && <span className={styles.warn}> ▲ no ready pods</span>}
                </td>
              </tr>
            ))}
          />
        </Sec>
      )}
      <Sec title="Connections" n={e.samples.length}>
        <CappedTable
          head={
            <tr>
              <th>Connection</th>
              <th>DNS</th>
              <th>Count</th>
            </tr>
          }
          rows={e.samples.map((x, i) => (
            <tr key={`${x.srcIp}>${x.dstIp}:${x.port}#${i}`}>
              <td className={styles.mono}>
                {x.srcPod ? a("pod", x.srcPod) : a("ip", x.srcIp)} → {x.dstPod ? a("pod", x.dstPod) : a("ip", x.dstIp)}
                {x.port != null && `:${x.port}`}
              </td>
              <td>{x.dns ? a("host", x.dns) : "–"}</td>
              <td>{x.count}</td>
            </tr>
          ))}
        />
      </Sec>
    </>
  );
}
