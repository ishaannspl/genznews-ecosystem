import AxeBuilder from "@axe-core/playwright";
import { ARTICLE_SLUG, CATEGORY_SLUG, expect, forceTheme, test } from "./helpers";

// Fixtures server: DEMO data, used only for stable content.

const PAGES = [
  ["home", "/"],
  ["article", `/article/${ARTICLE_SLUG}`],
  ["category", `/category/${CATEGORY_SLUG}`],
  ["search", "/search?q=nhs"],
  ["about", "/about"],
  ["404", "/category/nope"],
] as const;

for (const theme of ["light", "dark"] as const) {
  for (const [name, path] of PAGES) {
    test(`axe: no serious or critical violations on ${name} (${theme})`, async ({ page }) => {
      await forceTheme(page, theme);
      await page.goto(path);
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      await page.waitForLoadState("networkidle");
      const results = await new AxeBuilder({ page }).analyze();
      const bad = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
      expect(
        bad.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.slice(0, 4).map((n) => n.target.join(" ") + " :: " + (n.any[0]?.message ?? "")) })),
      ).toEqual([]);
    });
  }
}

test("skip link is the first Tab stop, appears on focus and moves focus to #main", async ({ page }) => {
  await page.goto("/");
  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: "Skip to main content" });
  await expect(skip).toBeFocused();
  const box = await skip.boundingBox();
  expect(box && box.y >= 0 && box.y + box.height <= 400).toBe(true);
  await expect(skip).toBeInViewport({ ratio: 1 });
  await page.keyboard.press("Enter");
  await expect(page.locator("#main")).toBeFocused();
});

test("skip link is off screen until focused", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("link", { name: "Skip to main content" })).not.toBeInViewport();
});

for (const theme of ["light", "dark"] as const) {
  test(`keyboard: every focus stop on the home page has a visible focus indicator (${theme})`, async ({ page }) => {
    await forceTheme(page, theme);
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    const offenders: string[] = [];
    let stops = 0;
    for (let i = 0; i < 80; i++) {
      await page.keyboard.press("Tab");
      const info = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (!el || el === document.body) return null;
        const s = getComputedStyle(el);
        const has = (cs: CSSStyleDeclaration) =>
          (cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) > 0) || (cs.boxShadow !== "none" && cs.boxShadow !== "");
        // A stretched row link draws its focus ring on ::after, around the whole row.
        const outline = has(s) || has(getComputedStyle(el, "::after"));
        const label = el.tagName.toLowerCase() + (el.getAttribute("href") ? `[href="${el.getAttribute("href")}"]` : "");
        return { label, visible: outline, end: el.id === "__end" };
      });
      if (!info) break;
      stops++;
      if (!info.visible) offenders.push(info.label);
    }
    expect(stops).toBeGreaterThan(20);
    expect(offenders).toEqual([]);
  });
}
