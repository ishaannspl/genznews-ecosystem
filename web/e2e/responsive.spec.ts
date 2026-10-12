import { expect, SIX_ROUTES, test } from "./helpers";

// Fixtures server: DEMO data, used only for stable content.

const WIDTHS = [375, 768, 1024, 1440];

for (const width of WIDTHS) {
  test.describe(`at ${width}px`, () => {
    test.use({ viewport: { width, height: 900 } });

    for (const route of SIX_ROUTES) {
      test(`no horizontal overflow on ${route}`, async ({ page }) => {
        await page.goto(route);
        await page.waitForLoadState("networkidle");
        const r = await page.evaluate(() => {
          const vw = window.innerWidth;
          const offenders: string[] = [];
          for (const el of document.querySelectorAll("body *")) {
            const b = el.getBoundingClientRect();
            if (b.width === 0 || b.height === 0) continue;
            // Skip content that is intentionally off screen (the skip link) or clipped by an ancestor.
            if (el.closest("a[href='#main']")) continue;
            if (b.right > vw + 0.5) {
              const cls = typeof el.className === "string" ? el.className.split(" ").slice(0, 2).join(".") : "";
              offenders.push(`${el.tagName.toLowerCase()}.${cls} right=${Math.round(b.right)}`);
            }
          }
          return { scrollWidth: document.documentElement.scrollWidth, vw, offenders: offenders.slice(0, 8) };
        });
        expect(r.scrollWidth).toBeLessThanOrEqual(r.vw);
        expect(r.offenders).toEqual([]);
      });
    }

    test("touch targets in header, footer and first 10 story rows are at least 44px tall", async ({ page }) => {
      await page.goto("/latest");
      await page.waitForLoadState("networkidle");
      // Open the mobile menu so its links are measured too.
      const summary = page.locator("header summary");
      if (await summary.isVisible()) await summary.click();
      const offenders = await page.evaluate(() => {
        const out: string[] = [];
        const rows = [...document.querySelectorAll("article.story-row")].slice(0, 10);
        const scopes: Element[] = [document.querySelector("header")!, document.querySelector("footer")!, ...rows];
        for (const scope of scopes) {
          for (const el of scope.querySelectorAll("a[href], button, summary, input, select, textarea")) {
            // A stretched link covers its whole row (::after, inset 0), so the row is its touch target.
            const target = el.classList.contains("stretched-link") ? el.closest("article") ?? el : el;
            const b = target.getBoundingClientRect();
            if (b.width === 0 || b.height === 0) continue;
            if (b.height < 43.5) {
              const where = scope.tagName.toLowerCase() + (scope.tagName === "ARTICLE" ? "" : "");
              out.push(`${where} > ${el.tagName.toLowerCase()}[${(el.getAttribute("href") ?? el.textContent ?? "").trim().slice(0, 40)}] h=${b.height.toFixed(1)}`);
            }
          }
        }
        return out;
      });
      expect(offenders).toEqual([]);
    });
  });
}

test("cover boxes reserve space: no layout shift once the page is idle", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const measure = () =>
    page.locator(".cover").evaluateAll((els) => els.map((e) => {
      const b = e.getBoundingClientRect();
      return [Math.round(b.width * 10) / 10, Math.round(b.height * 10) / 10];
    }));
  const before = await measure();
  await page.waitForLoadState("networkidle");
  const after = await measure();
  expect(before.length).toBeGreaterThan(0);
  expect(after).toEqual(before);
  for (const [w, h] of after) {
    expect(h).toBeGreaterThan(0);
    expect(Math.abs(w / h - 16 / 9)).toBeLessThan(0.05);
  }
});

test("cover box keeps its size when an image arrives (stubbed, no network)", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto("/");
  const cover = page.locator(".cover").first();
  const before = await cover.boundingBox();
  // Swap in a tall image through the same markup the real component renders.
  const after = await cover.evaluate(async (el) => {
    const img = document.createElement("img");
    img.className = "absolute inset-0 h-full w-full object-cover";
    img.src = "data:image/svg+xml;utf8," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="2400"><rect width="400" height="2400" fill="#888"/></svg>');
    el.appendChild(img);
    await img.decode();
    const b = el.getBoundingClientRect();
    return { width: b.width, height: b.height };
  });
  expect(after.width).toBeCloseTo(before!.width, 1);
  expect(after.height).toBeCloseTo(before!.height, 1);
});

test("a 200-character unbroken query does not overflow at 375px", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  const q = "x".repeat(200);
  await page.goto(`/search?q=${q}`);
  await page.waitForLoadState("networkidle");
  // The server clips the query to 100 characters (MAX_QUERY_LENGTH).
  await expect(page.getByText(`No stories match “${"x".repeat(100)}”`)).toBeVisible();
  const { scrollWidth, vw } = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, vw: window.innerWidth }));
  expect(scrollWidth).toBeLessThanOrEqual(vw);
});
