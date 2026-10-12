import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { resetFailureDedupe, setLogSink } from "@/lib/dataLog";
import { createFixtureRepository } from "@/lib/repositories/fixtureRepository";
import { RepositoryError, type ArticleRepository } from "@/lib/repository";

let stub: ArticleRepository = createFixtureRepository();
vi.mock("@/lib/repositories", () => ({ getRepository: () => stub }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));

const { default: HomePage } = await import("./page");
const { default: LatestPage } = await import("./latest/page");
const { default: CategoryPage } = await import("./category/[slug]/page");
const { default: SearchPage } = await import("./search/page");
const { default: ArticlePage } = await import("./article/[slug]/page");

let lines: { level: string; line: string }[];
const text = () => lines.map((l) => l.line).join("\n");

beforeEach(() => {
  stub = createFixtureRepository();
  lines = [];
  resetFailureDedupe();
  vi.stubEnv("DATA_LOG", "1");
  vi.stubEnv("DATA_SOURCE", "supabase");
  setLogSink((level, line) => lines.push({ level, line }));
});
afterEach(() => {
  setLogSink(null);
  vi.unstubAllEnvs();
});

const empty = Promise.resolve({});

describe("page decision logs", () => {
  test("home logs the lead, the latest rail and every lane", async () => {
    const out = render(await HomePage());
    expect(out.container.querySelectorAll("h1")).toHaveLength(1);
    const t = text();
    expect(t).toMatch(/ home {2}lead {2}lead=\S+ published=\S+ rule="newest published story \(published_at, created_at breaks ties\)"/);
    expect(t).toMatch(/ home {2}latest {2}rail=\S+,\S+,\S+,\S+,\S+ rule="the next 5 newest"/);
    expect(t).toMatch(/home {2}category lane {2}lane=health-wellness picked=\S+ rule="3 newest published in category"/);
    expect((t.match(/category lane /g) ?? []).length).toBe(5);
  });

  test("home explains a skipped lane and an empty database", async () => {
    const base = createFixtureRepository();
    stub = { ...base, list: async (o) => (o.category === "health-wellness" ? { items: [], total: 0, page: 1, pageSize: 3 } : base.list(o)) };
    render(await HomePage());
    expect(text()).toMatch(/category lane skipped {2}lane=health-wellness reason="no published stories"/);

    lines.length = 0;
    stub = { ...base, list: async (o) => ({ items: [], total: 0, page: o.page, pageSize: o.pageSize }) };
    render(await HomePage());
    expect(text()).toContain('empty  reason="no published stories in the database"');
  });

  test("home logs the explained reason when the repository fails", async () => {
    stub = {
      ...createFixtureRepository(),
      list: async () => {
        throw new RepositoryError("Could not load stories.", { cause: { message: "TypeError: fetch failed", details: "getaddrinfo ENOTFOUND x.supabase.co" } });
      },
    };
    await expect(HomePage()).rejects.toBeInstanceOf(RepositoryError);
    const line = lines.find((l) => l.line.includes("render failed"));
    // An unreachable database is an operator problem: the page line is a warning (the data line is the error).
    expect(line?.level).toBe("warn");
    expect(line?.line).toContain('reason="Host name not found (DNS lookup failed)"');
  });

  test("latest and category log page, pages and rows", async () => {
    render(await LatestPage({ searchParams: Promise.resolve({ page: "2" }) }));
    expect(text()).toMatch(/ latest {2}page {2}page=2 pages=2 rows=3 total=15/);
    lines.length = 0;
    render(await CategoryPage({ params: Promise.resolve({ slug: "health-wellness" }), searchParams: empty }));
    expect(text()).toMatch(/ category {2}page {2}category=health-wellness page=1 pages=1 rows=\d+ total=\d+/);
  });

  test("search logs the cleaned query, terms and the rule; zero results are explained", async () => {
    render(await SearchPage({ searchParams: Promise.resolve({ q: "  nhs   waiting " }) }));
    expect(text()).toMatch(/ search {2}query {2}q="nhs waiting" terms=2 results=\d+ page=1 pages=\d+ rows=\d+ rule="postgres websearch on title, summary and body \(english\)"/);
    lines.length = 0;
    render(await SearchPage({ searchParams: Promise.resolve({ q: "zzzzqq" }) }));
    expect(text()).toContain("results=0");
    expect(text()).toContain('empty  reason="no published story matched every term"');
  });

  test("search in fixtures mode says demo keyword match", async () => {
    vi.stubEnv("DATA_SOURCE", "fixtures");
    render(await SearchPage({ searchParams: Promise.resolve({ q: "nhs" }) }));
    expect(text()).toContain('rule="demo keyword match"');
  });

  test("article logs provenance and related picks, never the body", async () => {
    const [first] = (await stub.list({ page: 1, pageSize: 1 })).items;
    const article = await stub.getBySlug(first.slug);
    render(await ArticlePage({ params: Promise.resolve({ slug: first.slug }) }));
    const t = text();
    expect(t).toContain(`article  provenance  slug=${first.slug} id=${first.id}`);
    expect(t).toMatch(/outlet=\S+ original=\S+ published=\S+ body=site_articles\.body_md tldr=\d/);
    expect(t).toMatch(/article {2}related {2}picked=\S+ rule="newest published in the same category, topped up from other categories"/);
    expect(t).not.toContain(article!.bodyMd.slice(0, 40));
  });

  test("nothing is logged and nothing breaks when logging is off", async () => {
    vi.stubEnv("DATA_LOG", "0");
    const out = render(await HomePage());
    expect(out.container.querySelectorAll("h1")).toHaveLength(1);
    expect(lines).toHaveLength(0);
  });
});
