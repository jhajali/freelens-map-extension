// The Data menu of the top bar: which sources feed the map, why one is missing and how to fix it.
import styles from "./service-map.module.scss";

import type { LiveState } from "./live-map";

const NAMES = { kubernetes: "Kubernetes", prometheus: "Prometheus", hubble: "Hubble Relay" };

export function DataMenu({ state }: { state: LiveState }) {
  return (
    <details className={styles.data}>
      <summary>Data: {state.level}</summary>
      <div className={styles.dataPanel}>
        {state.sources.map((s) => {
          const fix = [s.fix, s.id === "hubble" && !s.ok && "traffic needs Hubble Relay"].filter(Boolean).join(" · ");
          return (
            <div key={s.id}>
              <span className={s.ok ? styles.ok : styles.warn}>{s.ok ? "✓" : "✗"}</span> <b>{NAMES[s.id]}</b> {s.detail}
              {fix && <div className={styles.fix}>{fix}</div>}
            </div>
          );
        })}
        <div className={styles.sub}>Changes baseline: {state.baselineLabel}</div>
      </div>
    </details>
  );
}
