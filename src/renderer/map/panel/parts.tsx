import { type ReactNode, useState } from "react";
import { tone } from "../nodes";
import styles from "../service-map.module.scss";

const CAP = 200;

export function Tile({ k, v, warn }: { k: string; v: ReactNode; warn?: boolean }) {
  return (
    <div className={styles.tile}>
      <div className={warn ? `${styles.tv} ${styles.warn}` : styles.tv}>{v}</div>
      <div className={styles.tk}>{k}</div>
    </div>
  );
}

export function Tiles({ children }: { children: ReactNode }) {
  return <div className={styles.tiles}>{children}</div>;
}

/** used of limit, toned by the share used; no limit draws an empty track */
export function Bar({
  label,
  used,
  limit,
  fmt,
}: {
  label: string;
  used: number;
  limit: number | null;
  fmt: (v: number) => string;
}) {
  const p = limit ? used / limit : 0;
  return (
    <div className={styles.bar}>
      <div className={styles.bl}>
        <span>{label}</span>
        <span>
          {fmt(used)}
          {limit ? ` / ${fmt(limit)}` : " (no limit)"}
        </span>
      </div>
      <div className={styles.bt}>
        <div className={styles.bf} style={{ width: `${Math.min(p, 1) * 100}%`, background: tone(p) }} />
      </div>
    </div>
  );
}

export function Spark({ values, color = "var(--l-web)" }: { values: number[]; color?: string }) {
  if (values.length < 2) return <div className={styles.note}>collecting…</div>;
  const max = Math.max(...values, 1e-6);
  const w = 340,
    h = 44;
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * w},${h - (v / max) * (h - 4) - 2}`).join(" ");
  return (
    <svg className={styles.spark} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden="true">
      <polygon points={`0,${h} ${pts} ${w},${h}`} style={{ fill: color, opacity: 0.14 }} />
      <polyline points={pts} style={{ fill: "none", stroke: color, strokeWidth: 2 }} />
    </svg>
  );
}

export function Pills({ items }: { items: Array<[label: string, color: string]> }) {
  return (
    <div>
      {items.map(([t, c]) => (
        <span key={t} className={styles.pill} style={{ borderColor: c, color: c }}>
          {t}
        </span>
      ))}
    </div>
  );
}

export function Sec({
  title,
  n,
  open = true,
  children,
}: {
  title: string;
  n?: number;
  open?: boolean;
  children: ReactNode;
}) {
  return (
    <details className={styles.sec} open={open}>
      <summary>
        {title}
        {n != null && <span className={styles.cnt}>{n}</span>}
      </summary>
      {children}
    </details>
  );
}

/** A table of at most 200 rows until asked for all: a busy workload has thousands of peers. */
export function CappedTable({ head, rows }: { head: ReactNode; rows: ReactNode[] }) {
  const [all, setAll] = useState(false);
  return (
    <>
      <table>
        <thead>{head}</thead>
        <tbody>{all ? rows : rows.slice(0, CAP)}</tbody>
      </table>
      {!all && rows.length > CAP && (
        <button type="button" className={styles.more} onClick={() => setAll(true)}>
          Show all {rows.length}
        </button>
      )}
    </>
  );
}
