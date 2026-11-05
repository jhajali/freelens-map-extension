// The Filters menu of the top bar: every control writes one field of the stored filters.

import { useContext, useEffect, useState } from "react";
import { AliasContext } from "./nodes";
import styles from "./service-map.module.scss";
import { Icon } from "./toolbar";

import type { Direction, Snapshot } from "../../common/graph/types";
import type { StoredFilters } from "../../common/store/map-store";

const KINDS = ["Deployment", "StatefulSet", "DaemonSet", "KubeBlocks", "Database"];
const DIRECTIONS: Array<[Direction, string]> = [
  ["all", "All"],
  ["inbound", "Inbound only"],
  ["outbound", "Outbound only"],
  ["internal", "Internal only"],
];
const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

/** One term per line: `key` or `key=value`; blank lines are ignored. */
export function parseLabels(text: string): Array<[string, string | null]> {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l): [string, string | null] => {
      const i = l.indexOf("=");
      return i < 0 ? [l, null] : [l.slice(0, i).trim(), l.slice(i + 1).trim() || null];
    });
}

export function FiltersMenu({
  s,
  filters: f,
  onChange,
}: {
  s: Snapshot;
  filters: StoredFilters;
  onChange: (f: StoredFilters) => void;
}) {
  const a = useContext(AliasContext);
  const fmt = (l: StoredFilters["labels"]) => l.map(([k, v]) => (v === null ? k : `${k}=${v}`)).join("\n");
  const [text, setText] = useState(fmt(f.labels));
  // resync after an external change (Reset), but not while the typed text already means the same terms
  useEffect(() => {
    setText((t) => (JSON.stringify(parseLabels(t)) === JSON.stringify(f.labels) ? t : fmt(f.labels)));
  }, [f.labels]);
  const set = (p: Partial<StoredFilters>) => onChange({ ...f, ...p });
  const counts = new Map<string, number>();
  for (const e of s.edges) counts.set(e.app, (counts.get(e.app) ?? 0) + 1);
  const apps = [...counts].sort((a, b) => b[1] - a[1]).map(([a]) => a);
  const active =
    f.hiddenNs.length +
    f.apps.length +
    f.kinds.length +
    f.labels.length +
    Number(f.direction !== "all") +
    Number(f.minRate > 0) +
    Number(f.hideIdle) +
    Number(f.infra);
  const grid = { display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 12, width: 520, maxHeight: "70vh" };
  const list = { display: "flex", flexDirection: "column", maxHeight: 160, overflowY: "auto" } as const;
  const check = (label: string, on: boolean, flip: () => void) => (
    <label key={label}>
      <input type="checkbox" checked={on} onChange={flip} /> {label}
    </label>
  );
  return (
    <details className={styles.data}>
      <summary className={styles.chip}>
        <Icon n="sliders" />
        Filters{active > 0 && <span className={styles.badge}>{active}</span>}
        <Icon n="down" />
      </summary>
      <div className={styles.dataPanel} style={{ ...grid, overflowY: "auto" }}>
        <fieldset aria-label="Namespaces">
          <b>Namespaces</b>{" "}
          <button type="button" className={styles.crumbLink} onClick={() => set({ hiddenNs: [] })}>
            all
          </button>{" "}
          ·{" "}
          <button type="button" className={styles.crumbLink} onClick={() => set({ hiddenNs: [...s.namespaces] })}>
            none
          </button>
          <div style={list}>
            {s.namespaces.map((ns) =>
              check(a("ns", ns), !f.hiddenNs.includes(ns), () => set({ hiddenNs: toggle(f.hiddenNs, ns) })),
            )}
          </div>
        </fieldset>
        <fieldset aria-label="Protocols">
          <b>Protocols</b>{" "}
          <button type="button" className={styles.crumbLink} onClick={() => set({ apps: [] })}>
            all
          </button>{" "}
          ·{" "}
          <button type="button" className={styles.crumbLink} onClick={() => set({ apps: toggle(f.apps, "DNS") })}>
            {f.apps.includes("DNS") ? "show DNS" : "hide DNS"}
          </button>
          <div style={list}>
            {[...apps, "HTTP route"].map((a) => (
              <label key={a}>
                <input
                  type="checkbox"
                  checked={!f.apps.includes(a)}
                  onChange={() => set({ apps: toggle(f.apps, a) })}
                />{" "}
                {a}
                {counts.has(a) && <span className={styles.sub}> {counts.get(a)}</span>}
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset aria-label="Kind">
          <b>Kind</b>
          {KINDS.map((k) => check(k, !f.kinds.includes(k), () => set({ kinds: toggle(f.kinds, k) })))}
          <div>
            <b>Direction</b>
          </div>
          {DIRECTIONS.map(([v, l]) => (
            <label key={v}>
              <input type="radio" name="direction" checked={f.direction === v} onChange={() => set({ direction: v })} />{" "}
              {l}
            </label>
          ))}
        </fieldset>
        <fieldset aria-label="Traffic">
          <b>Traffic</b>
          <label>
            Min flows/s{" "}
            <input
              type="number"
              min={0}
              step={0.01}
              aria-label="Min flows/s"
              value={f.minRate}
              onChange={(e) => set({ minRate: Math.max(0, Number(e.target.value) || 0) })}
            />
          </label>
          {check("Hide idle workloads", f.hideIdle, () => set({ hideIdle: !f.hideIdle }))}
          {check("Show node / API-server traffic", f.infra, () => set({ infra: !f.infra }))}
          <div>
            <b>Labels</b>
          </div>
          <textarea
            aria-label="Labels"
            rows={3}
            placeholder={"key or key=value, one per line"}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              set({ labels: parseLabels(e.target.value) });
            }}
          />
          <div className={styles.sub}>Window: last 5 min</div>
        </fieldset>
      </div>
    </details>
  );
}
