import { describe, expect, it } from "vitest";
import { shuffled } from "./shuffle";

describe("shuffled", () => {
  it("returns a permutation and leaves the input untouched", () => {
    const input = [1, 2, 3, 4, 5];
    const out = shuffled(input, () => 0.3);
    expect(out).not.toBe(input);
    expect([...out].sort()).toEqual(input);
    expect(input).toEqual([1, 2, 3, 4, 5]);
  });

  it("is deterministic for a fixed random source and reorders", () => {
    expect(shuffled([1, 2, 3, 4], () => 0)).toEqual([2, 3, 4, 1]);
  });

  it("handles empty and single-item lists", () => {
    expect(shuffled([])).toEqual([]);
    expect(shuffled(["a"])).toEqual(["a"]);
  });
});
