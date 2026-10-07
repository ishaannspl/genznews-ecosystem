import { createClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createSupabaseRepository, type SupabaseLike } from "./supabaseRepository";

// Runs the repository through the REAL supabase-js client with a fake fetch (no network),
// so API drift in supabase-js or PostgREST URL conventions fails CI.

type Captured = { url: URL; decoded: string; headers: Headers };
let captured: Captured[] = [];
let responder: (c: Captured) => Response = () => json([], 200);

function json(body: unknown, status: number, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

const FORBIDDEN = ["generated_body_md", "flags", "reviewed_by", "confidence", "fact_risk", "job_id", "regen_framework"];

function repo(retryDelayMs?: number) {
  const client = createClient("https://example.supabase.co", "anon-key", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
        const c: Captured = { url, decoded: decodeURIComponent(url.search.replace(/\+/g, " ")), headers: new Headers(init?.headers) };
        captured.push(c);
        return responder(c);
      }) as typeof fetch,
    },
  });
  return createSupabaseRepository(client as unknown as SupabaseLike, { retryDelayMs });
}

const row = {
  id: "i1",
  slug: "s1",
  title: "T",
  summary: "S",
  category: "health_wellness",
  image_url: null,
  published_at: "2026-09-01T00:00:00Z",
  created_at: "2026-09-01T00:00:00Z",
  source_name: "x.com",
  source_domain: "x.com",
};

const cols = (c: Captured) => (c.url.searchParams.get("select") ?? "").split(",");

beforeEach(() => {
  captured = [];
  responder = () => json([], 200);
});
afterEach(() => vi.restoreAllMocks());

describe("repository through the real supabase-js client", () => {
  test("a 503 once then a valid 200 yields the data after exactly two fetch calls", async () => {
    let n = 0;
    responder = () => (++n === 1 ? json({ message: "Service Unavailable" }, 503) : json([row], 200, { "content-range": "0-0/1" }));
    const page = await repo(0).list({ page: 1, pageSize: 10 });
    expect(page.items.map((i) => i.slug)).toEqual(["s1"]);
    expect(captured).toHaveLength(2);
  });

  test("a persistent 503 stops after exactly two fetch calls", async () => {
    responder = () => json({ message: "Service Unavailable" }, 503);
    await expect(repo(0).list({ page: 1, pageSize: 10 })).rejects.toBeInstanceOf(Error);
    expect(captured).toHaveLength(2);
  });

  test("list: status filter, offset/limit, exact count, category, whitelisted columns", async () => {
    responder = () => json([row], 200, { "content-range": "0-0/1" });
    const page = await repo().list({ category: "health-wellness", page: 3, pageSize: 10 });
    expect(page).toMatchObject({ total: 1, page: 3, pageSize: 10 });
    expect(page.items[0].slug).toBe("s1");
    const c = captured[0];
    expect(c.url.pathname).toBe("/rest/v1/site_articles");
    expect(c.url.searchParams.get("status")).toBe("eq.PUBLISHED");
    expect(c.url.searchParams.get("category")).toBe("eq.health_wellness");
    expect(c.url.searchParams.get("offset")).toBe("20");
    expect(c.url.searchParams.get("limit")).toBe("10");
    expect(c.headers.get("prefer")).toContain("count=exact");
    expect(cols(c)).not.toContain("body_md");
    for (const f of FORBIDDEN) expect(cols(c)).not.toContain(f);
    expect(c.url.searchParams.get("select")).not.toContain("*");
  });

  test("search: websearch on search_tsv with english config and status filter", async () => {
    responder = () => json([row], 200, { "content-range": "0-0/1" });
    await repo().search("climate -war", { page: 1, pageSize: 5 });
    const c = captured[0];
    expect(c.decoded).toContain("search_tsv=wfts(english).climate -war");
    expect(c.url.searchParams.get("status")).toBe("eq.PUBLISHED");
    for (const f of FORBIDDEN) expect(cols(c)).not.toContain(f);
  });

  test("getBySlug: slug filter, status filter, null for missing row", async () => {
    const r = repo();
    const full = { ...row, body_md: "b", tags: [], source_url: "u", seo_title: null, seo_description: null, framework: null };
    responder = () => json([full], 200);
    expect((await r.getBySlug("s1"))?.slug).toBe("s1");
    const c = captured[0];
    expect(c.url.searchParams.get("slug")).toBe("eq.s1");
    expect(c.url.searchParams.get("status")).toBe("eq.PUBLISHED");
    for (const f of FORBIDDEN) expect(cols(c)).not.toContain(f);

    responder = () => json([], 200);
    expect(await r.getBySlug("missing")).toBeNull();
    responder = () =>
      json({ code: "PGRST116", details: "The result contains 0 rows", hint: null, message: "JSON object requested, multiple (or no) rows returned" }, 406);
    expect(await r.getBySlug("missing")).toBeNull();
  });

  test("allSlugs requests only slug, category, published_at, created_at", async () => {
    responder = () =>
      json(
        [
          { slug: "a", category: "health_wellness", published_at: "2026-09-01T00:00:00Z", created_at: "2026-09-01T00:00:00Z" },
          { slug: "b", category: "sports", published_at: "2026-09-01T00:00:00Z", created_at: "2026-09-01T00:00:00Z" },
        ],
        200,
      );
    expect(await repo().allSlugs()).toEqual([{ slug: "a", publishedAt: "2026-09-01T00:00:00Z" }]);
    expect(cols(captured[0])).toEqual(["slug", "category", "published_at", "created_at"]);
    expect(captured[0].url.searchParams.get("status")).toBe("eq.PUBLISHED");
  });

  test("related issues status-filtered queries", async () => {
    responder = () => json([row], 200);
    await repo().related({ id: "z", slug: "z", category: "health-wellness" } as never, 1);
    expect(captured).toHaveLength(1);
    expect(captured[0].url.searchParams.get("status")).toBe("eq.PUBLISHED");
    expect(captured[0].url.searchParams.get("category")).toBe("eq.health_wellness");
  });

  test("out-of-range page (416 PGRST103) gives an empty page with the real total", async () => {
    responder = (c) =>
      c.headers.get("prefer")?.includes("count=exact") && c.url.searchParams.get("offset")
        ? json({ code: "PGRST103", details: null, hint: null, message: "Requested range not satisfiable" }, 416, {
            "content-range": "*/3",
          })
        : new Response(null, { status: 200, headers: { "content-range": "*/3" } });
    const page = await repo().list({ page: 9999, pageSize: 10 });
    expect(page).toEqual({ items: [], total: 3, page: 9999, pageSize: 10 });
    expect(captured).toHaveLength(2);
    const count = captured[1];
    expect(count.url.searchParams.get("select")).toBe("id");
    expect(count.url.searchParams.get("status")).toBe("eq.PUBLISHED");
    expect(count.url.searchParams.get("offset")).toBeNull();
  });
});
