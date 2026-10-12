import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { resetFailureDedupe, setLogSink } from "../dataLog";
import { RepositoryError, type ArticleRepository } from "../repository";
import type { Article, ArticleSummary } from "../types";
import { withDataLogging } from "./loggingRepository";

const FAKE_KEY = "sb_publishable_FAKEKEY123";

const summary: ArticleSummary = {
  id: "1", slug: "a", title: "A", summary: "s", category: "health-wellness", imageUrl: null, publishedAt: "2026-10-01T00:00:00Z", sourceName: "BBC",
};
const article = { ...summary, bodyMd: "BODY TEXT SHOULD NEVER BE LOGGED", tags: [], sourceUrl: "https://x.test/a", seoTitle: null, seoDescription: null, framework: null } as Article;

function makeInner(overrides: Partial<ArticleRepository> = {}): ArticleRepository {
  return {
    getBySlug: vi.fn(async () => article),
    list: vi.fn(async ({ page, pageSize }) => ({ items: [summary, summary], total: 30, page, pageSize })),
    search: vi.fn(async (_q, { page, pageSize }) => ({ items: [], total: 0, page, pageSize })),
    related: vi.fn(async () => [summary]),
    allSlugs: vi.fn(async () => [{ slug: "a", publishedAt: "2026-10-01T00:00:00Z" }]),
    ...overrides,
  };
}

let lines: { level: string; line: string }[];
beforeEach(() => {
  resetFailureDedupe();
  vi.stubEnv("DATA_LOG", "1");
  lines = [];
  setLogSink((level, line) => lines.push({ level, line }));
});
afterEach(() => {
  setLogSink(null);
  vi.unstubAllEnvs();
});

const real = { source: "supabase", label: "supabase:example-project.supabase.co" } as const;

describe("withDataLogging", () => {
  test("list logs filters, rows, total, duration and source and returns the inner result", async () => {
    const inner = makeInner();
    const repo = withDataLogging(inner, real);
    const result = await repo.list({ category: "health-wellness", page: 2, pageSize: 12 });
    expect(result.total).toBe(30);
    expect(inner.list).toHaveBeenCalledWith({ category: "health-wellness", page: 2, pageSize: 12 });
    expect(lines).toHaveLength(1);
    expect(lines[0].level).toBe("info");
    expect(lines[0].line).toMatch(/ data {2}list {2}category=health-wellness page=2 pageSize=12 rows=2 total=30 duration=\d+ms source=supabase:example-project\.supabase\.co$/);
  });

  test("getBySlug logs found and not found without the body", async () => {
    const inner = makeInner();
    const repo = withDataLogging(inner, real);
    expect(await repo.getBySlug("a")).toBe(article);
    (inner.getBySlug as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
    expect(await repo.getBySlug("missing")).toBeNull();
    expect(lines[0].line).toMatch(/getBySlug {2}slug=a result=found duration=\d+ms/);
    expect(lines[1].line).toMatch(/getBySlug {2}slug=missing result=not-found/);
    expect(lines.map((l) => l.line).join("\n")).not.toContain("BODY TEXT");
  });

  test("search logs a cleaned, quoted, truncated query", async () => {
    const repo = withDataLogging(makeInner(), real);
    await repo.search("  nhs\n  waiting  ", { page: 1, pageSize: 12 });
    await repo.search("z".repeat(200), { page: 1, pageSize: 12 });
    expect(lines[0].line).toContain('q="nhs waiting" page=1 pageSize=12 rows=0 total=0');
    const q = /q="(z+)"/.exec(lines[1].line);
    expect(q?.[1].length).toBe(60);
  });

  test("related and allSlugs log counts", async () => {
    const repo = withDataLogging(makeInner(), real);
    await repo.related(article, 4);
    await repo.allSlugs();
    expect(lines[0].line).toMatch(/related {2}slug=a limit=4 rows=1/);
    expect(lines[1].line).toMatch(/allSlugs {2}rows=1 duration/);
  });

  test("errors are logged at error level with the explanation and rethrown unchanged", async () => {
    const original = new RepositoryError("Could not load stories.", {
      cause: { message: `TypeError: fetch failed ${FAKE_KEY}`, details: "cause: Error: getaddrinfo ENOTFOUND abc.supabase.co" },
    });
    const repo = withDataLogging(makeInner({ list: vi.fn(async () => { throw original; }) }), real);
    await expect(repo.list({ page: 1, pageSize: 12 })).rejects.toBe(original);
    expect(lines).toHaveLength(1);
    expect(lines[0].level).toBe("error");
    expect(lines[0].line).toContain('reason="Host name not found (DNS lookup failed)"');
    expect(lines[0].line).toContain("hint=");
    expect(lines[0].line).toContain("code=ENOTFOUND");
    expect(lines[0].line).not.toContain("FAKEKEY123");
  });

  test("non-repository errors keep their type", async () => {
    const original = new TypeError("nope");
    const repo = withDataLogging(makeInner({ allSlugs: vi.fn(async () => { throw original; }) }), real);
    await expect(repo.allSlugs()).rejects.toBe(original);
    expect(lines[0].level).toBe("error");
  });

  test("fixtures lines are prefixed with DEMO", async () => {
    const repo = withDataLogging(makeInner(), { source: "fixtures", label: "fixtures" });
    await repo.list({ page: 1, pageSize: 12 });
    expect(lines[0].line).toMatch(/ data {2}DEMO list /);
    expect(lines[0].line).toContain("source=fixtures");
  });

  test("passes through untouched when logging is disabled", async () => {
    vi.stubEnv("DATA_LOG", "0");
    const inner = makeInner();
    const repo = withDataLogging(inner, real);
    expect(await repo.getBySlug("a")).toBe(article);
    expect(lines).toHaveLength(0);
  });
});

describe("long hints", () => {
  test("the fix hint is not cut off", async () => {
    vi.stubEnv("DATA_LOG", "1");
    const lines: string[] = [];
    setLogSink((_l, line) => lines.push(line));
    const err = new RepositoryError("x", { cause: { message: "fetch failed", details: "getaddrinfo ENOTFOUND a.b" } });
    const repo = withDataLogging(makeInner({ allSlugs: vi.fn(async () => { throw err; }) }), real);
    await repo.allSlugs().catch(() => {});
    expect(lines[0]).toContain("into SUPABASE_URL.");
  });
});

describe("logging failures never change outcomes", () => {
  test("a throwing sink keeps results and rethrows the same error object", async () => {
    setLogSink(() => {
      throw new Error("sink boom");
    });
    const original = new Error("db down");
    const ok = withDataLogging(makeInner(), real);
    expect((await ok.list({ page: 1, pageSize: 12 })).total).toBe(30);
    const bad = withDataLogging(makeInner({ list: vi.fn(async () => { throw original; }) }), real);
    await expect(bad.list({ page: 1, pageSize: 12 })).rejects.toBe(original);
  });

  test("a throwing console does the same", async () => {
    setLogSink(null);
    const spies = (["info", "warn", "error"] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => { throw new Error("EPIPE"); }));
    const original = new RepositoryError("x");
    const ok = withDataLogging(makeInner(), real);
    expect((await ok.list({ page: 1, pageSize: 12 })).total).toBe(30);
    const bad = withDataLogging(makeInner({ allSlugs: vi.fn(async () => { throw original; }) }), real);
    await expect(bad.allSlugs()).rejects.toBe(original);
    spies.forEach((s) => s.mockRestore());
  });

  test("identical failures are printed once and summarised", async () => {
    vi.useFakeTimers();
    try {
      const err = new RepositoryError("x", { cause: { message: "fetch failed", details: "getaddrinfo ENOTFOUND a.b" } });
      const repo = withDataLogging(makeInner({ list: vi.fn(async () => { throw err; }) }), real);
      await Promise.all([1, 2, 3].map((n) => repo.list({ page: n, pageSize: 3 }).catch(() => {})));
      expect(lines.filter((l) => l.level === "error")).toHaveLength(1);
      vi.advanceTimersByTime(5000);
      expect(lines.some((l) => l.line.includes("2 more data call(s) failed"))).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
