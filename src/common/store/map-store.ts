import { Common } from "@freelensapp/extensions";
import { observable } from "mobx";
import { DEFAULT_THRESHOLDS, type Direction, type Filters, type Thresholds } from "../graph/types";

import type { NamedNetworks } from "../graph/view";

export type Layer = "cpu" | "ram" | "health" | "traffic" | "policy";
export type Hops = 0 | 1 | 2; // 0 = all links
export interface StoredFilters {
  hiddenNs: string[];
  labels: Array<[string, string | null]>;
  apps: string[];
  kinds: string[];
  direction: Direction;
  minRate: number;
  hideIdle: boolean;
  infra: boolean;
  problems: boolean;
  exposed: boolean;
  dbs: boolean;
  drops: boolean;
  changes: boolean;
}
export interface LayoutPrefs {
  space: number;
  dir: "RIGHT" | "LEFT";
  labels: boolean;
  explode: boolean;
  panelWidth: number;
}
export interface ClusterSettings {
  thresholds: Thresholds;
  namedNetworks: NamedNetworks;
  lbPublic: Record<string, string>;
  palette: "default" | "cb";
  anonymize: boolean;
  relay: { ns: string; svc: string; port: number } | null;
  prometheus: { ns: string; name: string; port: number } | null;
}
export interface ClusterRecord {
  settings: ClusterSettings;
  filters: StoredFilters;
  hops: Hops;
  layer: Layer;
  layout: LayoutPrefs;
  // key `${view ?? ""}|${hops}` -> node id -> position
  positions: Record<string, Record<string, { x: number; y: number }>>;
}

export const DEFAULT_RECORD: ClusterRecord = {
  settings: {
    thresholds: DEFAULT_THRESHOLDS,
    namedNetworks: [],
    lbPublic: {},
    palette: "default",
    anonymize: false,
    relay: null,
    prometheus: null,
  },
  filters: {
    hiddenNs: [],
    labels: [],
    apps: [],
    kinds: [],
    direction: "all",
    minRate: 0,
    hideIdle: false,
    infra: false,
    problems: false,
    exposed: false,
    dbs: false,
    drops: false,
    changes: false,
  },
  hops: 1,
  layer: "health",
  layout: { space: 1, dir: "RIGHT", labels: true, explode: false, panelWidth: 380 },
  positions: {},
};

export function toFilters(f: StoredFilters): Filters {
  return { ...f, hiddenNs: new Set(f.hiddenNs), apps: new Set(f.apps), kinds: new Set(f.kinds) };
}

interface StoreModel {
  clusters: Record<string, ClusterRecord>;
  defaultPalette: "default" | "cb";
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

const pick = <T>(v: unknown, allowed: readonly T[], fallback: T): T => (allowed.includes(v as T) ? (v as T) : fallback);
const num = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);
const bool = (v: unknown, fallback: boolean) => (typeof v === "boolean" ? v : fallback);
const strings = (v: unknown, fallback: string[]) =>
  Array.isArray(v) && v.every((x) => typeof x === "string") ? (v as string[]) : fallback;
const rec = <T>(v: unknown, fallback: Record<string, T>) => (isObj(v) ? (v as Record<string, T>) : fallback);
const target = (v: unknown, fallback: { ns: string; port: number } & Record<string, unknown>) =>
  isObj(v) && typeof v.ns === "string" && Object.values(v).every((x) => typeof x === "string" || typeof x === "number")
    ? v
    : fallback;

// Merges a stored (possibly older or corrupt) record over a fresh copy of the defaults, field by field.
function sanitize(raw: unknown, defaultPalette: "default" | "cb"): ClusterRecord {
  const d = structuredClone(DEFAULT_RECORD);
  const r = isObj(raw) ? raw : {};
  const s = isObj(r.settings) ? r.settings : {};
  const t = isObj(s.thresholds) ? s.thresholds : {};
  const f = isObj(r.filters) ? r.filters : {};
  const l = isObj(r.layout) ? r.layout : {};
  const df = d.filters;
  const dl = d.layout;
  return {
    settings: {
      thresholds: {
        cpu: num(t.cpu, d.settings.thresholds.cpu),
        ram: num(t.ram, d.settings.thresholds.ram),
        restarts: num(t.restarts, d.settings.thresholds.restarts),
      },
      namedNetworks: Array.isArray(s.namedNetworks)
        ? s.namedNetworks.filter((n) => isObj(n) && typeof n.cidr === "string" && typeof n.name === "string")
        : d.settings.namedNetworks,
      lbPublic: rec(s.lbPublic, d.settings.lbPublic),
      palette: pick(s.palette, ["default", "cb"], defaultPalette),
      anonymize: bool(s.anonymize, d.settings.anonymize),
      relay: target(s.relay, null as never) as ClusterSettings["relay"],
      prometheus: target(s.prometheus, null as never) as ClusterSettings["prometheus"],
    },
    filters: {
      hiddenNs: strings(f.hiddenNs, df.hiddenNs),
      labels: Array.isArray(f.labels)
        ? (f.labels.filter(
            (p) => Array.isArray(p) && typeof p[0] === "string" && (p[1] === null || typeof p[1] === "string"),
          ) as StoredFilters["labels"])
        : df.labels,
      apps: strings(f.apps, df.apps),
      kinds: strings(f.kinds, df.kinds),
      direction: pick(f.direction, ["all", "inbound", "outbound", "internal"], df.direction),
      minRate: num(f.minRate, df.minRate),
      hideIdle: bool(f.hideIdle, df.hideIdle),
      infra: bool(f.infra, df.infra),
      problems: bool(f.problems, df.problems),
      exposed: bool(f.exposed, df.exposed),
      dbs: bool(f.dbs, df.dbs),
      drops: bool(f.drops, df.drops),
      changes: bool(f.changes, df.changes),
    },
    hops: pick(r.hops, [0, 1, 2], d.hops),
    layer: pick(r.layer, ["cpu", "ram", "health", "traffic", "policy"], d.layer),
    layout: {
      space: num(l.space, dl.space),
      dir: pick(l.dir, ["RIGHT", "LEFT"], dl.dir),
      labels: bool(l.labels, dl.labels),
      explode: bool(l.explode, dl.explode),
      panelWidth: num(l.panelWidth, dl.panelWidth),
    },
    positions: rec(r.positions, d.positions),
  };
}

export class ServiceMapStore extends Common.Store.ExtensionStore<StoreModel> {
  @observable accessor clusters: Record<string, ClusterRecord> = {};
  @observable accessor defaultPalette: "default" | "cb" = "default";

  constructor() {
    super({ configName: "service-map", defaults: { clusters: {}, defaultPalette: "default" } });
  }

  fromStore(data: Partial<StoreModel>) {
    this.clusters = isObj(data.clusters) ? data.clusters : {};
    this.defaultPalette = data.defaultPalette === "cb" ? "cb" : "default";
  }

  toJSON(): StoreModel {
    return { clusters: { ...this.clusters }, defaultPalette: this.defaultPalette };
  }

  record(clusterId: string): ClusterRecord {
    return sanitize(this.clusters[clusterId], this.defaultPalette);
  }

  update(clusterId: string, patch: Partial<ClusterRecord>) {
    this.clusters = { ...this.clusters, [clusterId]: { ...this.record(clusterId), ...patch } };
  }
}
