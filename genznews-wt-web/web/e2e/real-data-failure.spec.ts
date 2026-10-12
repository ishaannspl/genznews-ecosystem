import { readFileSync } from "node:fs";
import { expect, request, test } from "@playwright/test";
import fixtureArticles from "../src/lib/fixtures/articles.json";

/**
 * GUARD FOR "NEVER SHOW DEMO DATA".
 * This project runs against a `next dev` server with DATA_SOURCE=supabase pointing at a dead
 * host (127.0.0.1:59871 refuses connections). The site must show an honest error and must not
 * fall back to the 15 demo articles in src/lib/fixtures/articles.json under any route.
 *
 * Dev compiles each route on its first request, so every route is warmed once in beforeAll
 * and the timeouts below are generous but bounded.
 */

const DEMO_TITLES = (fixtureArticles as { title: string }[]).map((a) => a.title);
const ERROR_COPY = "We couldn't load stories. Refresh the page, or try again in a minute.";
const LOG = ".e2e-logs/real-server.log";
const LISTING_PATHS = ["/latest", "/category/health-wellness", "/search?q=a"];
const WARM_PATHS = ["/", ...LISTING_PATHS, "/article/anything", "/sitemap.xml"];
const COMPILE_TIMEOUT = 180_000;

test.describe.configure({ timeout: 240_000 });

test.beforeAll(async ({ baseURL }) => {
  test.setTimeout(WARM_PATHS.length * COMPILE_TIMEOUT);
  const api = await request.newContext({ baseURL });
  // Status does not matter here (the home page is a 500): this only triggers the first compile.
  for (const path of WARM_PATHS) await api.get(path, { timeout: COMPILE_TIMEOUT });
  await api.dispose();
});

function escapedForHtml(title: string): string[] {
  // React escapes quotes and apostrophes in text, so check both raw and escaped spellings.
  const esc = title.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#x27;");
  // The RSC payload is JSON inside a script, so a quote may also appear backslash-escaped.
  return [title, esc, JSON.stringify(title).slice(1, -1)];
}

function assertNoDemo(text: string, where: string) {
  for (const title of DEMO_TITLES) for (const form of escapedForHtml(title)) expect(text, `${where} leaks demo title "${title}"`).not.toContain(form);
}

for (const path of LISTING_PATHS) {
  test(`${path}: 200 with the error state and no demo article`, async ({ page }) => {
    const res = await page.goto(path, { timeout: COMPILE_TIMEOUT });
    expect(res?.status()).toBe(200);
    const alert = page.getByRole("alert").filter({ hasText: ERROR_COPY });
    await expect(alert).toBeVisible();
    const html = await (await page.request.get(path, { timeout: COMPILE_TIMEOUT })).text();
    // Listing pages render per request and keep their inline error state in the server HTML.
    expect(html).toContain("We couldn&#x27;t load stories.");
    assertNoDemo(html, path);
    assertNoDemo(await page.content(), `${path} (rendered)`);
  });
}

test("/: never a demo article (HTML, RSC payload, DOM) and the error UI shows after JS runs", async ({ page }) => {
  // The home page rethrows repository errors so ISR never caches an error home page; with
  // nothing generated yet, app/error.tsx renders the error UI on the client.
  const html = await (await page.request.get("/", { timeout: COMPILE_TIMEOUT })).text();
  assertNoDemo(html, "/ (HTML)");
  const rsc = await page.request.get("/", { headers: { RSC: "1" }, timeout: COMPILE_TIMEOUT });
  assertNoDemo(await rsc.text(), "/ (RSC payload)");

  await page.goto("/", { timeout: COMPILE_TIMEOUT });
  const alert = page.getByRole("alert").filter({ hasText: ERROR_COPY });
  await expect(alert).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
  assertNoDemo(await page.content(), "/ (rendered)");
});

test("/article/anything is 500 or 404 and never contains a demo title", async ({ baseURL }) => {
  const api = await request.newContext({ baseURL });
  for (const slug of ["anything", "india-ai-semiconductors-quantum-frontier-2026"]) {
    const res = await api.get(`/article/${slug}`, { timeout: COMPILE_TIMEOUT });
    expect([404, 500]).toContain(res.status());
    assertNoDemo(await res.text(), `/article/${slug}`);
  }
  await api.dispose();
});

test("the sitemap lists no demo articles", async ({ baseURL }) => {
  const api = await request.newContext({ baseURL });
  const xml = await (await api.get("/sitemap.xml", { timeout: COMPILE_TIMEOUT })).text();
  expect(xml).not.toContain("/article/");
  await api.dispose();
});

test("the server log explains the failure and leaks no secrets", async ({ page }) => {
  await page.goto("/", { timeout: COMPILE_TIMEOUT });
  await page.goto("/latest", { timeout: COMPILE_TIMEOUT });
  // The log is written by the server process; give the line a moment to flush.
  await expect
    .poll(() => readFileSync(LOG, "utf8").split("\n").filter((l) => l.startsWith("[genznews]") && l.includes("fallback=none")).length)
    .toBeGreaterThan(0);
  const log = readFileSync(LOG, "utf8");
  const lines = log.split("\n").filter((l) => l.startsWith("[genznews]"));
  const failure = lines.filter((l) => l.includes("fallback=none"));
  expect(failure.some((l) => l.includes("source=supabase"))).toBe(true);
  // The failure line names the reason in plain words, not just "fetch failed".
  expect(lines.some((l) => l.includes("failed") && l.includes("Connection refused"))).toBe(true);
  expect(lines.some((l) => l.includes("fetch failed") && !l.includes("Connection refused"))).toBe(false);
  for (const secret of ["sb_publishable", "FAKEKEY123", "eyJ", "Bearer"]) expect(log, secret).not.toContain(secret);
});
