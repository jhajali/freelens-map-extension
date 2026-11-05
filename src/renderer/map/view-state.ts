import { useCallback, useMemo } from "react";
import { type ClusterRecord, DEFAULT_RECORD, ServiceMapStore } from "../../common/store/map-store";

export interface ViewState {
  record: ClusterRecord;
  set: (patch: Partial<ClusterRecord>) => void;
  reset: () => void;
  /** forgets where the user moved the boxes of one view (`"<view>|<hops>"`) */
  resetPositions: (key: string) => void;
  /** remembers where nodes of one view were moved, over what the store holds now */
  savePositions: (key: string, moved: Record<string, { x: number; y: number }>) => void;
}

/** The cluster's remembered view. Call it from an `observer`: the reads below are what re-render it. */
export function useViewState(
  clusterId: string,
  store: ServiceMapStore = ServiceMapStore.getInstance<ServiceMapStore>(),
): ViewState {
  const stored = store.clusters[clusterId];
  const palette = store.defaultPalette;
  // record() copies the defaults on every call; the stored object only changes when the record does
  const record = useMemo(() => store.record(clusterId), [store, clusterId, stored, palette]);
  // no active cluster: nothing to remember, and no "" record to write
  const set = useCallback(
    (patch: Partial<ClusterRecord>) => clusterId && store.update(clusterId, patch),
    [store, clusterId],
  );
  const reset = useCallback(() => {
    if (!clusterId) return;
    const d = structuredClone(DEFAULT_RECORD);
    store.update(clusterId, { filters: d.filters, hops: d.hops, layer: d.layer });
  }, [store, clusterId]);
  const resetPositions = useCallback(
    (key: string) => {
      if (!clusterId) return;
      const { [key]: _, ...rest } = store.record(clusterId).positions;
      store.update(clusterId, { positions: rest });
    },
    [store, clusterId],
  );
  const savePositions = useCallback(
    (key: string, moved: Record<string, { x: number; y: number }>) => {
      if (!clusterId) return;
      const positions = store.record(clusterId).positions;
      store.update(clusterId, { positions: { ...positions, [key]: { ...positions[key], ...moved } } });
    },
    [store, clusterId],
  );
  return { record, set, reset, resetPositions, savePositions };
}
