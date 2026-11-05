// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ServiceMapStore } from "../../common/store/map-store";
import { parseNamedNetworks, parsePublicEndpoints, parseService, SettingsDialog } from "./settings-dialog";

describe("parsers", () => {
  it("parses named networks and reports bad lines", () => {
    const r = parseNamedNetworks("10.0.0.0/24 = lab\n10.0.0/24 = x\n\n");
    expect(r.value).toEqual([{ cidr: "10.0.0.0/24", name: "lab" }]);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toContain("line 2");
  });

  it("parses public endpoints", () => {
    expect(parsePublicEndpoints("web/lb = shop.example.com")).toEqual({
      value: { "web/lb": "shop.example.com" },
      errors: [],
    });
    expect(parsePublicEndpoints("lb = x").errors[0]).toContain("line 1");
  });

  it("parses ns/service:port", () => {
    expect(parseService("kube-system/hubble-relay:80")).toEqual({ ns: "kube-system", name: "hubble-relay", port: 80 });
    expect(parseService("  ")).toBeNull();
    expect(parseService("a/b")).toBe("invalid");
    expect(parseService("a/b:70000")).toBe("invalid");
  });
});

describe("SettingsDialog", () => {
  it("carries the focus-ring class", () => {
    new ServiceMapStore();
    render(<SettingsDialog clusterId="c1" open onClose={vi.fn()} />);
    expect(screen.getByRole("dialog").className).toContain("dialog");
  });

  const setup = () => {
    const store = new ServiceMapStore();
    const onClose = vi.fn();
    render(<SettingsDialog clusterId="c1" open onClose={onClose} />);
    return { store, onClose };
  };

  it("saves valid settings", () => {
    const { store, onClose } = setup();
    fireEvent.change(screen.getByPlaceholderText("CPU %"), { target: { value: "70" } });
    fireEvent.change(screen.getByPlaceholderText("10.0.0.0/24 = lab"), { target: { value: "10.0.0.0/24 = lab" } });
    fireEvent.change(screen.getByPlaceholderText(/^Relay/), { target: { value: "kube-system/hubble-relay:80" } });
    fireEvent.click(screen.getByLabelText("Anonymize names", { selector: "input" }));
    fireEvent.click(screen.getByText("Save"));
    const s = store.record("c1").settings;
    expect(s.thresholds.cpu).toBe(70);
    expect(s.namedNetworks).toEqual([{ cidr: "10.0.0.0/24", name: "lab" }]);
    expect(s.relay).toEqual({ ns: "kube-system", svc: "hubble-relay", port: 80 });
    expect(s.anonymize).toBe(true);
    expect(onClose).toHaveBeenCalled();
  });

  it("does not save while a field is invalid", () => {
    const { store, onClose } = setup();
    fireEvent.change(screen.getByPlaceholderText("10.0.0.0/24 = lab"), { target: { value: "10.0.0/24 = x" } });
    fireEvent.click(screen.getByText("Save"));
    expect(screen.getByRole("alert").textContent).toContain("line 1");
    expect(store.clusters.c1).toBeUndefined();
    expect(onClose).not.toHaveBeenCalled();
  });

  const alerts = () => screen.queryAllByRole("alert").map((a) => a.textContent ?? "");
  const attempt = (placeholder: string | RegExp, value: string) => {
    const r = setup();
    fireEvent.change(screen.getByPlaceholderText(placeholder), { target: { value } });
    fireEvent.click(screen.getByText("Save"));
    expect(r.store.clusters.c1).toBeUndefined();
    expect(r.onClose).not.toHaveBeenCalled();
  };

  it("flags only the empty threshold", () => {
    attempt("RAM %", "");
    expect(alerts()).toHaveLength(1);
    expect(alerts()[0]).toContain("ram");
  });

  it("rejects a percentage above 100", () => {
    attempt("CPU %", "500");
    expect(alerts().join()).toContain("cpu");
  });

  it("reports an invalid data source", () => {
    attempt(/^Relay/, "kube-system/relay");
    expect(alerts().join()).toContain("Relay");
  });

  it("reports a bad public endpoint", () => {
    attempt("ns/service = endpoint", "lb = x");
    expect(alerts().join()).toContain("line 1");
  });
});
