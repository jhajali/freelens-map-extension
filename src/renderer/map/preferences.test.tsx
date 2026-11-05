// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ServiceMapStore } from "../../common/store/map-store";
import { DefaultPaletteInput, PaletteHint } from "./preferences";

describe("preferences entry", () => {
  it("stores the default palette", () => {
    const store = new ServiceMapStore();
    render(<DefaultPaletteInput />);
    fireEvent.click(screen.getByLabelText("Color-blind safe palette by default"));
    expect(store.defaultPalette).toBe("cb");
    expect(store.record("new").settings.palette).toBe("cb");
  });

  it("points to the map page", () => {
    render(<PaletteHint />);
    expect(screen.getByText(/Settings/)).toBeTruthy();
  });
});
