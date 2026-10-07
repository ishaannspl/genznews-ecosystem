import { describe, expect, test } from "vitest";
import { removeEmDashes, removeEmDashesPerLine } from "./removeEmDashes";

// Expected values were produced by running a verbatim copy of remove_em_dashes from
// app/ai_writer.py under python3 on these exact inputs.
const PYTHON: [string, string][] = [
  ["India's Betting Big on AI and Quantum Tech\u2014Are You Ready?", "India's Betting Big on AI and Quantum Tech: Are You Ready?"],
  ["data\u2014keep", "data, keep"],
  ["word \u2014 word", "word - word"],
  ["word \u2014 Word", "word - Word"],
  ["2010\u20132020", "2010 - 2020"],
  ["pages 5\u20139 and A\u2013B", "pages 5 - 9 and A: B"],
  ["a -- b", "a - b"],
  ["a--b", "a--b"],
  ["", ""],
  ["line one\u2014Two\nline  two \u2014 three\n\nend", "line one: Two\nline two - three\n\nend"],
  ["  padded \u2014 text  ", "padded - text"],
  ["end\u2014", "end -"],
  ["\u2014start", "- start"],
  ["x \u2014y", "x - y"],
  ["नमस्ते\u2014Hello", "नमस्ते - Hello"],
  ["café\u2014ok", "café, ok"],
  ["a\u20141", "a - 1"],
  ["1\u2014a", "1, a"],
];

describe("removeEmDashes (port of app/ai_writer.py remove_em_dashes)", () => {
  test.each(PYTHON)("%j -> %j", (input, expected) => {
    expect(removeEmDashes(input)).toBe(expected);
  });

  test("idempotent", () => {
    for (const [input] of PYTHON) {
      const once = removeEmDashes(input);
      expect(removeEmDashes(once)).toBe(once);
      expect(once).not.toMatch(/[\u2013\u2014]/);
    }
  });

  test("newlines are kept; only runs of spaces collapse", () => {
    expect(removeEmDashes("a  b\n\n\nc")).toBe("a b\n\n\nc");
  });
});

describe("removeEmDashesPerLine (markdown bodies)", () => {
  test("cleans each line, keeps blank lines, indentation and lines without dashes byte for byte", () => {
    const body = "**TL;DR**\n\n- Tech\u2014Are you in\n- plain  spaced line\n\n  indented \u2014 line\n\n---\n\n*Sources: x.*\n";
    expect(removeEmDashesPerLine(body)).toBe(
      "**TL;DR**\n\n- Tech: Are you in\n- plain  spaced line\n\n  indented - line\n\n---\n\n*Sources: x.*\n",
    );
  });

  test("a dash never joins two lines", () => {
    expect(removeEmDashesPerLine("end of line \u2014\nNext line")).toBe("end of line -\nNext line");
  });

  test("idempotent and empty-safe", () => {
    expect(removeEmDashesPerLine("")).toBe("");
    const once = removeEmDashesPerLine("a\u2014b\n\nc \u2013 d\n");
    expect(removeEmDashesPerLine(once)).toBe(once);
  });
});
