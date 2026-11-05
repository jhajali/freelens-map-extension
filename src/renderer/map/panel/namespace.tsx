import { useContext } from "react";
import { AliasContext, cpuText, KIND_ICON, memText, nameOf, src } from "../nodes";
import styles from "../service-map.module.scss";
import { CappedTable, Pills, Sec, Spark, Tile, Tiles } from "./parts";

import type { RateHistory } from "../../../common/graph/history";
import type { MapEdge, Snapshot } from "../../../common/graph/types";

const sum = (es: MapEdge[]) => es.reduce((a, e) => a + e.rate, 0);

function LinkTable({
  list,
  s,
  self,
  onSelect,
}: {
  list: MapEdge[];
  s: Snapshot;
  self: string;
  onSelect: (id: string) => void;
}) {
  const byId = new Map(s.workloads.map((w) => [w.id, w]));
  const a = useContext(AliasContext);
  return (
    <CappedTable
      head={
        <tr>
          <th>Peer</th>
          <th>Rate</th>
        </tr>
      }
      rows={list.map((e) => (
        <tr key={e.id} data-peer={e.id}>
          <td>
            <button type="button" className={styles.chip} onClick={() => onSelect(e.id)}>
              {e.source === self ? "→" : "←"} {nameOf(e.source === self ? e.target : e.source, s, byId, a)}
            </button>
          </td>
          <td>{e.synthetic ? "–" : `${e.rate.toFixed(2)}/s`}</td>
        </tr>
      ))}
    />
  );
}

export interface NamespaceDetailsProps {
  /** the namespace name, without the "ns:" prefix */
  ns: string;
  s: Snapshot;
  /** the view's links */
  edges: MapEdge[];
  history: RateHistory;
  protectedNs: (ns: string) => boolean;
  prometheus: boolean;
  /** a link id, to select it */
  onSelect: (id: string) => void;
  /** drill into the namespace */
  onOpen: () => void;
}

export function NamespaceDetails({
  ns,
  s,
  edges,
  history,
  protectedNs,
  prometheus,
  onSelect,
  onOpen,
}: NamespaceDetailsProps) {
  const id = `ns:${ns}`;
  const a = useContext(AliasContext);
  const ws = s.workloads.filter((w) => w.ns === ns);
  const ids = new Set(ws.map((w) => w.id));
  const ready = ws.reduce((a, w) => a + w.ready, 0);
  const want = ws.reduce((a, w) => a + w.desired, 0);
  const mine = edges.filter((e) => e.source === id || e.target === id);
  const lbs = s.loadBalancers.filter((l) => l.target && ids.has(l.target));
  const routes = s.routes.filter((r) => r.ns === ns);
  const policies = protectedNs(ns) ? s.policies.filter((p) => !p.ns || p.ns === ns) : null;
  const releases = new Map<string, { chart: string | null; pods: number; want: number }>();
  for (const w of ws) {
    if (!w.release) continue;
    const r = releases.get(w.release) ?? { chart: w.chart, pods: 0, want: 0 };
    r.chart ??= w.chart;
    r.pods += w.ready;
    r.want += w.desired;
    releases.set(w.release, r);
  }
  return (
    <>
      <div className={styles.head}>
        <img alt="" src={src(KIND_ICON.Deployment)} />
        <div>
          <div className={styles.st}>{a("ns", ns)}</div>
          <div className={styles.sub}>namespace</div>
        </div>
      </div>
      <div>
        <button type="button" className={styles.chip} onClick={onOpen}>
          Open
        </button>
      </div>
      <Tiles>
        <Tile k="workloads" v={ws.length} />
        <Tile k="pods ready" v={`${ready}/${want}`} warn={ready < want} />
        {prometheus && <Tile k="CPU" v={cpuText(ws.reduce((a, w) => a + w.cpu, 0))} />}
        {prometheus && <Tile k="RAM" v={memText(ws.reduce((a, w) => a + w.mem, 0))} />}
        <Tile k="flows/s" v={sum(mine).toFixed(2)} />
      </Tiles>
      <Sec title="Traffic (live)">
        <Spark values={history.node(id)} />
      </Sec>
      {(lbs.length > 0 || routes.length > 0) && (
        <Sec title="Entry points" n={lbs.length + routes.length}>
          {lbs.map((l) => (
            <div key={`${l.kind}/${l.ns}/${l.name}`}>
              {l.kind} <b>{a("obj", `${l.ns}/${l.name}`)}</b> {l.ips.map((ip) => a("ip", ip)).join(", ")}
              <span className={styles.sub}> {l.exposure}</span>
            </div>
          ))}
          {routes.map((r) => (
            <div key={`${r.kind}/${r.ns}/${r.name}/${r.host}${r.path}/${r.service}:${r.port}`}>
              {r.host ? a("host", r.host) : "*"}
              <b>{a("path", r.path || "/")}</b>
              <span className={styles.sub}>
                {" "}
                → svc {a("svc", `${r.ns}/${r.service}`)}
                {r.port != null && `:${r.port}`}
              </span>
            </div>
          ))}
        </Sec>
      )}
      <Sec title="Network policy">
        {policies ? (
          policies.map((p) => (
            <div key={`${p.kind}/${p.ns}/${p.name}`}>
              protected by {p.kind} <b>{a("obj", `${p.ns ?? ""}/${p.name}`)}</b>
            </div>
          ))
        ) : (
          <div className={styles.warn}>
            ▲ No NetworkPolicy or CiliumNetworkPolicy applies to {a("ns", ns)}: default allow.
          </div>
        )}
      </Sec>
      <Sec title="Helm releases" n={releases.size}>
        <CappedTable
          head={
            <tr>
              <th>Release</th>
              <th>Chart</th>
              <th>Pods</th>
            </tr>
          }
          rows={[...releases].map(([name, r]) => (
            <tr key={name}>
              <td>⎈ {a("release", name)}</td>
              <td>{r.chart ? a("chart", r.chart) : "–"}</td>
              <td className={r.pods < r.want ? styles.warn : undefined}>
                {r.pods}/{r.want}
              </td>
            </tr>
          ))}
        />
      </Sec>
      <Sec title="Links" n={mine.length}>
        <LinkTable list={mine} s={s} self={id} onSelect={onSelect} />
      </Sec>
    </>
  );
}

export interface OutsideDetailsProps {
  id: string;
  s: Snapshot;
  edges: MapEdge[];
  /** a link id, to select it */
  onSelect: (id: string) => void;
}

export function OutsideDetails({ id, s, edges, onSelect }: OutsideDetailsProps) {
  const byId = new Map(s.workloads.map((w) => [w.id, w]));
  const a = useContext(AliasContext);
  const mine = edges.filter((e) => e.source === id || e.target === id);
  // the far side of each connection, by IP, with the name Hubble resolved for it
  const eps = new Map<string, { dns: string | null; count: number }>();
  for (const e of mine)
    for (const x of e.samples) {
      const ip = e.source === id ? x.srcIp : x.dstIp;
      const r = eps.get(ip) ?? { dns: null, count: 0 };
      r.dns ??= x.dns;
      r.count += x.count;
      eps.set(ip, r);
    }
  const entry =
    id === "internet" || id === "lan"
      ? s.loadBalancers.filter((l) => l.exposure === (id === "internet" ? "public" : "internal"))
      : [];
  return (
    <>
      <div className={styles.st}>{nameOf(id, s, byId, a)}</div>
      <Pills items={[[`${mine.length} links`, "var(--muted)"]]} />
      {entry.length > 0 && (
        <Sec title="Entry points" n={entry.length}>
          <CappedTable
            head={
              <tr>
                <th>IP</th>
                <th>Ports</th>
                <th>Via</th>
              </tr>
            }
            rows={entry.map((l) => (
              <tr key={`${l.kind}/${l.ns}/${l.name}`}>
                <td>{l.ips.map((ip) => a("ip", ip)).join(", ")}</td>
                <td>{l.ports.map((p) => `${p.port}/${p.protocol}`).join(" ")}</td>
                <td>
                  {l.kind} {a("obj", `${l.ns}/${l.name}`)}
                </td>
              </tr>
            ))}
          />
        </Sec>
      )}
      {eps.size > 0 && (
        <Sec title="Endpoints" n={eps.size}>
          <CappedTable
            head={
              <tr>
                <th>IP</th>
                <th>DNS</th>
                <th>Count</th>
              </tr>
            }
            rows={[...eps].map(([ip, r]) => (
              <tr key={ip}>
                <td>{a("ip", ip)}</td>
                <td>{r.dns ? a("host", r.dns) : "–"}</td>
                <td>{r.count}</td>
              </tr>
            ))}
          />
        </Sec>
      )}
      <Sec title="Links" n={mine.length}>
        <LinkTable list={mine} s={s} self={id} onSelect={onSelect} />
      </Sec>
    </>
  );
}
