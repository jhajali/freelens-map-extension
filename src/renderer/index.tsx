/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { Renderer } from "@freelensapp/extensions";
import { withMenuItemErrorBoundary, withPageErrorBoundary } from "./components/error-boundary";
import { MapIcon } from "./icons";
import { MapIpcRenderer } from "./ipc";
import { MapPage, type PageParams } from "./map/service-map-page";
import { PAGE_ID, ShowOnMapMenuItem } from "./menus/show-on-map";

// Every page and menu item renders inside an error boundary: the host has none around a menu item, and its boundary
// around the cluster frame would replace the whole cluster view.
export default class ServiceMapRenderer extends Renderer.LensExtension {
  async onActivate() {
    MapIpcRenderer.createInstance(this);
  }

  clusterPages: Renderer.LensExtension["clusterPages"] = [
    {
      id: PAGE_ID,
      params: { namespace: "", select: "" },
      components: {
        Page: ({ params }: { params: PageParams }) => <MapPage extension={this} params={params} />,
      },
    },
  ].map((registration) => withPageErrorBoundary(this, registration));

  clusterPageMenus = [
    {
      id: PAGE_ID,
      title: "Service map",
      target: { pageId: PAGE_ID },
      components: { Icon: MapIcon },
    },
  ];

  kubeObjectMenuItems: Renderer.LensExtension["kubeObjectMenuItems"] = [
    { kind: "Namespace", apiVersions: ["v1"] },
    { kind: "Deployment", apiVersions: ["apps/v1"] },
    { kind: "StatefulSet", apiVersions: ["apps/v1"] },
    { kind: "DaemonSet", apiVersions: ["apps/v1"] },
  ]
    .map(({ kind, apiVersions }) => ({
      kind,
      apiVersions,
      components: {
        MenuItem: (props: {
          object?: { kind?: string; metadata?: { name?: string; namespace?: string } };
          toolbar?: boolean;
        }) => <ShowOnMapMenuItem {...props} extension={this} />,
      },
    }))
    .map((registration) => withMenuItemErrorBoundary(this, registration as never));
}
