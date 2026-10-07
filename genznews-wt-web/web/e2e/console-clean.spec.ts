import { ARTICLE_SLUG, CATEGORY_SLUG, expect, test } from "./helpers";
import type { Page } from "@playwright/test";

// Fixtures server: DEMO data, used only for stable content.

const PAGES = [
  "/",
  `/article/${ARTICLE_SLUG}`,
  `/category/${CATEGORY_SLUG}`,
  "/search?q=nhs",
  "/about",
  "/category/nope",
  "/article/does-not-exist",
];

const DARK_PAPER = "rgb(14, 16, 48)";
const LIGHT_PAPER = "rgb(243, 245, 251)";

/** Collects everything the page logs at error or warning level, plus uncaught page errors. */
function watchConsole(page: Page) {
  const problems: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error" || m.type() === "warning") {
      problems.push(`console.${m.type()}: ${m.text()} @ ${m.location().url}`);
    }
  });
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
  return problems;
}

async function storeTheme(page: Page, theme: "light" | "dark") {
  // The app's own mechanism: the layout script reads localStorage "gz-theme".
  await page.goto("/about");
  await page.evaluate((t) => localStorage.setItem("gz-theme", t), theme);
}

for (const theme of ["light", "dark"] as const) {
  test(`no console errors or warnings on any page (${theme})`, async ({ page }) => {
    await storeTheme(page, theme);
    const problems = watchConsole(page);
    for (const path of PAGES) {
      await page.goto(path);
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      await page.waitForLoadState("networkidle");
    }
    // Client-side navigation between two pages (the 404 page is a client-rendered root layout too).
    await page.goto("/");
    await page.getByRole("link", { name: "About GenZNews" }).first().click();
    await expect(page).toHaveURL(/\/about$/);
    await page.goBack();
    await expect(page).toHaveURL(/\/$/);
    await page.waitForLoadState("networkidle");
    expect(problems).toEqual([]);
  });
}

test("the stored dark theme is applied by the inline script before hydration and before first paint", async ({ browser, baseURL }) => {
  // System preference is light, so only the stored choice can make the page dark.
  const context = await browser.newContext({
    baseURL,
    colorScheme: "light",
    storageState: { cookies: [], origins: [{ origin: new URL(baseURL as string).origin, localStorage: [{ name: "gz-theme", value: "dark" }] }] },
  });
  const page = await context.newPage();
  // No app JavaScript ever runs: only the inline script can set the theme.
  await page.route("**/_next/static/**/*.js", (route) => route.abort());
  await page.addInitScript(() => {
    document.addEventListener("DOMContentLoaded", () => {
      const w = window as unknown as { __early: { theme: string | undefined; bg: string } };
      w.__early = {
        theme: document.documentElement.dataset.theme,
        bg: getComputedStyle(document.body).backgroundColor,
      };
    });
  });
  await page.goto("/about");
  const early = await page.evaluate(() => (window as unknown as { __early: { theme: string; bg: string } }).__early);
  expect(early).toEqual({ theme: "dark", bg: DARK_PAPER });
  await context.close();
});

test("the stored light theme beats a dark system preference at DOMContentLoaded", async ({ browser, baseURL }) => {
  const context = await browser.newContext({
    baseURL,
    colorScheme: "dark",
    storageState: { cookies: [], origins: [{ origin: new URL(baseURL as string).origin, localStorage: [{ name: "gz-theme", value: "light" }] }] },
  });
  const page = await context.newPage();
  await page.route("**/_next/static/**/*.js", (route) => route.abort());
  await page.addInitScript(() => {
    document.addEventListener("DOMContentLoaded", () => {
      const w = window as unknown as { __early: { theme: string | undefined; bg: string } };
      w.__early = {
        theme: document.documentElement.dataset.theme,
        bg: getComputedStyle(document.body).backgroundColor,
      };
    });
  });
  await page.goto("/about");
  const early = await page.evaluate(() => (window as unknown as { __early: { theme: string; bg: string } }).__early);
  expect(early).toEqual({ theme: "light", bg: LIGHT_PAPER });
  await context.close();
});

test("an invalid stored theme is ignored", async ({ browser, baseURL }) => {
  const context = await browser.newContext({
    baseURL,
    colorScheme: "light",
    storageState: { cookies: [], origins: [{ origin: new URL(baseURL as string).origin, localStorage: [{ name: "gz-theme", value: "purple" }] }] },
  });
  const page = await context.newPage();
  await page.goto("/about");
  await expect(page.locator("html")).not.toHaveAttribute("data-theme", /.+/);
  await context.close();
});
