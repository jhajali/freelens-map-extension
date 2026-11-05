/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

// Opens the map on the kind cluster with the test objects of
// `integration/fixtures/`. kind has no Cilium and no Prometheus, so the map
// runs on its Kubernetes-only level: the topology without live data, which
// is what a cluster without Hubble shows. Each view navigates from the
// sidebar itself, so that it does not depend on the state another left.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  applyFixtures,
  appReady,
  connectApp,
  deleteFixtures,
  disconnectKindCluster,
  expectNoErrorPage,
  installExtension,
  openDeploymentsRow,
  openKindCluster,
  openMapPage,
  openRowMenu,
  testWorkload,
  waitForMapNode,
  waitForMenuItem,
} from "./extension-helpers";

import type { Frame } from "playwright";

import type { AppSession } from "./extension-helpers";

const namespace = "integration-tests";

// The map lists the resources of CRDs a cluster may not have, and takes a 404 as
// "not served"; Chromium logs the response anyway. kind has none of them.
const optionalApis = [
  "/apis/gateway.networking.k8s.io/v1/httproutes",
  "/apis/gateway.networking.k8s.io/v1/gateways",
  "/apis/cilium.io/v2/ciliumnetworkpolicies",
  "/apis/cilium.io/v2/ciliumclusterwidenetworkpolicies",
  "/apis/apps.kubeblocks.io/v1/clusters",
  "/apis/workloads.kubeblocks.io/v1/instancesets",
  "/apis/apps.kubeblocks.io/v1alpha1/instancesets",
];
const notServed = (error: string) =>
  error.includes("status of 404") && optionalApis.some((api) => error.includes(`/api-kube${api}:`));

describe.skipIf(!(await appReady({ cluster: true })))("service map on kind", () => {
  let session: AppSession | undefined;
  let frame: Frame;

  beforeAll(async () => {
    session = await connectApp();
    await installExtension(session);
    await disconnectKindCluster(session);
    applyFixtures();
    frame = await openKindCluster(session);
  }, 600 * 1000);

  afterAll(async () => {
    const errors = (await session?.stopCollecting()) ?? [];

    try {
      if (session) {
        await disconnectKindCluster(session);
      }
    } finally {
      deleteFixtures();
      await session?.close();
    }

    expect(errors.filter((error) => !notServed(error))).toEqual([]);
  }, 300 * 1000);

  it("lists the namespace on the cluster view", async () => {
    await openMapPage(frame);
    await waitForMapNode(frame, `ns:${namespace}`);
    await expectNoErrorPage(frame);
  });

  it("opens the namespace view with both workloads", async () => {
    await openMapPage(frame);
    await (await waitForMapNode(frame, `ns:${namespace}`)).dblclick();
    await waitForMapNode(frame, `${namespace}/${testWorkload}`);
    await waitForMapNode(frame, `${namespace}/client`);
    await expect.poll(() => frame.locator('nav[aria-label="Breadcrumb"]').textContent()).toContain(namespace);
    await expectNoErrorPage(frame);
  });

  it("explains the missing Hubble Relay in the Data menu", async () => {
    await openMapPage(frame);

    const summary = frame.locator("summary", { hasText: "Data:" });
    const menu = frame.locator("details", { has: summary });

    await summary.click();

    // One row per source: its mark, its name, what was found
    await expect.poll(() => menu.textContent(), { timeout: 60 * 1000 }).toMatch(/✗ Hubble Relay [^✓✗]*not found/);
    await expect.poll(() => summary.textContent()).toContain("Kubernetes only");
    await expectNoErrorPage(frame);
  });

  it("shows a Deployment on the map from its menu", async () => {
    const menu = await openRowMenu(frame, await openDeploymentsRow(frame));

    await waitForMenuItem(menu, "Show on map");
    await menu.locator(".MenuItem .title").getByText("Show on map", { exact: true }).click();
    await waitForMapNode(frame, `${namespace}/${testWorkload}`);
    // The heading of the details panel, `.head` of the page's CSS module, which the map's cards use too
    await expect
      .poll(() => frame.getByTestId("panel").locator('[class*="_head_"]').first().textContent())
      .toContain(testWorkload);
    await expectNoErrorPage(frame);
  });
});
