import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

const css = readFileSync(join(__dirname, "globals.css"), "utf8");

/** Declarations of every rule whose selector list contains `selector` exactly. */
function declarationsFor(selector: string): string {
  const out: string[] = [];
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = m[1]
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split(",")
      .map((s) => s.trim());
    if (selectors.includes(selector)) out.push(m[2]);
  }
  return out.join("\n");
}

describe("long tokens wrap instead of forcing horizontal scroll", () => {
  test.each([".wrap-anywhere", ".article-body", ".article-body a", ".article-body code", ".three-line", ".marker"])(
    "%s sets overflow-wrap: anywhere",
    (selector) => {
      expect(declarationsFor(selector)).toMatch(/overflow-wrap:\s*anywhere/);
    },
  );

  test.each([".wrap-anywhere", ".article-body", ".three-line"])("%s can shrink inside flex and grid (min-width: 0)", (selector) => {
    expect(declarationsFor(selector)).toMatch(/min-width:\s*0/);
  });
});
