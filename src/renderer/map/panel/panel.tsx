import {
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AliasContext, nameOf } from "../nodes";
import styles from "../service-map.module.scss";
import { Spark, Tile, Tiles } from "./parts";

import type { RateHistory } from "../../../common/graph/history";
import type { MapEdge, Snapshot } from "../../../common/graph/types";

export type Selection = { kind: "workload" | "link" | "namespace" | "cluster" | "outside"; id: string } | null;

export interface PanelProps {
  selection: Selection;
  s: Snapshot;
  /** the view's links */
  edges: MapEdge[];
  /** ids of the nodes and links drawn */
  drawn: Set<string>;
  history: RateHistory;
  /** the Data level, as the Data menu names it */
  level: string;
  width: number;
  /** the width at the end of a drag, to persist */
  onWidth: (width: number) => void;
  /** Tasks 12-14: the details of a selection on the map; the shell shows its kind, name and history until then */
  renderDetails?: (selection: NonNullable<Selection>) => ReactNode;
}

const clampWidth = (w: number) => Math.floor(Math.min(Math.max(w, 320), window.innerWidth * 0.7));
const minutes = (sec: number) => (sec >= 60 ? `${Math.round(sec / 60)}-min` : `${sec}-s`);

/** The details panel right of the map: an overview, or the selected node or link. */
export function Panel({ selection, s, edges, drawn, history, level, width, onWidth, renderDetails }: PanelProps) {
  const [open, setOpen] = useState(true);
  const [dragged, setDragged] = useState<number | null>(null);
  const byId = useMemo(() => new Map(s.workloads.map((w) => [w.id, w])), [s]);
  const a = useContext(AliasContext);
  const stop = useRef<(() => void) | null>(null);
  // unmounted mid-drag: release the listeners, persist nothing
  useEffect(() => () => stop.current?.(), []);

  // the width follows the pointer; the store gets it once, when the drag ends
  const drag = (e: ReactPointerEvent) => {
    e.preventDefault();
    let w = clampWidth(width);
    const move = (ev: PointerEvent) => setDragged((w = clampWidth(window.innerWidth - ev.clientX)));
    const off = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      stop.current = null;
    };
    const up = () => {
      off();
      setDragged(null);
      onWidth(w);
    };
    stop.current = off;
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };

  // a link id is `source>target`, also once the link is gone
  const name = (id: string) => {
    const at = id.indexOf(">");
    return selection?.kind === "link" && at > 0
      ? `${nameOf(id.slice(0, at), s, byId, a)} → ${nameOf(id.slice(at + 1), s, byId, a)}`
      : nameOf(id, s, byId, a);
  };

  return (
    <div
      className={open ? styles.sidewrap : `${styles.sidewrap} ${styles.closed}`}
      style={{ width: open ? (dragged ?? clampWidth(width)) : 12 }}
      data-testid="panel"
    >
      {open && (
        <div
          className={styles.grip}
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize details"
          tabIndex={-1}
          onPointerDown={drag}
        />
      )}
      <button
        type="button"
        className={styles.fold}
        title={open ? "collapse details" : "expand details"}
        aria-label={open ? "collapse details" : "expand details"}
        onClick={() => setOpen((o) => !o)}
      >
        {open ? "›" : "‹"}
      </button>
      {open && (
        <div className={styles.side}>
          {!selection ? (
            <>
              <div className={styles.st}>Details</div>
              <div className={styles.note}>Click a node or a link. Double-click a namespace to drill in.</div>
              <Tiles>
                <Tile k="workloads" v={s.workloads.length} />
                <Tile k="links" v={edges.length} />
                <Tile k="routes" v={s.routes.length} />
              </Tiles>
              <p className={styles.note}>
                Source: {a("cluster", s.cluster)}, {minutes(s.windowSec)} window, Data: {level}
              </p>
            </>
          ) : !drawn.has(selection.id) ? (
            <div className={styles.note}>{name(selection.id)} is no longer on the map</div>
          ) : (
            (renderDetails?.(selection) ?? (
              <>
                <div className={styles.sub}>
                  {selection.kind === "workload" ? byId.get(selection.id)?.kind : selection.kind}
                </div>
                <div className={styles.st}>{name(selection.id)}</div>
                <Spark values={selection.kind === "link" ? history.edge(selection.id) : history.node(selection.id)} />
              </>
            ))
          )}
        </div>
      )}
    </div>
  );
}
