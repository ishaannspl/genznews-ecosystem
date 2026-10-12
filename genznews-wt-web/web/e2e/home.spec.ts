import { CATEGORIES_FOR_TESTS } from "./categories";
import { expect, test } from "./helpers";

// Fixtures server: DEMO data, used only for stable content.

test("home: one h1 and a lead story with exactly three lines", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("h1")).toHaveCount(1);
  const lines = page.locator("section[aria-labelledby=today] ul.three-line > li");
  await expect(lines).toHaveCount(3);
  for (const line of await lines.all()) await expect(line).not.toBeEmpty();
});

test("home: each of the five category lanes has rows", async ({ page }) => {
  await page.goto("/");
  for (const slug of CATEGORIES_FOR_TESTS) {
    const lane = page.locator(`section[data-category="${slug}"]`);
    await expect(lane, slug).toHaveCount(1);
    expect(await lane.locator("article.story-row").count(), slug).toBeGreaterThan(0);
  }
});

test("home: clicking a row opens the article page with one h1", async ({ page }) => {
  await page.goto("/");
  const row = page.locator('section[data-category] article.story-row').first();
  const title = (await row.locator("h3").innerText()).trim();
  await row.click();
  await expect(page).toHaveURL(/\/article\/[a-z0-9-]+$/);
  await expect(page.locator("h1")).toHaveCount(1);
  await expect(page.locator("h1")).toHaveText(title);
});

test("home: reduced motion shows all three lead lines at once, with no animation", async ({ browser }) => {
  const context = await browser.newContext({ reducedMotion: "reduce" });
  const page = await context.newPage();
  await page.goto("/");
  const items = page.locator("section[aria-labelledby=today] ul.three-line > li");
  await expect(items).toHaveCount(3);
  for (const item of await items.all()) {
    const style = await item.evaluate((el) => {
      const s = getComputedStyle(el);
      const m = getComputedStyle(el.querySelector(".marker")!);
      return { name: s.animationName, opacity: s.opacity, markerName: m.animationName, markerOpacity: m.opacity };
    });
    expect(style.name).toBe("none");
    expect(style.markerName).toBe("none");
    expect(style.opacity).toBe("1");
    expect(style.markerOpacity).toBe("1");
    await expect(item).toBeVisible();
  }
  await context.close();
});

test("home: with motion allowed the lead lines do animate (so the reduced-motion check is meaningful)", async ({ page }) => {
  await page.goto("/");
  const names = await page
    .locator("section[aria-labelledby=today] ul.three-line > li")
    .evaluateAll((els) => els.map((el) => getComputedStyle(el).animationName + "|" + getComputedStyle(el.querySelector(".marker")!).animationName));
  expect(names.some((n) => n.replace(/none/g, "").replace("|", "") !== "")).toBe(true);
});

test("home: a story row underlines its headline on hover and on keyboard focus, not at rest", async ({ page }) => {
  await page.goto("/");
  const row = page.locator("section[data-category] article.story-row").first();
  const link = row.locator("a.stretched-link");
  const decoration = () => link.evaluate((el) => getComputedStyle(el).textDecorationLine);
  await page.mouse.move(0, 0);
  expect(await decoration()).toBe("none");
  // Hover the row's meta line, away from the headline text: the stretched link covers the
  // whole row, so the pointer is moved there directly instead of hovering the covered element.
  await row.scrollIntoViewIfNeeded();
  const box = (await row.locator("time").boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await expect.poll(decoration).toBe("underline");
  await page.mouse.move(0, 0);
  await expect.poll(decoration).toBe("none");
  // Keyboard focus (focus-visible) underlines it too.
  await link.focus();
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Tab");
  await expect(link).toBeFocused();
  await expect.poll(decoration).toBe("underline");
});
