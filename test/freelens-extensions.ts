// Minimal stub of `@freelensapp/extensions` for unit tests.
//
// The published package is a shim that reads `Common`, `Main` and `Renderer`
// off `globalThis.FreelensExtensionApi`, which the Freelens host sets before it
// loads an extension. A Vitest process has no host, so importing the real
// package throws. `vitest.config.ts` aliases the import to this file instead.
// The package ships no mocks of its own to use in its place.
//
// Only the surface the tests exercise is stubbed here, and only at runtime: the
// tests are type-checked against the real declaration of the package. Extend it
// as your tests need more of the host API.
import React from "react";
import { vi } from "vitest";

class LensExtensionKubeObject {
  apiVersion?: string;
  kind?: string;
  metadata?: { name?: string; namespace?: string };
  spec?: unknown;
  status?: unknown;

  constructor(data: Record<string, unknown> = {}) {
    Object.assign(this, data);
  }

  // As the host's, from the metadata.
  getName() {
    return this.metadata?.name ?? "";
  }

  // An empty namespace is undefined, as the host's.
  getNs() {
    return this.metadata?.namespace || undefined;
  }

  // The host returns the store it registered for one of the class's
  // `crd.apiVersions`, and throws when there is none. Without a host there is
  // never one; a test that needs a store spies on `getStore` of its class.
  static getStore(): never {
    throw new Error(`Store for ${this.name} is not registered. Extension won't work correctly.`);
  }
}

// The host's store loads the saved model with `fromStore()` and saves it
// whenever `toJSON()` changes, through a `reaction`. The stub keeps nothing; a
// test that needs that behaviour sets up the reaction itself.
let lastStore: unknown;
class ExtensionStore<M extends object> {
  constructor(_params: { configName: string; defaults: M }) {
    lastStore = this;
  }

  // the most recently constructed store, in place of the host's singleton
  static getInstance() {
    return lastStore;
  }
}

interface KubeObjectListLayoutProps {
  store: { items: unknown[] };
  renderTableContents: (item: unknown) => React.ReactNode[];
}

// Only the part of the host's list layout where it calls back into the
// extension: it calls `renderTableContents` for every item of the store from
// its own render, a child of the page, and renders the cells.
function KubeObjectListLayout({ store, renderTableContents }: KubeObjectListLayoutProps) {
  return React.createElement(
    "div",
    null,
    store.items.map((item, index) => React.createElement("div", { key: index }, ...renderTableContents(item))),
  );
}

// The host's menu item and icon, reduced to what a test can click and read.
function MenuItem({ onClick, children }: { onClick?: () => void; children?: React.ReactNode }) {
  return React.createElement("li", { role: "menuitem", onClick }, children);
}
function Icon(_props: { material?: string; svg?: string; interactive?: boolean; title?: string }) {
  return React.createElement("i");
}

// The host's form widgets, as the plain elements a test can fill and click.
function Dialog({ isOpen, className, children }: { isOpen?: boolean; className?: string; children?: React.ReactNode }) {
  return isOpen ? React.createElement("div", { role: "dialog", className }, children) : null;
}
function Input({
  value,
  placeholder,
  onChange,
}: {
  value?: string;
  placeholder?: string;
  onChange?: (v: string) => void;
}) {
  return React.createElement("input", {
    value,
    placeholder,
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => onChange?.(e.target.value),
  });
}
function Checkbox({
  label,
  value,
  onChange,
}: {
  label?: React.ReactNode;
  value?: boolean;
  onChange?: (v: boolean) => void;
}) {
  return React.createElement(
    "label",
    null,
    React.createElement("input", {
      type: "checkbox",
      checked: !!value,
      onChange: (e: React.ChangeEvent<HTMLInputElement>) => onChange?.(e.target.checked),
    }),
    label,
  );
}
function Button({ label, onClick }: { label?: React.ReactNode; onClick?: () => void }) {
  return React.createElement("button", { onClick }, label);
}

const theme = { colors: { mainBackground: "#1e2124" } };

export const Renderer = {
  // the renderer IPC class, to extend; a test never sends on it
  Ipc: class Ipc {},
  Component: {
    KubeObjectListLayout,
    MenuItem,
    Icon,
    Dialog,
    Input,
    Checkbox,
    Button,
    Notifications: { error: vi.fn() },
    logTabStore: { createPodTab: vi.fn() },
    createTerminalTab: vi.fn(() => ({ id: "tab-1" })),
    terminalStore: { sendCommand: vi.fn(async () => {}) },
  },
  Navigation: { showDetails: vi.fn(), navigate: vi.fn() },
  Catalog: { getAllClusters: vi.fn(() => []) },
  Theme: { activeTheme: { get: () => theme } },
  K8sApi: {
    podsApi: { get: vi.fn() },
    LensExtensionKubeObject,
    KubeApi: class KubeApi {},
    KubeObjectStore: class KubeObjectStore {},
  },
};

export const Common = {
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
  Store: {
    ExtensionStore,
  },
};
