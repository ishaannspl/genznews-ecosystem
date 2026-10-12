// @vitest-environment node
import { describe, expect, test } from "vitest";
import { cleanText, dollarQuote, dollarTagCandidate, sqlTextArray, sqlTimestamptz, sqlNullableText } from "./sqlLiteral";

/** Reads a dollar-quoted literal back the way Postgres does: the first closing tag after the opening one ends it. */
function unquote(literal: string): string {
  const m = /^(\$[A-Za-z_][A-Za-z0-9_]*\$)/.exec(literal);
  if (!m) throw new Error(`not dollar quoted: ${literal.slice(0, 20)}`);
  const tag = m[1];
  const close = literal.indexOf(tag, tag.length);
  if (close !== literal.length - tag.length) throw new Error("closing tag is not at the end (string would terminate early)");
  return literal.slice(tag.length, close);
}

describe("dollarQuote", () => {
  const nasty: [string, string][] = [
    ["single quotes", "it's 'quoted' ''twice''"],
    ["double quotes", 'he said "no"'],
    ["backslashes", "C:\\path\\n\\t \\' \\\\"],
    ["$$", "price $$ and $$$ and $"],
    ["trailing dollar", "ends with $"],
    ["newlines", "line 1\nline 2\n\n\nline 5\n"],
    ["unicode and emoji", "नमस्ते 🙂👩🏽‍💻 café ✓ \u2014 \u2013"],
    ["psql meta-command lookalike", "\\q\n\\! rm -rf /\n\\i /etc/passwd"],
    ["sql injection lookalike", "'); drop table public.site_articles; --"],
  ];
  test.each(nasty)("%s round-trips", (_n, value) => {
    expect(unquote(dollarQuote(value))).toBe(value);
  });

  test("never uses E'' escapes or plain single-quoted strings", () => {
    for (const [, v] of nasty) {
      const q = dollarQuote(v);
      expect(q.startsWith("$gz")).toBe(true);
      expect(q.startsWith("E'")).toBe(false);
    }
  });

  test("a value containing the first candidate tags gets a tag that does not occur", () => {
    const t0 = dollarTagCandidate(0);
    const t1 = dollarTagCandidate(1);
    const value = `a ${t0} b ${t1} c`;
    const q = dollarQuote(value);
    expect(q.startsWith(dollarTagCandidate(2))).toBe(true);
    expect(unquote(q)).toBe(value);
  });

  test("a value ending in a prefix of the tag cannot terminate the literal early", () => {
    const t0 = dollarTagCandidate(0); // like $gzabc$
    const value = `x${t0.slice(0, -1)}`; // x$gzabc   + closing $gzabc$ would contain $gzabc$ one char early
    const q = dollarQuote(value);
    expect(q.startsWith(t0)).toBe(false);
    expect(unquote(q)).toBe(value);
  });

  test("$gz lookalikes inside content are harmless", () => {
    const value = "$gz$ $gz0$ $gzdeadbeef$ $gz$$gz";
    expect(unquote(dollarQuote(value))).toBe(value);
  });

  test("tags are valid identifiers and deterministic", () => {
    for (let i = 0; i < 20; i++) expect(dollarTagCandidate(i)).toMatch(/^\$gz[0-9a-f]{12}\$$/);
    expect(dollarQuote("same")).toBe(dollarQuote("same"));
  });

  test("very long text round-trips", () => {
    const value = "Long text with 'quotes' and $ signs. ".repeat(20_000);
    expect(unquote(dollarQuote(value))).toBe(value);
  });

  test("NUL and control characters are removed, tabs and newlines kept", () => {
    const value = "a\u0000b\u0001c\u0008d\u000Be\u000Cf\u001Fg\u007Fh\ti\nj\rk";
    expect(unquote(dollarQuote(value))).toBe("abcdefgh\ti\nj\rk");
    expect(cleanText("x\u0000y")).toBe("xy");
  });

  test("lone surrogates become the replacement character", () => {
    expect(cleanText("a\uD800b")).toBe("a\uFFFDb");
  });
});

describe("other literals", () => {
  test("nullable text", () => {
    expect(sqlNullableText(null)).toBe("null");
    expect(sqlNullableText(undefined)).toBe("null");
    expect(unquote(sqlNullableText("x'y"))).toBe("x'y");
  });

  test("text arrays dollar-quote every element", () => {
    expect(sqlTextArray([])).toBe("'{}'::text[]");
    const arr = sqlTextArray(["a'b", 'c"d', "e,f}{"]);
    expect(arr.startsWith("array[")).toBe(true);
    expect(arr.endsWith("]::text[]")).toBe(true);
    const inner = arr.slice("array[".length, -"]::text[]".length);
    const parts = inner.split(", ");
    expect(parts.map(unquote)).toEqual(["a'b", 'c"d', "e,f}{"]);
  });

  test("timestamps are validated and normalised to UTC ISO", () => {
    expect(sqlTimestamptz("2026-09-26T10:11:12.123456+05:30")).toBe("'2026-09-26T04:41:12.123Z'::timestamptz");
    expect(() => sqlTimestamptz("not a date")).toThrow(/invalid timestamp/);
    expect(() => sqlTimestamptz("")).toThrow(/invalid timestamp/);
  });
});
