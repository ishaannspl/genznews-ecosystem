import { describe, expect, test } from "vitest";
import { normalizePaging } from "./paging";

describe("normalizePaging", () => {
  test("passes valid values through", () => {
    expect(normalizePaging(3, 20)).toEqual({ page: 3, pageSize: 20 });
  });
  test("test_bad_page_becomes_1", () => {
    for (const p of [0, -4, Number.NaN, Infinity, -Infinity]) {
      expect(normalizePaging(p, 10).page).toBe(1);
    }
  });
  test("test_page_is_capped_at_10000", () => {
    expect(normalizePaging(10000, 10).page).toBe(10000);
    expect(normalizePaging(10001, 10).page).toBe(10000);
    expect(normalizePaging(1e21, 10).page).toBe(10000);
  });
  test("test_fractional_values_are_floored", () => {
    expect(normalizePaging(2.9, 10.7)).toEqual({ page: 2, pageSize: 10 });
    expect(normalizePaging(0.5, 0.5)).toEqual({ page: 1, pageSize: 1 });
  });
  test("test_page_size_below_1_becomes_1_and_is_capped_at_100", () => {
    expect(normalizePaging(1, 0).pageSize).toBe(1);
    expect(normalizePaging(1, -5).pageSize).toBe(1);
    expect(normalizePaging(1, Number.NaN).pageSize).toBe(1);
    expect(normalizePaging(1, 101).pageSize).toBe(100);
    expect(normalizePaging(1, 1e9).pageSize).toBe(100);
    expect(normalizePaging(1, Infinity).pageSize).toBe(100);
  });
});
