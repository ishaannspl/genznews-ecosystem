import { afterEach, describe, expect, test, vi } from "vitest";
import {
  articleToRow,
  checkConnection,
  createSupabaseRepository,
  rowToArticle,
  type SiteArticleRow,
  type SupabaseLike,
} from "./supabaseRepository";
import { RepositoryError } from "../repository";
import { setLogSink } from "../dataLog";
import type { Article } from "../types";

type Result = { data: unknown; error: { message: string; code?: string; status?: number } | null; count?: number | null; status?: number };
type Call = { method: string; args: unknown[] };
type Query = { table: string; calls: Call[] };

/** Chainable, awaitable fake. Each `from()` starts a new recorded query. */
function fakeClient(results: Result[] | Result = { data: [], error: null, count: 0 }) {
  const queries: Query[] = [];
  let i = 0;
  const next = (): Result => (Array.isArray(results) ? (results[i++] ?? { data: [], error: null, count: 0 }) : results);
  const client = {
    from(table: string) {
      const q: Query = { table, calls: [] };
      queries.push(q);
      const chain: Record<string, unknown> = {};
      for (const m of ["select", "eq", "neq", "order", "range", "textSearch", "limit", "retry"]) {
        chain[m] = (...args: unknown[]) => {
          q.calls.push({ method: m, args });
          return chain;
        };
      }
      chain.maybeSingle = (...args: unknown[]) => {
        q.calls.push({ method: "maybeSingle", args });
        return Promise.resolve(next());
      };
      chain.then = (res: (v: Result) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(next()).then(res, rej);
      return chain;
    },
  };
  return { client: client as unknown as SupabaseLike, queries };
}

const calls = (q: Query, m: string) => q.calls.filter((c) => c.method === m);

function row(over: Partial<SiteArticleRow> = {}): SiteArticleRow {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    slug: "my-story",
    title: "My story",
    summary: "A summary",
    body_md: "**TL;DR**\n\n- a\n- b\n- c\n\nBody\n\n---\n\n*Attr*\n",
    category: "health_wellness",
    tags: ["x"],
    source_name: "thehindu.com",
    source_domain: "thehindu.com",
    source_url: "https://thehindu.com/a",
    image_url: null,
    published_at: "2026-09-02T00:00:00+00:00",
    created_at: "2026-09-01T00:00:00+00:00",
    seo_title: null,
    seo_description: null,
    framework: "explainer",
    ...over,
  };
}

describe("rowToArticle", () => {
  test("test_row_maps_niche_key_to_category_slug", () => {
    const a = rowToArticle(row());
    expect(a).toMatchObject({
      id: "11111111-1111-1111-1111-111111111111",
      slug: "my-story",
      category: "health-wellness",
      bodyMd: expect.stringContaining("**TL;DR**"),
      sourceName: "thehindu.com",
      sourceUrl: "https://thehindu.com/a",
      publishedAt: "2026-09-02T00:00:00+00:00",
      framework: "explainer",
    });
  });

  test("test_published_at_falls_back_to_created_at", () => {
    expect(rowToArticle(row({ published_at: null }))?.publishedAt).toBe("2026-09-01T00:00:00+00:00");
  });

  test("returns null for unknown category, missing slug or title", () => {
    expect(rowToArticle(row({ category: "sports" }))).toBeNull();
    expect(rowToArticle(row({ category: null }))).toBeNull();
    expect(rowToArticle(row({ slug: null }))).toBeNull();
    expect(rowToArticle(row({ title: "" }))).toBeNull();
  });

  test("tolerates null optional columns", () => {
    const a = rowToArticle(row({ summary: null, body_md: null, tags: null, source_name: null, source_url: null }));
    expect(a).toMatchObject({ summary: "", bodyMd: "", tags: [], sourceName: "thehindu.com", sourceUrl: "" });
  });
});

describe("articleToRow", () => {
  test("test_article_to_row_maps_back_to_db_shape", () => {
    const article: Article = {
      id: "x",
      slug: "s",
      title: "T",
      summary: "S",
      bodyMd: "B",
      category: "education-career",
      tags: ["a", "b"],
      sourceName: "thehindu.com",
      sourceUrl: "https://www.thehindu.com/a/?utm_source=x",
      imageUrl: null,
      publishedAt: "2026-09-02T00:00:00.000Z",
      seoTitle: null,
      seoDescription: "d",
      framework: "explainer",
    };
    const r = articleToRow(article);
    expect(r).toMatchObject({
      slug: "s",
      title: "T",
      summary: "S",
      body_md: "B",
      category: "education_career",
      tags: ["a", "b"],
      source_name: "thehindu.com",
      source_domain: "www.thehindu.com",
      source_url: "https://www.thehindu.com/a/?utm_source=x",
      published_at: "2026-09-02T00:00:00.000Z",
      status: "PUBLISHED",
      ai_disclosure: false,
      seo_description: "d",
      framework: "explainer",
    });
    expect(typeof r.url_hash).toBe("string");
    expect((r.url_hash as string).length).toBe(64);
    expect("byline" in r).toBe(false);
    expect("id" in r).toBe(false);
  });
});

describe("supabase repository", () => {
  test("test_every_query_filters_status_published", async () => {
    const { client, queries } = fakeClient({ data: [row()], error: null, count: 1 });
    const repo = createSupabaseRepository(client);
    const art = rowToArticle(row())!;
    await repo.getBySlug("my-story");
    await repo.list({ page: 1, pageSize: 5 });
    await repo.list({ category: "health-wellness", page: 1, pageSize: 5 });
    await repo.search("hello", { page: 1, pageSize: 5 });
    await repo.related(art, 3);
    await repo.allSlugs();
    expect(queries.length).toBeGreaterThanOrEqual(6);
    for (const q of queries) {
      expect(q.table).toBe("site_articles");
      expect(calls(q, "eq")).toContainEqual({ method: "eq", args: ["status", "PUBLISHED"] });
    }
  });

  test("never selects internal columns", async () => {
    const { client, queries } = fakeClient({ data: [], error: null, count: 0 });
    const repo = createSupabaseRepository(client);
    await repo.getBySlug("a");
    await repo.list({ page: 1, pageSize: 5 });
    await repo.search("x", { page: 1, pageSize: 5 });
    await repo.allSlugs();
    for (const q of queries) {
      const cols = String(calls(q, "select")[0].args[0]);
      for (const bad of ["generated_body_md", "flags", "reviewed_by", "confidence", "fact_risk", "job_id", "regen_framework", "*"]) {
        expect(cols.split(",").map((s) => s.trim())).not.toContain(bad);
      }
    }
  });

  test("test_row_with_unknown_category_is_skipped_not_thrown", async () => {
    const { client } = fakeClient({
      data: [row({ slug: "a" }), row({ slug: "b", category: "sports" }), row({ slug: "c" })],
      error: null,
      count: 3,
    });
    const page = await createSupabaseRepository(client).list({ page: 1, pageSize: 10 });
    expect(page.items.map((i) => i.slug)).toEqual(["a", "c"]);
    // total comes from the server count, so it can exceed items.length when rows are skipped.
    expect(page.total).toBe(3);
  });

  test("test_pagination_uses_range_and_returns_total_count", async () => {
    const { client, queries } = fakeClient({ data: [row()], error: null, count: 42 });
    const page = await createSupabaseRepository(client).list({ page: 3, pageSize: 10 });
    expect(calls(queries[0], "range")[0].args).toEqual([20, 29]);
    expect(calls(queries[0], "select")[0].args[1]).toEqual({ count: "exact" });
    expect(page).toMatchObject({ total: 42, page: 3, pageSize: 10 });
    expect("body_md" in page.items[0]).toBe(false);
    expect("bodyMd" in page.items[0]).toBe(false);
  });

  test("list sanitizes paging and filters category by niche key", async () => {
    const { client, queries } = fakeClient({ data: [], error: null, count: 0 });
    const page = await createSupabaseRepository(client).list({
      category: "education-career",
      page: Number.NaN,
      pageSize: 5000,
    });
    expect(calls(queries[0], "range")[0].args).toEqual([0, 99]);
    expect(calls(queries[0], "eq")).toContainEqual({ method: "eq", args: ["category", "education_career"] });
    expect(page).toMatchObject({ page: 1, pageSize: 100 });
  });

  test("test_out_of_range_page_returns_empty_page_with_real_total", async () => {
    const range416 = { data: null, error: { message: "Requested range not satisfiable", code: "PGRST103" } };
    const head: Result = { data: null, error: null, count: 3 };
    const { client, queries } = fakeClient([range416, head, range416, head]);
    const repo = createSupabaseRepository(client);
    expect(await repo.list({ page: 9999, pageSize: 10 })).toEqual({ items: [], total: 3, page: 9999, pageSize: 10 });
    expect(calls(queries[1], "select")[0].args).toEqual(["id", { count: "exact", head: true }]);
    expect(calls(queries[1], "eq")).toContainEqual({ method: "eq", args: ["status", "PUBLISHED"] });
    expect((await repo.search("hi", { page: 50, pageSize: 10 })).total).toBe(3);
    expect(calls(queries[3], "textSearch")).toHaveLength(1);
  });

  test("count query failure and other error codes still throw the generic error", async () => {
    const range416 = { data: null, error: { message: "x", status: 416 } };
    const bad = fakeClient([range416, { data: null, error: { message: "boom secret" } }]);
    await expect(createSupabaseRepository(bad.client).list({ page: 9, pageSize: 10 })).rejects.toThrow("Could not load stories.");
    const other = fakeClient({ data: null, error: { message: "nope", code: "42501" } });
    await expect(createSupabaseRepository(other.client).list({ page: 1, pageSize: 10 })).rejects.toBeInstanceOf(RepositoryError);
    expect(other.queries).toHaveLength(1);
  });

  test("test_get_by_slug_returns_null_when_no_row", async () => {
    const { client, queries } = fakeClient({ data: null, error: null });
    expect(await createSupabaseRepository(client).getBySlug("nope")).toBeNull();
    expect(calls(queries[0], "eq")).toContainEqual({ method: "eq", args: ["slug", "nope"] });
    expect(calls(queries[0], "maybeSingle")).toHaveLength(1);
  });

  test("get_by_slug maps a row, null for unknown category", async () => {
    expect((await createSupabaseRepository(fakeClient({ data: row(), error: null }).client).getBySlug("my-story"))?.slug).toBe(
      "my-story",
    );
    expect(
      await createSupabaseRepository(fakeClient({ data: row({ category: "zzz" }), error: null }).client).getBySlug("my-story"),
    ).toBeNull();
  });

  test("test_search_blank_returns_empty_page_without_calling_client", async () => {
    const { client, queries } = fakeClient();
    const repo = createSupabaseRepository(client);
    for (const q of ["", "   ", "\n\t", "\u0000\u0007"]) {
      const p = await repo.search(q, { page: 2, pageSize: 10 });
      expect(p).toEqual({ items: [], total: 0, page: 2, pageSize: 10 });
    }
    expect(queries).toHaveLength(0);
  });

  test("test_search_truncates_query_to_100_chars_and_strips_control_characters", async () => {
    const { client, queries } = fakeClient({ data: [], error: null, count: 0 });
    await createSupabaseRepository(client).search("  hello\u0000\n\tworld  " + "x".repeat(300), { page: 1, pageSize: 10 });
    const q = calls(queries[0], "textSearch")[0].args[1] as string;
    expect(q.length).toBeLessThanOrEqual(100);
    expect(q.startsWith("hello world xxx")).toBe(true);
    expect(/[\u0000-\u001f\u007f-\u009f]/.test(q)).toBe(false);
  });

  test("test_search_uses_text_search_on_search_tsv_websearch", async () => {
    const { client, queries } = fakeClient({ data: [row()], error: null, count: 1 });
    const hostile = `a'b),status.eq.DRAFT,"x" or -y`;
    const page = await createSupabaseRepository(client).search(hostile, { page: 1, pageSize: 10 });
    expect(calls(queries[0], "textSearch")[0].args).toEqual([
      "search_tsv",
      hostile,
      { type: "websearch", config: "english" },
    ]);
    expect(page.items).toHaveLength(1);
    // Hostile text is never interpolated into a filter string: no or()/filter calls exist on the fake.
    expect(queries[0].calls.map((c) => c.method)).not.toContain("or");
  });

  test("test_client_error_throws_RepositoryError_without_leaking_message", async () => {
    const secret = 'relation "site_articles" secret detail at 10.0.0.5';
    const bad: Result = { data: null, error: { message: secret } };
    const repo = createSupabaseRepository(fakeClient(bad).client);
    const art = rowToArticle(row())!;
    const ops: (() => Promise<unknown>)[] = [
      () => repo.getBySlug("a"),
      () => repo.list({ page: 1, pageSize: 5 }),
      () => repo.search("a", { page: 1, pageSize: 5 }),
      () => repo.related(art, 3),
      () => repo.allSlugs(),
    ];
    for (const op of ops) {
      const err = await op().then(
        () => null,
        (e: unknown) => e,
      );
      expect(err).toBeInstanceOf(RepositoryError);
      expect((err as RepositoryError).message).toBe("Could not load stories.");
      expect((err as RepositoryError).message).not.toContain("secret");
      expect((err as RepositoryError).cause).toMatchObject({ message: secret });
    }
  });

  test("thrown (rejected) client errors are wrapped too", async () => {
    const client = {
      from() {
        throw new Error("network down secret");
      },
    } as unknown as SupabaseLike;
    const err = await createSupabaseRepository(client)
      .allSlugs()
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RepositoryError);
    expect((err as Error).message).toBe("Could not load stories.");
  });

  test("test_related_queries_same_category_excluding_self", async () => {
    const same = [row({ id: "2", slug: "s2" }), row({ id: "3", slug: "s3" })];
    const { client, queries } = fakeClient({ data: same, error: null });
    const art = rowToArticle(row())!;
    const out = await createSupabaseRepository(client).related(art, 2);
    expect(out.map((o) => o.slug)).toEqual(["s2", "s3"]);
    expect(queries).toHaveLength(1);
    const q = queries[0];
    expect(calls(q, "eq")).toContainEqual({ method: "eq", args: ["category", "health_wellness"] });
    expect(calls(q, "neq")).toContainEqual({ method: "neq", args: ["id", art.id] });
    expect(calls(q, "neq")).toContainEqual({ method: "neq", args: ["slug", art.slug] });
    expect(calls(q, "limit")[0].args).toEqual([2]);
    expect(calls(q, "order")[0].args[0]).toBe("published_at");
  });

  test("related tops up from other categories with at most 2 queries", async () => {
    const { client, queries } = fakeClient([
      { data: [row({ id: "2", slug: "s2" })], error: null },
      { data: [row({ id: "9", slug: "s9", category: "education_career" })], error: null },
    ]);
    const art = rowToArticle(row())!;
    const out = await createSupabaseRepository(client).related(art, 3);
    expect(out.map((o) => o.slug)).toEqual(["s2", "s9"]);
    expect(queries).toHaveLength(2);
    expect(calls(queries[1], "neq")).toContainEqual({ method: "neq", args: ["category", "health_wellness"] });
    expect(calls(queries[1], "limit")[0].args).toEqual([2]);
    expect(calls(queries[1], "eq")).toContainEqual({ method: "eq", args: ["status", "PUBLISHED"] });
  });

  test("related with limit <= 0 makes no query", async () => {
    const { client, queries } = fakeClient();
    expect(await createSupabaseRepository(client).related(rowToArticle(row())!, 0)).toEqual([]);
    expect(queries).toHaveLength(0);
  });

  test("test_all_slugs_only_published", async () => {
    const { client, queries } = fakeClient({
      data: [
        { slug: "a", category: "health_wellness", published_at: "2026-09-02T00:00:00Z", created_at: "2026-09-01T00:00:00Z" },
        { slug: null, category: "health_wellness", published_at: null, created_at: "2026-09-01T00:00:00Z" },
        { slug: "b", category: "education_career", published_at: null, created_at: "2026-08-01T00:00:00Z" },
      ],
      error: null,
    });
    const out = await createSupabaseRepository(client).allSlugs();
    expect(out).toEqual([
      { slug: "a", publishedAt: "2026-09-02T00:00:00Z" },
      { slug: "b", publishedAt: "2026-08-01T00:00:00Z" },
    ]);
    expect(calls(queries[0], "eq")).toContainEqual({ method: "eq", args: ["status", "PUBLISHED"] });
  });
});

describe("skip decisions", () => {
  test("rows dropped by list are reported with aggregated reasons", async () => {
    const decisions: [string, Record<string, string | number> | undefined][] = [];
    const { client } = fakeClient({
      data: [row({ slug: "a" }), row({ slug: "b", category: "xyz" }), row({ slug: null }), row({ slug: "d", title: null })],
      error: null,
      count: 4,
    });
    const repo = createSupabaseRepository(client, { onDecision: (m, f) => decisions.push([m, f]) });
    const page = await repo.list({ page: 1, pageSize: 10 });
    expect(page.items.map((i) => i.slug)).toEqual(["a"]);
    expect(decisions).toEqual([["skipped 3 of 4 rows", { reasons: "unknown category 'xyz' x1, missing slug x1, missing title x1" }]]);
  });

  test("nothing is reported when no row is dropped, and no callback is fine", async () => {
    const decisions: string[] = [];
    const { client } = fakeClient({ data: [row()], error: null, count: 1 });
    await createSupabaseRepository(client, { onDecision: (m) => decisions.push(m) }).list({ page: 1, pageSize: 10 });
    expect(decisions).toEqual([]);
    const again = fakeClient({ data: [row({ category: "xyz" })], error: null, count: 1 });
    await expect(createSupabaseRepository(again.client).list({ page: 1, pageSize: 10 })).resolves.toBeTruthy();
  });

  test("getBySlug and allSlugs report dropped rows", async () => {
    const decisions: [string, Record<string, string | number> | undefined][] = [];
    const onDecision = (m: string, f?: Record<string, string | number>) => decisions.push([m, f]);
    const one = fakeClient({ data: row({ category: "xyz" }), error: null });
    expect(await createSupabaseRepository(one.client, { onDecision }).getBySlug("my-story")).toBeNull();
    const slugs = fakeClient({
      data: [{ slug: null, category: "health_wellness", published_at: null, created_at: "2026-09-01T00:00:00Z" }],
      error: null,
    });
    await createSupabaseRepository(slugs.client, { onDecision }).allSlugs();
    expect(decisions).toEqual([
      ["skipped 1 of 1 rows", { reasons: "unknown category 'xyz' x1" }],
      ["skipped 1 of 1 rows", { reasons: "missing slug x1" }],
    ]);
  });
});

describe("checkConnection", () => {
  test("counts published rows with a GET for one id and an exact count (not a head request)", async () => {
    const { client, queries } = fakeClient({ data: [], error: null, count: 7, status: 200 });
    await expect(checkConnection(client)).resolves.toEqual({ publishedRows: 7 });
    expect(calls(queries[0], "select")[0].args).toEqual(["id", { count: "exact" }]);
    expect(calls(queries[0], "eq")).toContainEqual({ method: "eq", args: ["status", "PUBLISHED"] });
    expect(calls(queries[0], "limit")).toEqual([{ method: "limit", args: [1] }]);
  });

  test("a non-ok status without an error object, or a missing count, is a failure", async () => {
    await expect(checkConnection(fakeClient({ data: null, error: null, count: null, status: 204 }).client)).rejects.toMatchObject({ status: 204 });
    await expect(checkConnection(fakeClient({ data: [], error: null, count: null, status: 200 }).client)).rejects.toMatchObject({
      message: expect.stringContaining("without a row count"),
    });
  });

  test("rejects with the error object and the response status attached", async () => {
    const { client } = fakeClient({ data: null, error: { message: "Invalid API key" }, count: null, status: 401 } as Result);
    await expect(checkConnection(client)).rejects.toMatchObject({ message: "Invalid API key", status: 401 });
  });
});

describe("fail fast", () => {
  test("every query turns off postgrest-js network retries", async () => {
    const { client, queries } = fakeClient({ data: [], error: null, count: 0 });
    const repo = createSupabaseRepository(client);
    await repo.list({ page: 1, pageSize: 3 });
    await repo.allSlugs();
    await checkConnection(client);
    expect(queries).toHaveLength(3);
    for (const q of queries) expect(calls(q, "retry")).toEqual([{ method: "retry", args: [false] }]);
  });
});

describe("one retry for transient failures", () => {
  const ok: Result = { data: [row()], error: null, count: 1 };
  const err = (e: Record<string, unknown>, status?: number): Result => ({ data: null, error: e as Result["error"], count: null, status });
  const list = (client: SupabaseLike) => createSupabaseRepository(client, { retryDelayMs: 0 }).list({ page: 1, pageSize: 10 });

  afterEach(() => {
    setLogSink(null);
    vi.unstubAllEnvs();
  });

  test.each([
    ["503", err({ message: "Service Unavailable" }, 503)],
    ["502", err({ message: "Bad Gateway" }, 502)],
    ["504", err({ message: "Gateway Timeout" }, 504)],
    ["520", err({ message: "Unknown" }, 520)],
    ["TimeoutError", err({ message: "TimeoutError: The operation was aborted due to timeout" })],
    ["ECONNRESET", err({ message: "TypeError: fetch failed", details: "cause: Error: read ECONNRESET" })],
    ["UND_ERR_SOCKET", err({ message: "TypeError: fetch failed", details: "cause: SocketError code: UND_ERR_SOCKET" })],
  ])("%s then success returns the data after exactly two client calls", async (_n, first) => {
    const { client, queries } = fakeClient([first, ok]);
    const page = await list(client);
    expect(page.items).toHaveLength(1);
    expect(queries).toHaveLength(2);
  });

  test("a persistent 503 makes exactly two calls then the generic RepositoryError", async () => {
    const { client, queries } = fakeClient(err({ message: "Service Unavailable" }, 503));
    await expect(list(client)).rejects.toMatchObject({ name: "RepositoryError", message: "Could not load stories." });
    expect(queries).toHaveLength(2);
  });

  test.each([
    ["ENOTFOUND", err({ message: "TypeError: fetch failed", details: "getaddrinfo ENOTFOUND x.supabase.co" })],
    ["ECONNREFUSED", err({ message: "TypeError: fetch failed", details: "connect ECONNREFUSED 127.0.0.1:9" })],
    ["401", err({ message: "Invalid API key" }, 401)],
    ["403", err({ message: "forbidden" }, 403)],
    ["404", err({ message: "not found" }, 404)],
    ["PGRST205", err({ message: "x", code: "PGRST205" }, 404)],
    ["SQL 42501", err({ message: "x", code: "42501" })],
  ])("%s is never retried", async (_n, failure) => {
    const { client, queries } = fakeClient([failure, ok]);
    await expect(list(client)).rejects.toBeInstanceOf(RepositoryError);
    expect(queries).toHaveLength(1);
  });

  test("the retry builds a fresh query builder", async () => {
    const { client, queries } = fakeClient([err({ message: "Service Unavailable" }, 503), ok]);
    await list(client);
    expect(queries).toHaveLength(2);
    expect(queries[0].calls.length).toBeGreaterThan(0);
    expect(queries[0].calls.length).toBe(queries[1].calls.length);
    expect(calls(queries[0], "select")).toHaveLength(1);
    expect(calls(queries[1], "select")).toHaveLength(1);
  });

  test("getBySlug and allSlugs retry too", async () => {
    const one = fakeClient([err({ message: "x" }, 503), { data: row(), error: null }]);
    expect((await createSupabaseRepository(one.client, { retryDelayMs: 0 }).getBySlug("my-story"))?.slug).toBe("my-story");
    expect(one.queries).toHaveLength(2);
  });

  test("checkConnection is not retried", async () => {
    const { client, queries } = fakeClient([err({ message: "Service Unavailable" }, 503), { data: null, error: null, count: 3 }]);
    await expect(checkConnection(client)).rejects.toMatchObject({ status: 503 });
    expect(queries).toHaveLength(1);
  });

  test("the retry is logged as one decision line", async () => {
    vi.stubEnv("DATA_LOG", "1");
    const lines: string[] = [];
    setLogSink((_l, line) => lines.push(line));
    const { client } = fakeClient([err({ message: "Service Unavailable" }, 503), ok]);
    await list(client);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('data  retrying once after transient error  reason="Supabase returned a server error" delay=0ms');
  });

  test("the default delay is about 300 ms", async () => {
    vi.useFakeTimers();
    try {
      const { client, queries } = fakeClient([err({ message: "x" }, 503), ok]);
      const pending = createSupabaseRepository(client).list({ page: 1, pageSize: 10 });
      await vi.advanceTimersByTimeAsync(299);
      expect(queries).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(2);
      expect((await pending).items).toHaveLength(1);
      expect(queries).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("image URLs are scheme-checked by the mapper", () => {
  test.each([
    ["data:", "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4="],
    ["javascript:", "javascript:alert(1)"],
    ["protocol-relative", "//evil.example/a.jpg"],
    ["plain http is fine", "http://example.com/a.jpg"],
    ["relative", "/api/revalidate"],
    ["empty", ""],
    ["whitespace", "  "],
  ])("test_image_url_%s", (name, value) => {
    const expected = name === "plain http is fine" ? value : null;
    expect(rowToArticle(row({ image_url: value }))?.imageUrl).toBe(expected);
  });

  test("test_list_items_carry_only_safe_image_urls", async () => {
    const { client } = fakeClient({
      data: [row({ slug: "a", image_url: "javascript:alert(1)" }), row({ slug: "b", image_url: "https://example.com/b.jpg" })],
      error: null,
      count: 2,
    });
    const page = await createSupabaseRepository(client).list({ page: 1, pageSize: 10 });
    expect(page.items.map((i) => i.imageUrl)).toEqual([null, "https://example.com/b.jpg"]);
  });
});

describe("source name fallbacks", () => {
  test("test_source_name_used_when_present_and_trimmed", () => {
    expect(rowToArticle(row({ source_name: "  The Hindu " }))?.sourceName).toBe("The Hindu");
  });

  test("test_empty_source_name_falls_back_to_domain", () => {
    expect(rowToArticle(row({ source_name: "", source_domain: "bbc.co.uk" }))?.sourceName).toBe("bbc.co.uk");
    expect(rowToArticle(row({ source_name: "   ", source_domain: " bbc.co.uk " }))?.sourceName).toBe("bbc.co.uk");
  });

  test("test_empty_source_name_and_domain_fall_back_to_url_host", () => {
    const a = rowToArticle(row({ source_name: "", source_domain: "", source_url: "https://www.ndtv.com/x" }));
    expect(a?.sourceName).toBe("www.ndtv.com");
    expect(rowToArticle(row({ source_name: null, source_domain: null, source_url: "https://www.ndtv.com/x" }))?.sourceName).toBe(
      "www.ndtv.com",
    );
  });

  test("test_list_rows_select_source_url_so_the_host_fallback_works", async () => {
    const { client, queries } = fakeClient({
      data: [row({ source_name: "", source_domain: "", source_url: "https://www.ndtv.com/x" })],
      error: null,
      count: 1,
    });
    const page = await createSupabaseRepository(client).list({ page: 1, pageSize: 10 });
    expect(String(calls(queries[0], "select")[0].args[0]).split(",")).toContain("source_url");
    expect(page.items[0].sourceName).toBe("www.ndtv.com");
  });

  test("test_no_name_domain_or_safe_url_reads_the_original_outlet", () => {
    for (const source_url of [null, "", "javascript:alert(1)", "not a url"]) {
      const a = rowToArticle(row({ source_name: "", source_domain: null, source_url }));
      expect(a?.sourceName, String(source_url)).toBe("the original outlet");
    }
  });
});

describe("allSlugs keeps only rows the pages can render", () => {
  test("test_all_slugs_selects_category_and_drops_unknown_categories", async () => {
    const decisions: [string, Record<string, string | number> | undefined][] = [];
    const { client, queries } = fakeClient({
      data: [
        { slug: "a", category: "health_wellness", published_at: "2026-09-02T00:00:00Z", created_at: "2026-09-01T00:00:00Z" },
        { slug: "b", category: "sports", published_at: "2026-09-02T00:00:00Z", created_at: "2026-09-01T00:00:00Z" },
        { slug: "c", category: null, published_at: "2026-09-02T00:00:00Z", created_at: "2026-09-01T00:00:00Z" },
        { slug: "d", category: "education_career", published_at: null, created_at: "2026-08-01T00:00:00Z" },
        { slug: "e", category: "health_wellness", published_at: null, created_at: null },
      ],
      error: null,
    });
    const out = await createSupabaseRepository(client, { onDecision: (m, f) => decisions.push([m, f]) }).allSlugs();
    expect(String(calls(queries[0], "select")[0].args[0]).split(",")).toContain("category");
    expect(out).toEqual([
      { slug: "a", publishedAt: "2026-09-02T00:00:00Z" },
      { slug: "d", publishedAt: "2026-08-01T00:00:00Z" },
    ]);
    expect(decisions).toEqual([
      ["skipped 3 of 5 rows", { reasons: "unknown category 'sports' x1, unknown category 'none' x1, missing date x1" }],
    ]);
  });

  test("test_every_sitemap_slug_resolves_with_get_by_slug", async () => {
    const data = [
      row({ slug: "a", category: "health_wellness" }),
      row({ slug: "b", category: "sports" }),
      row({ slug: "c", category: "biogas_clean_energy" }),
    ];
    const listed = await createSupabaseRepository(fakeClient({ data, error: null }).client).allSlugs();
    for (const { slug } of listed) {
      const one = data.find((r) => r.slug === slug)!;
      expect(await createSupabaseRepository(fakeClient({ data: one, error: null }).client).getBySlug(slug), slug).not.toBeNull();
    }
    expect(listed.map((s) => s.slug)).toEqual(["a", "c"]);
  });
});

describe("category rule is exact everywhere", () => {
  const VARIANT = "Health-Wellness";

  test("test_variant_category_row_is_absent_from_every_method", async () => {
    const decisions: [string, Record<string, string | number> | undefined][] = [];
    const onDecision = (m: string, f?: Record<string, string | number>) => decisions.push([m, f]);
    const bad = row({ id: "bad", slug: "bad-row", category: VARIANT });
    const good = row({ id: "good", slug: "good-row", category: "health_wellness" });
    const repoWith = (data: unknown) => createSupabaseRepository(fakeClient({ data, error: null, count: 2 }).client, { onDecision });
    const list = await repoWith([bad, good]).list({ page: 1, pageSize: 10 });
    const cat = await repoWith([bad, good]).list({ category: "health-wellness", page: 1, pageSize: 10 });
    const search = await repoWith([bad, good]).search("health", { page: 1, pageSize: 10 });
    // related tops up from other categories with a second query; that one returns nothing here.
    const related = await createSupabaseRepository(
      fakeClient([
        { data: [bad, good], error: null },
        { data: [], error: null },
      ]).client,
      { onDecision },
    ).related(rowToArticle(row({ id: "x", slug: "x" }))!, 5);
    const slugs = await repoWith([
      { slug: "bad-row", category: VARIANT, published_at: "2026-09-02T00:00:00Z", created_at: null },
      { slug: "good-row", category: "health_wellness", published_at: "2026-09-02T00:00:00Z", created_at: null },
    ]).allSlugs();
    const one = await repoWith(bad).getBySlug("bad-row");
    for (const [name, items] of [
      ["list", list.items],
      ["category list", cat.items],
      ["search", search.items],
      ["related", related],
      ["allSlugs", slugs],
    ] as const) {
      expect(items.map((i) => i.slug), name).toEqual(["good-row"]);
    }
    expect(one).toBeNull();
    expect(rowToArticle(bad)).toBeNull();
    // One decision line per call, naming the stored value and the key it should have been.
    const reason = "unknown category 'Health-Wellness' (expected 'health_wellness') x1";
    expect(decisions.length).toBeGreaterThanOrEqual(6);
    for (const [message, fields] of decisions) {
      expect(message).toMatch(/^skipped 1 of \d+ rows$/);
      expect(fields?.reasons).toBe(reason);
    }
  });

  test("test_unknown_category_without_a_close_key_names_only_the_value", async () => {
    const decisions: (Record<string, string | number> | undefined)[] = [];
    const { client } = fakeClient({ data: [row({ category: "sports" })], error: null, count: 1 });
    await createSupabaseRepository(client, { onDecision: (_m, f) => decisions.push(f) }).list({ page: 1, pageSize: 10 });
    expect(decisions).toEqual([{ reasons: "unknown category 'sports' x1" }]);
  });
});
