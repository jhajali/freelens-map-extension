// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DataMenu } from "./data-menu";

import type { LiveState } from "./live-map";

const state: LiveState = {
  snapshot: null,
  baseline: null,
  sources: [
    { id: "kubernetes", ok: true, detail: "objects listed", fix: null },
    {
      id: "prometheus",
      ok: false,
      detail: "service proxy denied",
      fix: 'needs "get" on "services/proxy" in observability',
    },
    { id: "hubble", ok: true, detail: "hubble-relay", fix: null },
  ],
  level: "Hubble only",
  sampled: { cpu: new Set(), mem: new Set() },
  truncated: 0,
  l7: true,
};

describe("DataMenu", () => {
  it("lists every source with its fix", () => {
    const { container } = render(<DataMenu state={state} />);
    expect(container.querySelector("summary")?.textContent).toBe("Data: Hubble only");
    const text = container.textContent ?? "";
    expect(text).toContain("✓ Kubernetes objects listed");
    expect(text).toContain("✗ Prometheus service proxy denied");
    expect(text).toContain('needs "get" on "services/proxy" in observability');
    expect(text).toContain("✓ Hubble Relay hubble-relay");
  });

  it("says traffic needs Hubble Relay when it is not there", () => {
    const hubble = (fix: string | null) =>
      render(<DataMenu state={{ ...state, sources: [{ id: "hubble", ok: false, detail: "connecting", fix }] }} />)
        .container.textContent;
    expect(hubble(null)).toBe(
      "Data: Hubble only✗ Hubble Relay connectingtraffic needs Hubble RelayChanges baseline: none yet",
    );
    expect(hubble("enable it")).toContain("✗ Hubble Relay connectingenable it · traffic needs Hubble Relay");
  });

  it("names the baseline in use", () => {
    const flows = { edges: [], windowSec: 60, capturedAt: "2026-11-05T09:07:00Z" };
    const line = (baseline: LiveState["baseline"]) =>
      render(<DataMenu state={{ ...state, baseline }} />).container.textContent;
    expect(line(null)).toContain("Changes baseline: none yet");
    expect(line({ flows, source: "since-opened" })).toContain("Changes baseline: since the map was opened");
    const hhmm = new Date(flows.capturedAt).toTimeString().slice(0, 5);
    expect(line({ flows, source: "snapshot" })).toContain(`Changes baseline: snapshot from ${hhmm}`);
  });
});
