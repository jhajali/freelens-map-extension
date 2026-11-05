// The two toolbar rows of the map page. It holds no state: the page owns every value and menu.
import styles from "./service-map.module.scss";

import type { ReactNode } from "react";

import type { Hops, Layer } from "../../common/store/map-store";

// Lucide paths, as the prototype draws them
const ICONS = {
  alert: "M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z M12 9v4 M12 17h.01",
  globe:
    "M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0z M2 12h20 M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z",
  egress: "M7 17 17 7 M7 7h10v10",
  db: "M21 5c0 1.66-4 3-9 3S3 6.66 3 5s4-3 9-3 9 1.34 9 3z M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5 M3 12c0 1.66 4 3 9 3s9-1.34 9-3",
  ban: "M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0z M4.93 4.93l14.14 14.14",
  sliders: "M4 21v-7 M4 10V3 M12 21v-9 M12 8V3 M20 21v-5 M20 12V3 M1 14h6 M9 8h6 M17 16h6",
  layout: "M3 3h7v7H3z M14 3h7v7h-7z M14 14h7v7h-7z M3 14h7v7H3z",
  search: "M19 11a8 8 0 1 1-16 0 8 8 0 0 1 16 0z M21 21l-4.3-4.3",
  down: "M6 9l6 6 6-6",
  diff: "M18 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M6 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M13 6h3a2 2 0 0 1 2 2v7 M11 18H8a2 2 0 0 1-2-2V9",
  cog: "M20 7h-9 M14 17H5 M17 20a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M7 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
  reset: "M3 12a9 9 0 1 0 3-6.7L3 8 M3 3v5h5",
};

export function Icon({ n }: { n: keyof typeof ICONS }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={ICONS[n]} />
    </svg>
  );
}

export type QuickKey = "problems" | "exposed" | "egress" | "dbs" | "drops" | "changes";

const LAYERS: Array<[Layer, string]> = [
  ["cpu", "CPU"],
  ["ram", "RAM"],
  ["health", "Pod health"],
  ["traffic", "Traffic"],
  ["policy", "Policy"],
];
const HOPS: Array<[Hops, string]> = [
  [1, "n+1"],
  [2, "n+2"],
  [0, "All links"],
];
const QUICK: Array<[QuickKey, string, keyof typeof ICONS, string]> = [
  [
    "problems",
    "Problems",
    "alert",
    "Only unhealthy workloads (not ready, restarting, >85% CPU/RAM), links with drops and broken routes",
  ],
  ["exposed", "Exposed", "globe", "Only what is reachable from a LoadBalancer / gateway, up to 3 hops in"],
  ["egress", "Egress", "egress", "Only traffic leaving the current scope"],
  ["dbs", "Databases", "db", "Only databases and the workloads that talk to them"],
  ["drops", "Drops", "ban", "Only links where Cilium dropped packets (e.g. network policy denies)"],
  ["changes", "Changes", "diff", "Only links that are new (green) or gone (grey) compared with the baseline capture"],
];

export interface ToolbarProps {
  crumbs: Array<{ label: string; onClick?: () => void }>;
  layer: Layer;
  onLayer: (l: Layer) => void;
  /** Absent where the view has no n+1/n+2 scope. */
  hops?: Hops;
  onHops: (h: Hops) => void;
  quick: Record<QuickKey, boolean>;
  onQuick: (key: QuickKey) => void;
  /** chips that cannot be used now, with the reason as their title */
  disabled?: Partial<Record<QuickKey, string>>;
  onReset: () => void;
  search: string;
  onSearch: (q: string) => void;
  onSearchEnter: () => void;
  onSearchEscape?: () => void;
  menus: { layout: ReactNode; data: ReactNode; filters: ReactNode };
  onSettings: () => void;
}

export function Toolbar(p: ToolbarProps) {
  return (
    <>
      <div className={styles.top} role="toolbar" aria-label="Map">
        <nav className={styles.crumb} aria-label="Breadcrumb">
          {p.crumbs.map((c, i) => (
            <span key={i}>
              {i > 0 && " › "}
              {c.onClick ? (
                <button type="button" className={styles.crumbLink} onClick={c.onClick}>
                  {c.label}
                </button>
              ) : (
                <b>{c.label}</b>
              )}
            </span>
          ))}
        </nav>
        <span className={styles.note}>Color by</span>
        <span className={styles.seg}>
          {LAYERS.map(([v, label]) => (
            <button
              key={v}
              type="button"
              className={styles.chip}
              aria-pressed={p.layer === v}
              onClick={() => p.onLayer(v)}
            >
              {label}
            </button>
          ))}
        </span>
        <span className={styles.spacer} />
        {p.hops !== undefined && (
          <>
            <span className={styles.note}>Show</span>
            <span className={styles.seg}>
              {HOPS.map(([v, label]) => (
                <button
                  key={v}
                  type="button"
                  className={styles.chip}
                  aria-pressed={p.hops === v}
                  onClick={() => p.onHops(v)}
                >
                  {label}
                </button>
              ))}
            </span>
          </>
        )}
        {p.menus.layout}
        {p.menus.data}
        <button type="button" className={styles.chip} onClick={p.onSettings}>
          <Icon n="cog" />
          Settings
        </button>
      </div>
      <div className={styles.top}>
        <span className={styles.sbox}>
          <Icon n="search" />
          <input
            className={styles.search}
            type="search"
            aria-label="Find workload or namespace"
            placeholder="Find workload or namespace…"
            value={p.search}
            onChange={(e) => p.onSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") p.onSearchEnter();
              if (e.key === "Escape") p.onSearchEscape?.();
            }}
          />
        </span>
        {QUICK.map(([k, label, icon, help]) => (
          <button
            key={k}
            type="button"
            className={styles.chip}
            title={p.disabled?.[k] ?? help}
            disabled={!!p.disabled?.[k]}
            aria-pressed={p.quick[k]}
            onClick={() => p.onQuick(k)}
          >
            <Icon n={icon} />
            {label}
          </button>
        ))}
        {p.menus.filters}
        <span className={styles.spacer} />
        <button type="button" className={styles.chip} onClick={p.onReset}>
          <Icon n="reset" />
          Reset
        </button>
      </div>
    </>
  );
}

/** A placeholder for a menu a later task fills (Filters: Task 8): the summary and an empty panel. */
export function MenuStub({ icon, label }: { icon: "layout" | "sliders"; label: string }) {
  return (
    <details className={styles.data}>
      <summary className={styles.chip}>
        <Icon n={icon} />
        {label}
        <Icon n="down" />
      </summary>
    </details>
  );
}
