// @vitest-environment jsdom
import { toPng, toSvg } from "html-to-image";
import { afterEach, describe, expect, it, vi } from "vitest";
import { download, exportMap, exportName, scrub } from "./export";

vi.mock("html-to-image", () => ({
  toPng: vi.fn(async () => `data:image/png;base64,${btoa("PNG")}`),
  toSvg: vi.fn(
    async (el: HTMLElement) =>
      `data:image/svg+xml;charset=utf-8,${encodeURIComponent(`<svg><foreignObject>${el.outerHTML}</foreignObject></svg>`)}`,
  ),
}));

afterEach(() => vi.clearAllMocks());

// two boxes, 400 x 250 together
const nodes = [
  { id: "a", position: { x: 0, y: 0 }, measured: { width: 100, height: 50 }, data: {} },
  { id: "b", position: { x: 300, y: 200 }, measured: { width: 100, height: 50 }, data: {} },
];

const el = () => {
  const d = document.createElement("div");
  d.innerHTML =
    '<div class="react-flow__node" data-id="shop/cart" data-testid="rf__node-shop/cart" aria-label="shop/cart">svc-1</div>' +
    '<svg><path id="shop/cart>shop/db" d="M0,0"/><marker id="arrow-crit"/></svg>';
  return d;
};

describe("exportMap", () => {
  it("renders PNG on the theme's main background", async () => {
    const blob = await exportMap(el(), "png", { mainBackground: "#123456" }, nodes);
    expect(toPng).toHaveBeenCalledWith(
      expect.any(HTMLElement),
      expect.objectContaining({ backgroundColor: "#123456" }),
    );
    expect(blob.type).toBe("image/png");
    expect(await blob.text()).toBe("PNG");
  });

  it("renders SVG without the ids, which carry real names", async () => {
    const blob = await exportMap(el(), "svg", { mainBackground: "#123456" }, nodes);
    expect(toSvg).toHaveBeenCalledWith(
      expect.any(HTMLElement),
      expect.objectContaining({ backgroundColor: "#123456" }),
    );
    expect(blob.type).toBe("image/svg+xml");
    const text = await blob.text();
    expect(text).toContain("svc-1");
    expect(text).toContain('id="arrow-crit"');
    expect(text).not.toContain("shop/");
  });
});

describe("exportMap's frame", () => {
  it("covers every node at its natural size, with a margin, whatever the pan and zoom", async () => {
    for (const kind of ["png", "svg"] as const) {
      await exportMap(el(), kind, { mainBackground: "#123456" }, nodes);
      const opts = vi.mocked(kind === "png" ? toPng : toSvg).mock.calls.at(-1)![1]!;
      expect(opts).toMatchObject({ width: 440, height: 275, style: { width: "440px", height: "275px" } });
      const [x, y, zoom] = /translate\((.+)px, (.+)px\) scale\((.+)\)/
        .exec(String(opts.style!.transform))!
        .slice(1)
        .map(Number);
      expect([x, y, zoom].map((n) => n!.toFixed(2))).toEqual(["20.00", "12.50", "1.00"]);
    }
  });
});

describe("scrub", () => {
  it("keeps the arrowhead ids the links refer to and drops every other id, data attribute and title", () => {
    expect(scrub('<a id="x" data-id="y" data-testid="z" aria-label="w" title="t"><b id="arrow-l-web"/></a>')).toBe(
      '<a><b id="arrow-l-web"/></a>',
    );
  });
});

describe("exportName", () => {
  it("names the cluster and the local time", () => {
    expect(exportName("cluster-1", new Date(2026, 10, 5, 9, 7), "png")).toBe("service-map-cluster-1-20261105-0907.png");
  });

  it("keeps the cluster name to file-name characters", () => {
    expect(exportName("arn:aws:eks/prod east", new Date(2026, 10, 5, 9, 7), "svg")).toBe(
      "service-map-arn_aws_eks_prod_east-20261105-0907.svg",
    );
  });
});

describe("download", () => {
  it("clicks a download link to an object URL, then revokes it", async () => {
    const create = vi.fn(() => "blob:x"),
      revoke = vi.fn();
    Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      expect(this.download).toBe("a.png");
      expect(this.href).toBe("blob:x");
    });
    download(new Blob(["x"]), "a.png");
    expect(click).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(revoke).toHaveBeenCalledWith("blob:x"));
  });
});
