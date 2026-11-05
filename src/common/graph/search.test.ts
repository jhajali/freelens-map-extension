import { describe, expect, it } from "vitest";
import { matchNodes } from "./search";

describe("matchNodes", () => {
  it("matches displayed names case-insensitively", () => {
    const names: Record<string, string> = { a: "Mongo-DB", b: "redis", c: "mongodb" };
    expect([...matchNodes("MONGO", ["a", "b", "c"], (id) => names[id])]).toEqual(["a", "c"]);
    expect(matchNodes("", ["a"], (id) => names[id]).size).toBe(0);
  });
});
