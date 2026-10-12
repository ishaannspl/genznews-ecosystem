import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { CATEGORY_COLORS, COLORS, contrastRatio } from "./tokens";

const MIN = 4.5;

describe("tokens", () => {
  test("contrastRatio matches known WCAG values", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrastRatio("#ffffff", "#ffffff")).toBeCloseTo(1, 5);
  });

  test("test_ink_on_paper_meets_4_5_in_both_themes", () => {
    for (const t of ["light", "dark"] as const) {
      expect(contrastRatio(COLORS[t].ink, COLORS[t].paper)).toBeGreaterThanOrEqual(MIN);
    }
  });

  test("test_ink_soft_on_paper_meets_4_5", () => {
    for (const t of ["light", "dark"] as const) {
      expect(contrastRatio(COLORS[t].inkSoft, COLORS[t].paper)).toBeGreaterThanOrEqual(MIN);
    }
  });

  test("test_every_category_text_color_meets_4_5_on_its_theme_paper", () => {
    for (const [slug, c] of Object.entries(CATEGORY_COLORS)) {
      expect(contrastRatio(c.textLight, COLORS.light.paper), `${slug} light`).toBeGreaterThanOrEqual(MIN);
      expect(contrastRatio(c.textDark, COLORS.dark.paper), `${slug} dark`).toBeGreaterThanOrEqual(MIN);
    }
  });

  test("test_ink_on_marker_meets_4_5", () => {
    // Marker text is always the light-theme ink, in both themes.
    expect(contrastRatio(COLORS.light.ink, COLORS.light.marker)).toBeGreaterThanOrEqual(MIN);
    expect(contrastRatio(COLORS.light.ink, COLORS.dark.marker)).toBeGreaterThanOrEqual(MIN);
  });

  test("test_every_token_hex_appears_in_globals_css", () => {
    const css = readFileSync(join(__dirname, "../app/globals.css"), "utf8").toLowerCase();
    const hexes = new Set<string>();
    for (const t of Object.values(COLORS)) Object.values(t).forEach((h) => hexes.add(h));
    for (const c of Object.values(CATEGORY_COLORS)) Object.values(c).forEach((h) => hexes.add(h));
    for (const h of hexes) expect(css, h).toContain(h.toLowerCase());
  });
});
