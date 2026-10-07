import { describe, expect, test } from "vitest";
import { MAX_QUERY_LENGTH, PAGE_SIZE, parsePage, parseQuery } from "./params";

describe("parsePage", () => {
  test("test_valid_page_numbers", () => {
    expect(parsePage("1")).toBe(1);
    expect(parsePage("2")).toBe(2);
    expect(parsePage("37")).toBe(37);
    expect(parsePage(" 4 ")).toBe(4);
    expect(parsePage("10000")).toBe(10000);
  });

  test("test_zero_negative_nan_array_and_huge_values_become_1_or_clamped", () => {
    for (const v of [undefined, "", " ", "0", "-1", "-20", "abc", "2abc", "1.5", "1e3", "0x10", "NaN", "Infinity"]) {
      expect(parsePage(v), JSON.stringify(v)).toBe(1);
    }
    // Repeated params: take the first value only.
    expect(parsePage(["3", "7"])).toBe(3);
    expect(parsePage(["abc", "7"])).toBe(1);
    expect(parsePage([])).toBe(1);
    // Huge values clamp to the same cap normalizePaging uses.
    expect(parsePage("10001")).toBe(10000);
    expect(parsePage("99999999999999999999999")).toBe(10000);
  });

  test("page size is 12", () => {
    expect(PAGE_SIZE).toBe(12);
  });
});

describe("parseQuery", () => {
  test("takes the first value, trims and caps at 100 characters", () => {
    expect(parseQuery(undefined)).toBe("");
    expect(parseQuery("  nhs  ")).toBe("nhs");
    expect(parseQuery(["first", "second"])).toBe("first");
    expect(parseQuery([])).toBe("");
    expect(parseQuery("x".repeat(250))).toHaveLength(MAX_QUERY_LENGTH);
    expect(MAX_QUERY_LENGTH).toBe(100);
  });
});
