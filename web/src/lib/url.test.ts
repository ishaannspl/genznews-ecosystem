import { describe, expect, test } from "vitest";
import { isHttpUrl, MAX_URL_LENGTH, safeHttpUrl } from "./url";

const HOSTILE: [string, unknown][] = [
  ["null", null],
  ["undefined", undefined],
  ["a number", 42],
  ["an object", { href: "https://example.com/a.jpg" }],
  ["empty", ""],
  ["whitespace only", "   "],
  ["leading space", " https://example.com/a.jpg"],
  ["trailing newline", "https://example.com/a.jpg\n"],
  ["embedded tab", "https://exa\tmple.com/a.jpg"],
  ["embedded NUL", "https://example.com/\u0000a.jpg"],
  ["embedded space", "https://example.com/a b.jpg"],
  ["relative path", "/api/revalidate"],
  ["relative file", "images/a.jpg"],
  ["protocol-relative", "//evil.example/a.jpg"],
  ["javascript:", "javascript:alert(1)"],
  ["JavaScript: mixed case", "JaVaScRiPt:alert(1)"],
  ["data:", "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4="],
  ["vbscript:", "vbscript:msgbox(1)"],
  ["mailto:", "mailto:a@example.com"],
  ["ftp:", "ftp://example.com/a.jpg"],
  ["file:", "file:///etc/passwd"],
  ["scheme only", "https:"],
  ["no host", "https://"],
  ["too long", `https://example.com/${"a".repeat(MAX_URL_LENGTH)}`],
];

describe("isHttpUrl", () => {
  test.each(HOSTILE)("test_rejects_%s", (_name, value) => {
    expect(isHttpUrl(value)).toBe(false);
    expect(safeHttpUrl(value)).toBeNull();
  });

  test.each([
    "https://example.com/a.jpg",
    "http://example.com/a.jpg?x=1&y=2",
    "HTTPS://EXAMPLE.COM/A.JPG",
    "https://cdn.example.com/path/with%20space.jpg",
  ])("test_accepts_%s", (value) => {
    expect(isHttpUrl(value)).toBe(true);
    expect(safeHttpUrl(value)).toBe(value);
  });

  test("test_accepts_a_url_at_the_length_limit", () => {
    const base = "https://example.com/";
    const atLimit = base + "a".repeat(MAX_URL_LENGTH - base.length);
    expect(atLimit).toHaveLength(MAX_URL_LENGTH);
    expect(isHttpUrl(atLimit)).toBe(true);
  });
});
