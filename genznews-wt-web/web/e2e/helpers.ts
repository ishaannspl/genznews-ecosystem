import { test as base, expect, type Page } from "@playwright/test";
import fixtureArticles from "../src/lib/fixtures/articles.json";

/**
 * DEMO DATA NOTICE: the fixtures server (DATA_SOURCE=fixtures) serves 15 sample
 * articles. They exist only so the UI is tested against stable content.
 */
export const FIXTURES = fixtureArticles as {
  slug: string;
  title: string;
  category: string;
}[];

export const ARTICLE_SLUG = "nhs-instant-suspension-medical-record-snoopers";
export const CATEGORY_SLUG = "health-wellness";
export const SITE = "http://localhost:3110";

/** Tests never reach an external host: anything that is not the local server is aborted. */
export const test = base.extend<{ _noExternal: void }>({
  _noExternal: [
    async ({ page }, use) => {
      await page.route(
        (url) => !["localhost", "127.0.0.1"].includes(url.hostname) && url.protocol.startsWith("http"),
        (route) => route.abort(),
      );
      await use();
    },
    { auto: true },
  ],
});

export { expect };

export async function forceTheme(page: Page, theme: "light" | "dark") {
  // The app's own mechanism: the layout script reads localStorage "gz-theme" before first paint.
  await page.addInitScript((t) => {
    try {
      localStorage.setItem("gz-theme", t);
    } catch {}
  }, theme);
}

export const SIX_ROUTES = [
  "/",
  `/article/${ARTICLE_SLUG}`,
  `/category/${CATEGORY_SLUG}`,
  "/search?q=nhs",
  "/about",
  "/category/nope",
];
