import { Renderer } from "@freelensapp/extensions";
import { describe, expect, it } from "vitest";
import { themeColors } from "./theme";

describe("themeColors", () => {
  it("returns the active Freelens theme colors", () => {
    expect(themeColors().mainBackground).toBe("#1e2124");
  });

  it("returns a copy", () => {
    const stub = Renderer.Theme.activeTheme.get().colors;
    expect(themeColors()).not.toBe(stub);
    themeColors().mainBackground = "changed";
    expect(themeColors().mainBackground).toBe("#1e2124");
  });
});
