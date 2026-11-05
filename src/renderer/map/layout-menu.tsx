// The Layout menu of the top bar: spacing, grouping, direction, link labels, export and anonymized names.
import styles from "./service-map.module.scss";
import { Icon } from "./toolbar";

import type { LayoutPrefs } from "../../common/store/map-store";

export interface LayoutMenuProps {
  prefs: LayoutPrefs;
  onChange: (p: LayoutPrefs) => void;
  onResetPositions: () => void;
  onExport: (kind: "png" | "svg") => void;
  anonymize: boolean;
  onAnonymize: () => void;
}

export function LayoutMenu(p: LayoutMenuProps) {
  const { prefs } = p;
  return (
    <details className={styles.data}>
      <summary className={styles.chip}>
        <Icon n="layout" />
        Layout
        <Icon n="down" />
      </summary>
      <div className={styles.dataPanel}>
        <label>
          Spacing
          <input
            type="range"
            min={0.6}
            max={2}
            step={0.1}
            value={prefs.space}
            onChange={(e) => p.onChange({ ...prefs, space: Number(e.target.value) })}
          />
        </label>
        <label>
          <input
            type="checkbox"
            checked={prefs.explode}
            onChange={() => p.onChange({ ...prefs, explode: !prefs.explode })}
          />{" "}
          Explode release boxes
        </label>
        <label>
          <input
            type="checkbox"
            checked={prefs.labels}
            onChange={() => p.onChange({ ...prefs, labels: !prefs.labels })}
          />{" "}
          Link labels
        </label>
        <button
          type="button"
          className={styles.chip}
          onClick={() => p.onChange({ ...prefs, dir: prefs.dir === "RIGHT" ? "LEFT" : "RIGHT" })}
        >
          Flip direction
        </button>
        <button type="button" className={styles.chip} onClick={p.onResetPositions}>
          Reset positions
        </button>
        <button type="button" className={styles.chip} onClick={() => p.onExport("png")}>
          Export PNG
        </button>
        <button type="button" className={styles.chip} onClick={() => p.onExport("svg")}>
          Export SVG
        </button>
        <label>
          <input type="checkbox" checked={p.anonymize} onChange={p.onAnonymize} /> Anonymize names
        </label>
      </div>
    </details>
  );
}
