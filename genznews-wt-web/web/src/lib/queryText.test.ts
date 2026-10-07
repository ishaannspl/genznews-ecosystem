import { describe, expect, test } from "vitest";
import { cleanQuery, MAX_QUERY } from "./queryText";

describe("cleanQuery", () => {
  test("test_collapses_whitespace_and_control_characters", () => {
    expect(cleanQuery("  a\u0000b\n\tc   d\u0085 ")).toBe("a b c d");
  });

  test("test_cuts_to_the_limit_and_trims_after_the_cut", () => {
    expect(cleanQuery("x".repeat(150))).toHaveLength(MAX_QUERY);
    expect(cleanQuery("abc def", 4)).toBe("abc");
    expect(cleanQuery("", 10)).toBe("");
  });
});
