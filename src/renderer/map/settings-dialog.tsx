import { Renderer } from "@freelensapp/extensions";
import { useState } from "react";
import { type ClusterSettings, ServiceMapStore } from "../../common/store/map-store";
import styles from "./service-map.module.scss";

import type { NamedNetworks } from "../../common/graph/view";

const { Dialog, Input, Checkbox, Button } = Renderer.Component;

const octet = "(25[0-5]|2[0-4]\\d|1?\\d?\\d)";
const IPV4 = new RegExp(`^(${octet}\\.){3}${octet}$`);
const IPV6 = /^[0-9a-f:.]+$/i;

function validCidr(text: string): boolean {
  const [addr, prefix, ...rest] = text.split("/");
  if (rest.length || prefix === undefined || !/^\d{1,3}$/.test(prefix)) return false;
  if (IPV4.test(addr)) return Number(prefix) <= 32;
  return addr.includes(":") && IPV6.test(addr) && Number(prefix) <= 128;
}

// One `left = right` pair per non-blank line; `check` returns an error text or null.
function parsePairs<T>(
  text: string,
  check: (left: string, right: string) => string | null,
  make: (l: string, r: string) => T,
) {
  const value: T[] = [];
  const errors: string[] = [];
  text.split("\n").forEach((raw, i) => {
    const line = raw.trim();
    if (!line) return;
    const eq = line.indexOf("=");
    const [left, right] = eq < 0 ? [line, ""] : [line.slice(0, eq).trim(), line.slice(eq + 1).trim()];
    const problem = eq < 0 ? "expected `left = right`" : check(left, right);
    if (problem) errors.push(`line ${i + 1}: ${problem}`);
    else value.push(make(left, right));
  });
  return { value, errors };
}

export function parseNamedNetworks(text: string): { value: NamedNetworks; errors: string[] } {
  return parsePairs(
    text,
    (cidr, name) => (!validCidr(cidr) ? `"${cidr}" is not a CIDR` : name ? null : "name is empty"),
    (cidr, name) => ({ cidr, name }),
  );
}

export function parsePublicEndpoints(text: string): { value: Record<string, string>; errors: string[] } {
  const { value, errors } = parsePairs(
    text,
    (key, endpoint) =>
      !/^[^/\s]+\/[^/\s]+$/.test(key) ? `"${key}" is not ns/service` : endpoint ? null : "endpoint is empty",
    (key, endpoint) => [key, endpoint] as const,
  );
  return { value: Object.fromEntries(value), errors };
}

/** `ns/service:port`; empty means automatic (null). */
export function parseService(text: string): { ns: string; name: string; port: number } | null | "invalid" {
  const t = text.trim();
  if (!t) return null;
  const m = /^([^/\s:]+)\/([^/\s:]+):(\d{1,5})$/.exec(t);
  const port = m ? Number(m[3]) : 0;
  return m && port >= 1 && port <= 65535 ? { ns: m[1], name: m[2], port } : "invalid";
}

const lines = (rows: string[]) => rows.join("\n");
const svcText = (s: ({ ns: string; port: number } & ({ svc: string } | { name: string })) | null) =>
  s ? `${s.ns}/${"svc" in s ? s.svc : s.name}:${s.port}` : "";

const THRESHOLD_MAX: Record<string, number> = { cpu: 100, ram: 100, restarts: Infinity };

function thresholdErrors(raw: Record<string, string>): string[] {
  return Object.entries(raw).flatMap(([k, v]) => {
    const n = Number(v);
    return v.trim() !== "" && Number.isFinite(n) && n >= 0 && n <= THRESHOLD_MAX[k]
      ? []
      : [`${k} must be a number from 0 to ${THRESHOLD_MAX[k] === Infinity ? "any" : THRESHOLD_MAX[k]}`];
  });
}

const store = () => ServiceMapStore.getInstance<ServiceMapStore>();

function Form({ clusterId, onClose }: { clusterId: string; onClose: () => void }) {
  const initial = store().record(clusterId).settings;
  const [cpu, setCpu] = useState(String(initial.thresholds.cpu));
  const [ram, setRam] = useState(String(initial.thresholds.ram));
  const [restarts, setRestarts] = useState(String(initial.thresholds.restarts));
  const [networks, setNetworks] = useState(lines(initial.namedNetworks.map((n) => `${n.cidr} = ${n.name}`)));
  const [endpoints, setEndpoints] = useState(lines(Object.entries(initial.lbPublic).map(([k, v]) => `${k} = ${v}`)));
  const [cb, setCb] = useState(initial.palette === "cb");
  const [anonymize, setAnonymize] = useState(initial.anonymize);
  const [relay, setRelay] = useState(svcText(initial.relay));
  const [prom, setProm] = useState(svcText(initial.prometheus));
  const [errors, setErrors] = useState<Record<string, string[]>>({});

  const save = () => {
    const nets = parseNamedNetworks(networks);
    const eps = parsePublicEndpoints(endpoints);
    const rl = parseService(relay);
    const pr = parseService(prom);
    const th = { cpu: Number(cpu), ram: Number(ram), restarts: Number(restarts) };
    const found: Record<string, string[]> = {
      Problems: thresholdErrors({ cpu, ram, restarts }),
      "Named networks": nets.errors,
      "Public endpoints": eps.errors,
      "Data sources": [
        ...(rl === "invalid" ? ["Relay must be ns/service:port"] : []),
        ...(pr === "invalid" ? ["Prometheus must be ns/service:port"] : []),
      ],
    };
    if (Object.values(found).some((e) => e.length)) return setErrors(found);
    const settings: ClusterSettings = {
      thresholds: th,
      namedNetworks: nets.value,
      lbPublic: eps.value,
      palette: cb ? "cb" : "default",
      anonymize,
      relay: rl === "invalid" || rl === null ? null : { ns: rl.ns, svc: rl.name, port: rl.port },
      prometheus: pr === "invalid" ? null : pr,
    };
    store().update(clusterId, { settings });
    onClose();
  };

  const section = (title: string, ...body: React.ReactNode[]) => (
    <section key={title}>
      <h4>{title}</h4>
      {body}
      {(errors[title] ?? []).map((e) => (
        <div key={e} role="alert">
          {e}
        </div>
      ))}
    </section>
  );

  return (
    <div>
      {section(
        "Problems",
        <Input key="cpu" placeholder="CPU %" value={cpu} onChange={setCpu} />,
        <Input key="ram" placeholder="RAM %" value={ram} onChange={setRam} />,
        <Input key="restarts" placeholder="Restarts" value={restarts} onChange={setRestarts} />,
      )}
      {section(
        "Named networks",
        <Input key="n" multiLine placeholder="10.0.0.0/24 = lab" value={networks} onChange={setNetworks} />,
      )}
      {section(
        "Public endpoints",
        <Input key="e" multiLine placeholder="ns/service = endpoint" value={endpoints} onChange={setEndpoints} />,
      )}
      {section("Palette", <Checkbox key="cb" label="Color-blind safe" value={cb} onChange={setCb} />)}
      {section(
        "Anonymize names",
        <Checkbox key="an" label="Anonymize names" value={anonymize} onChange={setAnonymize} />,
      )}
      {section(
        "Data sources",
        <Input key="r" placeholder="Relay ns/service:port (empty = auto)" value={relay} onChange={setRelay} />,
        <Input key="p" placeholder="Prometheus ns/service:port (empty = auto)" value={prom} onChange={setProm} />,
      )}
      <Button label="Cancel" onClick={onClose} />
      <Button primary label="Save" onClick={save} />
    </div>
  );
}

export function SettingsDialog({
  clusterId,
  open,
  onClose,
}: {
  clusterId: string;
  open: boolean;
  onClose: () => void;
}) {
  return (
    <Dialog className={styles.dialog} isOpen={open} close={onClose} onClose={onClose} modal>
      {open && <Form clusterId={clusterId} onClose={onClose} />}
    </Dialog>
  );
}
