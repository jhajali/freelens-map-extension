import { useContext } from "react";
import { realNames } from "../../../common/graph/anonymize";
import { protectedNamespaces } from "../../../common/graph/layers";
import { isProblem } from "../../../common/graph/view";
import { openInFreelens, openLogs, openShell } from "../actions";
import { AliasContext, cpuText, KIND_ICON, memText, nameOf, src } from "../nodes";
import styles from "../service-map.module.scss";
import { Bar, CappedTable, Pills, Sec, Spark, Tile, Tiles } from "./parts";

import type { RateHistory } from "../../../common/graph/history";
import type { MapEdge, Snapshot, Thresholds, Workload } from "../../../common/graph/types";

export interface WorkloadDetailsProps {
  w: Workload;
  s: Snapshot;
  /** the view's links */
  edges: MapEdge[];
  history: RateHistory;
  thresholds: Thresholds;
  prometheus: boolean;
  /** a link id, to select it */
  onSelect: (id: string) => void;
}

const sum = (es: MapEdge[]) => es.reduce((a, e) => a + e.rate, 0);

export function WorkloadDetails({ w, s, edges, history, thresholds, prometheus, onSelect }: WorkloadDetailsProps) {
  const byId = new Map(s.workloads.map((x) => [x.id, x]));
  const a = useContext(AliasContext);
  const inE = edges.filter((e) => e.target === w.id);
  const outE = edges.filter((e) => e.source === w.id);
  const lbs = s.loadBalancers.filter((l) => l.target === w.id);
  const routes = s.routes.filter((r) => (r.target ?? `${r.ns}/${r.service}`) === w.id);
  const status: [string, string] =
    w.ready < w.desired
      ? ["Degraded", "var(--crit)"]
      : isProblem(w, thresholds)
        ? ["Problem", "var(--warn)"]
        : ["Ready", "var(--good)"];
  const protectedBy = protectedNamespaces(s.policies)(w.ns) ? s.policies.filter((p) => !p.ns || p.ns === w.ns) : null;

  const peers = (list: MapEdge[], far: (e: MapEdge) => string) =>
    list.map((e) => (
      <tr key={e.id} data-peer={e.id} onClick={() => onSelect(e.id)} style={{ cursor: "pointer" }}>
        <td>{nameOf(far(e), s, byId, a)}</td>
        <td>{e.synthetic ? "–" : `${e.rate.toFixed(2)}/s`}</td>
      </tr>
    ));
  const peerTable = (list: MapEdge[], far: (e: MapEdge) => string) => (
    <CappedTable
      head={
        <tr>
          <th>Peer</th>
          <th>Rate</th>
        </tr>
      }
      rows={peers(list, far)}
    />
  );

  return (
    <>
      <div className={styles.head}>
        <img alt="" src={src(KIND_ICON[w.kind])} />
        <div>
          <div className={styles.st}>{a === realNames ? w.name : a("svc", w.id)}</div>
          <div className={styles.sub}>
            {w.kind === "KubeBlocks" ? `${w.kind} / ${w.chart ? a("chart", w.chart) : "-"}` : w.kind}
          </div>
        </div>
      </div>
      <Pills
        items={[
          status,
          ...(w.db ? ([["DB", "var(--l-data)"]] as Array<[string, string]>) : []),
          ...(w.release ? ([[`⎈ ${a("release", w.release)}`, "var(--muted)"]] as Array<[string, string]>) : []),
        ]}
      />
      <div>
        <button type="button" className={styles.chip} onClick={() => openInFreelens(w)}>
          Open in Freelens
        </button>
        <button type="button" className={styles.chip} onClick={() => void openLogs(w)}>
          Logs
        </button>
        <button type="button" className={styles.chip} onClick={() => void openShell(w)}>
          Shell
        </button>
      </div>
      <Tiles>
        <Tile k="pods ready" v={`${w.ready}/${w.desired}`} warn={w.ready < w.desired} />
        <Tile k="restarts" v={w.restarts} warn={w.restarts > 0} />
        <Tile k="in /s" v={sum(inE).toFixed(2)} />
        <Tile k="out /s" v={sum(outE).toFixed(2)} />
      </Tiles>
      <Sec title="Traffic (live)">
        <Spark values={history.node(w.id)} />
      </Sec>
      <Sec title="Resources">
        {prometheus ? (
          <>
            <Bar label="CPU" used={w.cpu} limit={w.cpuLim} fmt={cpuText} />
            <Bar label="RAM" used={w.mem} limit={w.memLim} fmt={memText} />
          </>
        ) : (
          <div className={styles.note}>CPU/RAM need Prometheus</div>
        )}
      </Sec>
      {lbs.length > 0 && (
        <Sec title="Exposed via LoadBalancer" n={lbs.length}>
          {lbs.map((l) => (
            <div key={`${l.kind}/${l.ns}/${l.name}`}>
              {l.kind} <b>{a("obj", `${l.ns}/${l.name}`)}</b> {l.ips.map((ip) => a("ip", ip)).join(", ")}{" "}
              {l.ports.map((p) => `${p.port}/${p.protocol}`).join(" ")}
              <span className={styles.sub}> {l.exposure}</span>
            </div>
          ))}
        </Sec>
      )}
      {routes.length > 0 && (
        <Sec title="Exposed via HTTPRoute / Ingress" n={routes.length}>
          {routes.map((r) => (
            <div key={`${r.kind}/${r.ns}/${r.name}/${r.host}${r.path}`}>
              <span>{r.host ? a("host", r.host) : "*"}</span>
              <b>{a("path", r.path || "/")}</b>
              <span className={styles.sub}>
                {" "}
                → svc {a("svc", `${r.ns}/${r.service}`)}:{r.port}
              </span>
            </div>
          ))}
        </Sec>
      )}
      <Sec title="Network policy">
        {protectedBy ? (
          protectedBy.map((p) => (
            <div key={`${p.kind}/${p.ns}/${p.name}`}>
              protected by {p.kind} <b>{a("obj", `${p.ns ?? ""}/${p.name}`)}</b>
            </div>
          ))
        ) : (
          <div className={styles.warn}>
            ▲ No NetworkPolicy or CiliumNetworkPolicy applies to {a("ns", w.ns)}: all traffic is allowed (default
            allow).
          </div>
        )}
      </Sec>
      <Sec title="Inbound" n={inE.length}>
        {peerTable(inE, (e) => e.source)}
      </Sec>
      <Sec title="Outbound" n={outE.length}>
        {peerTable(outE, (e) => e.target)}
      </Sec>
      <Sec title="Pods" n={w.pods.length}>
        <CappedTable
          head={
            <tr>
              <th>Pod</th>
              <th>Phase</th>
              <th>Restarts</th>
              <th>CPU</th>
              <th>RAM</th>
            </tr>
          }
          rows={w.pods.map((p) => (
            <tr key={p.name}>
              <td className={styles.mono} title={a("pod", p.name)}>
                {a("pod", p.name)}
              </td>
              <td>{p.phase}</td>
              <td className={p.restarts ? styles.warn : undefined}>{p.restarts}</td>
              <td>{prometheus ? cpuText(p.cpu) : "–"}</td>
              <td>{prometheus ? memText(p.mem) : "–"}</td>
            </tr>
          ))}
        />
      </Sec>
      <Sec title="Labels" n={Object.keys(w.labels).length} open={false}>
        {Object.entries(w.labels).map(([k, v]) => (
          <div key={k} className={`${styles.sub} ${styles.mono}`}>
            {k}={a("label", v)}
          </div>
        ))}
      </Sec>
    </>
  );
}
