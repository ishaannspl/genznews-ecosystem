import { CATEGORY_SLUG, expect, FIXTURES, test } from "./helpers";

// Fixtures server: DEMO data, used only for stable content.

test("category: lists only that category's stories", async ({ page }) => {
  await page.goto(`/category/${CATEGORY_SLUG}`);
  await expect(page.locator("h1")).toHaveText("Health and wellness");
  const rows = page.locator("article.story-row");
  const n = await rows.count();
  expect(n).toBe(FIXTURES.filter((f) => f.category === CATEGORY_SLUG).length);
  for (const cat of await rows.evaluateAll((els) => els.map((e) => e.getAttribute("data-category")))) {
    expect(cat).toBe(CATEGORY_SLUG);
  }
});

test("category: unknown slug is a real 404 with the full not-found copy", async ({ page }) => {
  const res = await page.goto("/category/nope");
  expect(res?.status()).toBe(404);
  await expect(page.getByRole("heading", { level: 1, name: "We can't find that page" })).toBeVisible();
  await expect(page.getByText("The link may be old or mistyped. Head to the home page, or catch up on the latest stories.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Go to the home page" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Read the latest stories" })).toBeVisible();
});

test("search: NHS finds the NHS story", async ({ page }) => {
  await page.goto("/search?q=NHS");
  await expect(page.getByRole("status").filter({ hasText: "for “NHS”" })).toBeVisible();
  await expect(page.getByRole("link", { name: /NHS Slaps Instant Suspensions/ })).toBeVisible();
});

test("search: the form submits a query", async ({ page }) => {
  await page.goto("/search");
  await page.getByRole("searchbox").fill("NHS");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/search\?q=NHS/);
  await expect(page.getByRole("link", { name: /NHS Slaps Instant Suspensions/ })).toBeVisible();
});

test("search: no match shows the empty-state copy", async ({ page }) => {
  await page.goto("/search?q=zzzzqq");
  await expect(page.getByText("No stories match “zzzzqq”. Try fewer or different words.")).toBeVisible();
});

test("search: a hostile query renders as text and never executes", async ({ page }) => {
  const hostile = "<script>alert(1)</script>";
  let dialog = false;
  page.on("dialog", async (d) => {
    dialog = true;
    await d.dismiss();
  });
  const res = await page.goto(`/search?q=${encodeURIComponent(hostile)}`);
  const html = await res!.text();
  expect(html).not.toContain(hostile);
  expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  await expect(page.getByText(`No stories match “${hostile}”`)).toBeVisible();
  await page.waitForLoadState("networkidle");
  expect(dialog).toBe(false);
});

test("latest: a page past the end shows the empty state with a way back", async ({ page }) => {
  const res = await page.goto("/latest?page=9999");
  expect(res?.status()).toBe(200);
  await expect(page.getByRole("status")).toBeVisible();
  await expect(page.getByRole("link", { name: "Newer stories" }).first()).toBeVisible();
});

test("article: an unknown slug returns 404 and shows the not-found heading once JS runs", async ({ page }) => {
  // Next 16.3.8 sends an empty error shell for this case until JS runs, so only the status is asserted on the raw response.
  const res = await page.goto("/article/does-not-exist");
  expect(res?.status()).toBe(404);
  await expect(page.getByRole("heading", { level: 1, name: "We can't find that page" })).toBeVisible();
});
