import { describe, expect, test } from "vitest";
import { parseAssembledBody } from "./articleBody";

const standard =
  "**TL;DR**\n\n- one\n- two\n- three\n\nPara one.\n\nPara two.\n\n---\n\n*Sources: bbc.co.uk. Synthesized and curated by GenZNews.*\n";

describe("parseAssembledBody", () => {
  test("test_parses_standard_assembled_body", () => {
    const r = parseAssembledBody(standard);
    expect(r.tldr).toEqual(["one", "two", "three"]);
    expect(r.body).toBe("Para one.\n\nPara two.");
    expect(r.attribution).toBe("Sources: bbc.co.uk. Synthesized and curated by GenZNews.");
  });

  test("test_no_tldr_block_returns_empty_tldr_and_full_body", () => {
    const r = parseAssembledBody("Just text.\n\nMore text.");
    expect(r.tldr).toEqual([]);
    expect(r.body).toBe("Just text.\n\nMore text.");
    expect(r.attribution).toBeNull();
  });

  test("test_two_or_four_bullets_are_returned_as_found", () => {
    expect(parseAssembledBody("**TL;DR**\n\n- a\n- b\n\nBody").tldr).toEqual(["a", "b"]);
    expect(parseAssembledBody("**TL;DR**\n\n- a\n- b\n- c\n- d\n\nBody").tldr).toEqual(["a", "b", "c", "d"]);
  });

  test("test_crlf_line_endings", () => {
    const r = parseAssembledBody(standard.replace(/\n/g, "\r\n"));
    expect(r.tldr).toEqual(["one", "two", "three"]);
    expect(r.body).toBe("Para one.\n\nPara two.");
    expect(r.attribution).toBe("Sources: bbc.co.uk. Synthesized and curated by GenZNews.");
  });

  test("test_body_containing_horizontal_rule_in_the_middle_is_kept", () => {
    const text = "**TL;DR**\n\n- a\n- b\n- c\n\nTop.\n\n---\n\nBottom.\n\n---\n\n*Attr*\n";
    const r = parseAssembledBody(text);
    expect(r.body).toBe("Top.\n\n---\n\nBottom.");
    expect(r.attribution).toBe("Attr");
  });

  test("test_missing_attribution_is_null", () => {
    const r = parseAssembledBody("**TL;DR**\n\n- a\n- b\n- c\n\nBody only.\n");
    expect(r.attribution).toBeNull();
    expect(r.body).toBe("Body only.");
  });

  test("a trailing rule not followed by an italic line is part of the body", () => {
    const r = parseAssembledBody("Body.\n\n---\n\nPlain closing line.");
    expect(r.attribution).toBeNull();
    expect(r.body).toBe("Body.\n\n---\n\nPlain closing line.");
  });

  test("never throws on empty or odd input", () => {
    expect(parseAssembledBody("")).toEqual({ tldr: [], body: "", attribution: null });
    expect(() => parseAssembledBody("**TL;DR**")).not.toThrow();
    expect(() => parseAssembledBody("---\n\n*")).not.toThrow();
  });
});
