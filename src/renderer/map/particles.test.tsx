// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { isFocused } from "./edges";
import { allot, Particles, particlesFor } from "./particles";

describe("particles", () => {
  it("particlesFor follows the prototype", () => {
    expect(particlesFor(0, false)).toEqual({ count: 0, durSec: 5 });
    expect(particlesFor(1, false)).toEqual({ count: 3, durSec: 2.5 });
    expect(particlesFor(10, false).count).toBe(4);
    expect(particlesFor(100, false).durSec).toBe(0.9);
  });

  it("reduced motion draws no particles", () => {
    expect(particlesFor(5, true).count).toBe(0);
    expect([...allot([{ id: "a", rate: 5 }], true).values()]).toEqual([0]);
    const { container } = render(
      <svg>
        <Particles path="M0,0 L9,9" color="red" count={0} dur={1} />
      </svg>,
    );
    expect(container.querySelectorAll("circle")).toHaveLength(0);
  });

  it("the budget caps particles at 300", () => {
    const links = Array.from({ length: 200 }, (_, i) => ({ id: `l${i}`, rate: 10 - i / 100 }));
    const a = allot(links, false);
    expect([...a.values()].reduce((x, y) => x + y, 0)).toBe(300);
    expect(a.get("l0")).toBe(4);
    expect(a.get("l199")).toBe(0);
  });

  it("draws one animated circle per particle", () => {
    const { container } = render(
      <svg>
        <Particles path="M0,0 L9,9" color="red" count={3} dur={2} />
      </svg>,
    );
    expect(container.querySelectorAll("circle animateMotion")).toHaveLength(3);
  });

  it("rates in one tier keep the same dur and begin", () => {
    const attrs = (rate: number) => {
      const { durSec } = particlesFor(rate, false);
      const { container } = render(
        <svg>
          <Particles path="M0,0" color="red" count={3} dur={durSec} />
        </svg>,
      );
      return [...container.querySelectorAll("animateMotion")].map((a) => [
        a.getAttribute("dur"),
        a.getAttribute("begin"),
      ]);
    };
    expect(attrs(1.02)).toEqual(attrs(1.1));
    expect(particlesFor(1.02, false).durSec).toBe(particlesFor(1.1, false).durSec);
  });

  it("circles never take pointer events", () => {
    const { container } = render(
      <svg>
        <Particles path="M0,0" color="red" count={1} dur={1} />
      </svg>,
    );
    expect(container.querySelector("circle")?.style.pointerEvents).toBe("none");
  });

  it("selection focuses its own links only", () => {
    const e = { id: "l", source: "a", target: "b" };
    expect(isFocused(e, undefined)).toBe(true);
    expect(isFocused(e, "a")).toBe(true);
    expect(isFocused(e, "b")).toBe(true);
    expect(isFocused(e, "l")).toBe(true);
    expect(isFocused(e, "c")).toBe(false);
  });
});
