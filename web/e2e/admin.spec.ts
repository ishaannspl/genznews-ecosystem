import { expect, test } from "./helpers";

// Fixtures server (DATA_SOURCE=fixtures): no admin client can be created, so the proxy and the
// login action fail closed. These tests cover what needs no database.

const UUID = "123e4567-e89b-12d3-a456-426614174000";

for (const path of ["/admin", `/admin/${UUID}`]) {
  test(`signed-out ${path} redirects to /admin/login`, async ({ request }) => {
    const res = await request.get(path, { maxRedirects: 0 });
    expect(res.status()).toBeGreaterThanOrEqual(300);
    expect(res.status()).toBeLessThan(400);
    expect(new URL(res.headers()["location"], "http://localhost").pathname).toBe("/admin/login");
  });
}

test("signed-out visit to /admin lands on the sign-in page", async ({ page }) => {
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/admin\/login$/);
  await expect(page.getByRole("heading", { name: "Admin sign in" })).toBeVisible();
});

test("login shows one generic error and never echoes the password", async ({ page }) => {
  const password = "correct-horse-battery-staple-9137";
  await page.goto("/admin/login");
  await page.getByLabel("Email").fill("someone@example.com");
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();

  const alert = page.getByRole("alert").filter({ hasText: "Email or password is incorrect." });
  await expect(alert).toHaveCount(1);
  await expect(alert).toBeVisible();
  await expect(page).toHaveURL(/\/admin\/login/);
  expect(await page.content()).not.toContain(password);
  expect(await page.getByLabel("Password").inputValue()).not.toBe(password);
});

test("/admin/login is noindex", async ({ page, request }) => {
  const res = await request.get("/admin/login");
  expect(res.status()).toBe(200);
  expect(await res.text()).toMatch(/<meta name="robots" content="noindex/);
  await page.goto("/admin/login");
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
});

test("a redirected /admin request ends on a noindex page", async ({ request }) => {
  const res = await request.get("/admin"); // follows the redirect
  expect(new URL(res.url()).pathname).toBe("/admin/login");
  const robotsHeader = res.headers()["x-robots-tag"] ?? "";
  const html = await res.text();
  expect(robotsHeader.includes("noindex") || /<meta name="robots" content="noindex/.test(html)).toBe(true);
});

test("robots.txt disallows /admin/", async ({ request }) => {
  const res = await request.get("/robots.txt");
  expect(res.status()).toBe(200);
  expect(await res.text()).toMatch(/Disallow: \/admin\//);
});
