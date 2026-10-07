import crypto from "node:crypto";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath }));

const route = await import("./route");

const SECRET = "s3cret-value";

function req(body: unknown, secret?: string, raw = false): Request {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (secret !== undefined) headers["x-revalidate-secret"] = secret;
  return new Request("http://localhost/api/revalidate", {
    method: "POST",
    headers,
    body: raw ? (body as string) : JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.stubEnv("REVALIDATE_SECRET", SECRET);
  revalidatePath.mockReset();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("/api/revalidate", () => {
  test("test_get_is_405", () => {
    // Next answers 405 for any HTTP method the module does not export.
    const m = route as Record<string, unknown>;
    expect(typeof m.POST).toBe("function");
    for (const method of ["GET", "PUT", "PATCH", "DELETE"]) expect(m[method]).toBeUndefined();
  });

  test("test_missing_or_wrong_secret_is_401", async () => {
    const missing = await route.POST(req({ slug: "a-b" }));
    const wrong = await route.POST(req({ slug: "a-b" }, "nope"));
    expect(missing.status).toBe(401);
    expect(wrong.status).toBe(401);
    expect(await missing.text()).toBe('{"error":"unauthorized"}');
    expect(await wrong.text()).toBe('{"error":"unauthorized"}');
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  test("test_unconfigured_secret_rejects_everything", async () => {
    for (const value of [undefined, ""]) {
      if (value === undefined) delete process.env.REVALIDATE_SECRET;
      else vi.stubEnv("REVALIDATE_SECRET", value);
      for (const s of ["", "anything", undefined]) {
        const res = await route.POST(req({ slug: "a-b" }, s));
        expect(res.status).toBe(401);
        expect(await res.text()).toBe('{"error":"unauthorized"}');
      }
    }
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  test("test_correct_secret_revalidates_paths_and_returns_200", async () => {
    const res = await route.POST(req({ paths: ["/", "/latest", "/about", "/sitemap.xml", "/category/health-wellness"] }, SECRET));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.revalidated).toEqual(["/", "/latest", "/about", "/sitemap.xml", "/category/health-wellness"]);
    expect(revalidatePath).toHaveBeenCalledTimes(5);
    expect(revalidatePath).toHaveBeenCalledWith("/category/health-wellness");
  });

  test("slug shorthand revalidates the article, home and latest", async () => {
    const res = await route.POST(req({ slug: "my-story-2026" }, SECRET));
    expect(res.status).toBe(200);
    expect((await res.json()).revalidated).toEqual(["/article/my-story-2026", "/", "/latest"]);
  });

  test("test_secret_compare_is_constant_time", async () => {
    const spy = vi.spyOn(crypto, "timingSafeEqual");
    await route.POST(req({ slug: "a-b" }, "short"));
    await route.POST(req({ slug: "a-b" }, "a-much-longer-wrong-secret-than-the-real-one"));
    expect(spy).toHaveBeenCalledTimes(2);
    for (const [a, b] of spy.mock.calls) {
      expect((a as Buffer).length).toBe(32);
      expect((b as Buffer).length).toBe(32);
    }
  });

  test("path allow-list rejects traversal, absolute urls, admin and unknown categories", async () => {
    const bad = [
      "../etc",
      "/../",
      "https://evil.example/",
      "//evil.example",
      "/admin",
      "/api/revalidate",
      "/category/nope",
      "/category/health-wellness/x",
      `/article/${"a".repeat(201)}`,
      "/article/Has-Upper",
      "/article/a--b",
      "/article/",
      "/article/a/b",
      "/latest?x=1",
    ];
    for (const p of bad) {
      const res = await route.POST(req({ paths: [p] }, SECRET));
      expect(res.status, p).toBe(400);
      expect(await res.text()).toBe('{"error":"bad request"}');
    }
    expect((await route.POST(req({ slug: "a".repeat(201) }, SECRET))).status).toBe(400);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  test("more than 20 paths, invalid json, empty and wrong types are 400", async () => {
    const many = Array.from({ length: 21 }, (_, i) => `/article/s-${i}`);
    expect((await route.POST(req({ paths: many }, SECRET))).status).toBe(400);
    expect((await route.POST(req("{not json", SECRET, true))).status).toBe(400);
    expect((await route.POST(req({}, SECRET))).status).toBe(400);
    expect((await route.POST(req({ paths: "/" }, SECRET))).status).toBe(400);
    expect((await route.POST(req({ slug: 5 }, SECRET))).status).toBe(400);
    expect((await route.POST(req(null, SECRET))).status).toBe(400);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  test("responses never echo the secret or raw input", async () => {
    const res = await route.POST(req({ paths: ["/evil-input-marker"] }, SECRET));
    const text = await res.text();
    expect(text).not.toContain("evil-input-marker");
    expect(text).not.toContain(SECRET);
  });
});
