import { ARTICLE_SLUG, expect, FIXTURES, SITE, test } from "./helpers";

// Fixtures server: DEMO data, used only for stable content.

test.beforeEach(async ({ page }) => {
  await page.goto(`/article/${ARTICLE_SLUG}`);
});

test("article: three-line read, body and one h1", async ({ page }) => {
  await expect(page.locator("h1")).toHaveCount(1);
  await expect(page.locator("article ul.three-line > li")).toHaveCount(3);
  expect((await page.locator("article p").allInnerTexts()).join(" ").length).toBeGreaterThan(200);
});

test("article: source credit link opens safely", async ({ page }) => {
  const link = page.getByRole("link", { name: /opens in a new tab/ });
  await expect(link).toHaveCount(1);
  await expect(link).toHaveAttribute("target", "_blank");
  expect(await link.getAttribute("rel")).toContain("noopener");
  expect(await link.getAttribute("href")).toMatch(/^https?:\/\//);
});

test("article: related stories are listed and exclude the article itself", async ({ page }) => {
  const related = page.getByRole("region", { name: "Related stories" });
  await expect(related).toBeVisible();
  const links = related.locator("article a");
  expect(await links.count()).toBeGreaterThan(0);
  for (const href of await links.evaluateAll((els) => els.map((e) => e.getAttribute("href")))) {
    expect(href).not.toBe(`/article/${ARTICLE_SLUG}`);
  }
});

test("article: title has exactly one brand suffix, canonical and social images", async ({ page }) => {
  const title = await page.title();
  expect(title.split(" | GenZNews")).toHaveLength(2);
  expect(title.endsWith(" | GenZNews")).toBe(true);
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", `${SITE}/article/${ARTICLE_SLUG}`);
  for (const sel of ['meta[property="og:image"]', 'meta[name="twitter:image"]']) {
    expect(await page.locator(sel).getAttribute("content"), sel).toMatch(/^https?:\/\//);
  }
});

test("article: JSON-LD blocks parse and carry NewsArticle and BreadcrumbList", async ({ page }) => {
  const blocks = await page.locator('script[type="application/ld+json"]').evaluateAll((els) => els.map((e) => e.textContent ?? ""));
  const types = blocks.map((b) => JSON.parse(b)["@type"]);
  expect(types).toContain("NewsArticle");
  expect(types).toContain("BreadcrumbList");
  const news = JSON.parse(blocks[types.indexOf("NewsArticle")]);
  const fixture = FIXTURES.find((f) => f.slug === ARTICLE_SLUG)!;
  expect(news.headline).toBe(fixture.title);
});
