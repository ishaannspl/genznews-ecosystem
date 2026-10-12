import { expect, FIXTURES, SITE, test } from "./helpers";

// Fixtures server: DEMO data, used only for stable content.
// Static routes in the sitemap: /, /latest, /about, plus the five categories.
const STATIC_ROUTES = 3 + 5;

test("robots.txt points at the sitemap", async ({ request }) => {
  const res = await request.get("/robots.txt");
  expect(res.status()).toBe(200);
  const text = await res.text();
  expect(text).toContain("User-Agent: *");
  expect(text).toContain(`Sitemap: ${SITE}/sitemap.xml`);
});

test("sitemap.xml lists every route and every article", async ({ request }) => {
  const res = await request.get("/sitemap.xml");
  expect(res.status()).toBe(200);
  const xml = await res.text();
  const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  expect(locs).toHaveLength(STATIC_ROUTES + FIXTURES.length);
  expect(new Set(locs).size).toBe(locs.length);
  for (const f of FIXTURES) expect(locs).toContain(`${SITE}/article/${f.slug}`);
  expect(locs.every((l) => l.startsWith(SITE))).toBe(true);
});

const HEADERS = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
  "x-frame-options": "DENY",
  "permissions-policy": "camera=(), microphone=(), geolocation=()",
  "content-security-policy-report-only":
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' https: data:; " +
    "font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; " +
    "frame-ancestors 'none'",
};

for (const path of ["/", "/category/nope"]) {
  test(`security headers on ${path}`, async ({ request }) => {
    const res = await request.get(path);
    for (const [k, v] of Object.entries(HEADERS)) expect(res.headers()[k], k).toBe(v);
    expect(res.headers()["x-powered-by"]).toBeUndefined();
    expect(res.headers()["content-security-policy"]).toBeUndefined();
  });
}

// The report-only policy must not flag anything the site really loads, and must not make the
// browser log any CSP message at all.
for (const path of ["/", "/latest", "/article/nhs-instant-suspension-medical-record-snoopers"]) {
  test(`report-only CSP logs no console message on ${path}`, async ({ page }) => {
    const reports: string[] = [];
    page.on("console", (m) => {
      const text = m.text();
      if (/Content Security Policy|Content-Security-Policy/i.test(text)) reports.push(text);
    });
    await page.goto(path, { waitUntil: "networkidle" });
    expect(reports).toEqual([]);
  });
}

test.describe("/api/revalidate", () => {
  const slug = "india-ai-semiconductors-quantum-frontier-2026";

  test("GET is 405", async ({ request }) => {
    expect((await request.get("/api/revalidate")).status()).toBe(405);
  });

  test("a missing or wrong secret is 401 with the same body", async ({ request }) => {
    const none = await request.post("/api/revalidate", { data: { slug } });
    const wrong = await request.post("/api/revalidate", { data: { slug }, headers: { "x-revalidate-secret": "nope" } });
    expect(none.status()).toBe(401);
    expect(wrong.status()).toBe(401);
    expect(await wrong.text()).toBe(await none.text());
  });

  test("the correct secret revalidates", async ({ request }) => {
    const res = await request.post("/api/revalidate", { data: { slug }, headers: { "x-revalidate-secret": "e2e-secret" } });
    expect(res.status()).toBe(200);
    expect((await res.json()).revalidated).toContain(`/article/${slug}`);
  });
});
