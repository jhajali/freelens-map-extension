// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CappedTable, Spark } from "./parts";

describe("parts", () => {
  it("CappedTable shows 200 rows then a show-all button", () => {
    const rows = Array.from({ length: 250 }, (_, i) => (
      <tr key={i}>
        <td>{i}</td>
      </tr>
    ));
    const { container } = render(
      <CappedTable
        head={
          <tr>
            <th>n</th>
          </tr>
        }
        rows={rows}
      />,
    );
    expect(container.querySelectorAll("tbody tr")).toHaveLength(200);
    fireEvent.click(screen.getByRole("button", { name: "Show all 250" }));
    expect(container.querySelectorAll("tbody tr")).toHaveLength(250);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("Spark says collecting under 2 points", () => {
    const { container, rerender } = render(<Spark values={[1]} />);
    expect(container.textContent).toBe("collecting…");
    rerender(<Spark values={[1, 2, 3]} />);
    expect(container.querySelector("polyline")).not.toBeNull();
  });
});
