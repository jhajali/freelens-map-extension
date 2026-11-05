// PNG/SVG export of the map viewport.
import { getNodesBounds, getViewportForBounds, type Node } from "@xyflow/react";
import { toPng, toSvg } from "html-to-image";

const MAX = 8000;

/** The map as an image of every node, at natural size where it fits, on the theme's main background. */
export async function exportMap(
  el: HTMLElement,
  kind: "png" | "svg",
  colors: Record<string, string>,
  nodes: Node[],
): Promise<Blob> {
  // React Flow's recipe: a frame around all nodes, not the current pan and zoom
  const b = getNodesBounds(nodes);
  const width = Math.min(Math.round(b.width * 1.1), MAX),
    height = Math.min(Math.round(b.height * 1.1), MAX);
  const v = getViewportForBounds(b, width, height, 0.1, 2, 0.1);
  const opts = {
    backgroundColor: colors.mainBackground,
    cacheBust: true,
    width,
    height,
    style: { width: `${width}px`, height: `${height}px`, transform: `translate(${v.x}px, ${v.y}px) scale(${v.zoom})` },
  };
  // data URLs decoded here: a fetch of one may be refused by the host's content security policy
  if (kind === "png") {
    const png = atob((await toPng(el, opts)).split(",")[1]!);
    return new Blob([Uint8Array.from(png, (c) => c.charCodeAt(0))], { type: "image/png" });
  }
  const url = await toSvg(el, opts);
  return new Blob([scrub(decodeURIComponent(url.slice(url.indexOf(",") + 1)))], { type: "image/svg+xml" });
}

/** Drops the attributes that carry node and link ids or names, which hold the real names, from serialized markup. */
export const scrub = (markup: string) =>
  markup.replace(/\s(?:data-[\w-]+|aria-label|title|id)="([^"]*)"/g, (all) => (/^\sid="arrow-/.test(all) ? all : ""));

const pad = (n: number) => String(n).padStart(2, "0");

/** `service-map-<cluster>-<YYYYMMDD-HHMM>.<ext>`, in local time. */
export const exportName = (cluster: string, at: Date, ext: string) =>
  `service-map-${cluster.replace(/[^\w.-]+/g, "_")}-${at.getFullYear()}${pad(at.getMonth() + 1)}${pad(at.getDate())}-${pad(at.getHours())}${pad(at.getMinutes())}.${ext}`;

/** Saves the blob as a file through a download link. */
export function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  // after the click has started the download
  setTimeout(() => URL.revokeObjectURL(url));
}
