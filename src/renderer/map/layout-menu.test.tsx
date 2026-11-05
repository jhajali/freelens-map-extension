// @vitest-environment jsdom
import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_RECORD } from "../../common/store/map-store";
import { LayoutMenu } from "./layout-menu";

const prefs = DEFAULT_RECORD.layout;

const setup = (p = prefs, anonymize = false) => {
  const fns = { onChange: vi.fn(), onResetPositions: vi.fn(), onExport: vi.fn(), onAnonymize: vi.fn() };
  const r = render(<LayoutMenu prefs={p} anonymize={anonymize} {...fns} />);
  return { ...fns, ...r };
};

describe("LayoutMenu", () => {
  it("the spacing slider runs 0.6 to 2 in steps of 0.1 and reports the value", () => {
    const { onChange, getByLabelText } = setup();
    const slider = getByLabelText("Spacing") as HTMLInputElement;
    expect([slider.min, slider.max, slider.step]).toEqual(["0.6", "2", "0.1"]);
    fireEvent.change(slider, { target: { value: "1.4" } });
    expect(onChange).toHaveBeenCalledWith({ ...prefs, space: 1.4 });
  });

  it("explode toggles", () => {
    const { onChange, getByLabelText } = setup();
    fireEvent.click(getByLabelText("Explode release boxes"));
    expect(onChange).toHaveBeenCalledWith({ ...prefs, explode: true });
  });

  it("flip direction swaps RIGHT and LEFT", () => {
    const { onChange, getByText, rerender } = setup();
    fireEvent.click(getByText("Flip direction"));
    expect(onChange).toHaveBeenLastCalledWith({ ...prefs, dir: "LEFT" });
    rerender(
      <LayoutMenu
        prefs={{ ...prefs, dir: "LEFT" }}
        anonymize={false}
        onChange={onChange}
        onResetPositions={vi.fn()}
        onExport={vi.fn()}
        onAnonymize={vi.fn()}
      />,
    );
    fireEvent.click(getByText("Flip direction"));
    expect(onChange).toHaveBeenLastCalledWith({ ...prefs, dir: "RIGHT" });
  });

  it("link labels toggle", () => {
    const { onChange, getByLabelText } = setup();
    fireEvent.click(getByLabelText("Link labels"));
    expect(onChange).toHaveBeenCalledWith({ ...prefs, labels: !prefs.labels });
  });

  it("reset, export and anonymize call their callbacks", () => {
    const { onResetPositions, onExport, onAnonymize, getByText, getByLabelText } = setup();
    fireEvent.click(getByText("Reset positions"));
    fireEvent.click(getByText("Export PNG"));
    fireEvent.click(getByText("Export SVG"));
    fireEvent.click(getByLabelText("Anonymize names"));
    expect(onResetPositions).toHaveBeenCalledTimes(1);
    expect(onExport.mock.calls).toEqual([["png"], ["svg"]]);
    expect(onAnonymize).toHaveBeenCalledTimes(1);
  });
});
