import { Renderer } from "@freelensapp/extensions";

const {
  Component: { MenuItem, Icon },
} = Renderer;

export const PAGE_ID = "service-map";

/** Parameters of the map page: the namespace to open and the workload (`ns/name`) to select. */
export interface MapPageParams {
  namespace?: string;
  select?: string;
}

interface ObjectLike {
  kind?: string;
  metadata?: { name?: string; namespace?: string };
}

interface Navigator {
  navigate: (pageId?: string, params?: Record<string, unknown>) => void;
}

export function mapParamsFor(object: ObjectLike): MapPageParams {
  const name = object.metadata?.name ?? "";
  if (object.kind === "Namespace") return { namespace: name };
  const namespace = object.metadata?.namespace ?? "";
  return { namespace, select: `${namespace}/${name}` };
}

export function ShowOnMapMenuItem({
  object,
  toolbar,
  extension,
}: {
  object?: ObjectLike;
  toolbar?: boolean;
  extension: Navigator;
}) {
  if (!object) return <></>;
  return (
    <MenuItem onClick={() => extension.navigate(PAGE_ID, { ...mapParamsFor(object) })}>
      <Icon material="hub" interactive={toolbar} title="Show on map" />
      <span className="title">Show on map</span>
    </MenuItem>
  );
}
