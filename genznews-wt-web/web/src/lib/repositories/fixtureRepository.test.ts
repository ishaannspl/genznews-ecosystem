import { describe, expect, test } from "vitest";
import { createFixtureRepository } from "./fixtureRepository";
import type { Article } from "../types";
import { categoryBySlug, type CategorySlug } from "../categories";

function make(slug: string, over: Partial<Article> = {}): Article {
  return {
    id: slug,
    slug,
    title: `Title ${slug}`,
    summary: `Summary ${slug}`,
    bodyMd: `**TL;DR**\n\n- a\n- b\n- c\n\nBody ${slug}\n\n---\n\n*Attr*\n`,
    category: "health-wellness",
    tags: [],
    sourceName: "example.com",
    sourceUrl: "https://example.com/x",
    imageUrl: null,
    publishedAt: "2026-09-01T00:00:00.000Z",
    seoTitle: null,
    seoDescription: null,
    framework: null,
    ...over,
  };
}

const day = (n: number) => `2026-09-${String(n).padStart(2, "0")}T00:00:00.000Z`;

function set(): Article[] {
  const cats: CategorySlug[] = ["health-wellness", "education-career"];
  return Array.from({ length: 7 }, (_, i) => make(`a${i + 1}`, { publishedAt: day(i + 1), category: cats[i % 2] }));
}

describe("fixture repository", () => {
  test("test_list_is_newest_first_and_paginates", async () => {
    const repo = createFixtureRepository(set());
    const p1 = await repo.list({ page: 1, pageSize: 3 });
    expect(p1.items.map((i) => i.slug)).toEqual(["a7", "a6", "a5"]);
    expect(p1.total).toBe(7);
    expect(p1.page).toBe(1);
    expect(p1.pageSize).toBe(3);
    const p3 = await repo.list({ page: 3, pageSize: 3 });
    expect(p3.items.map((i) => i.slug)).toEqual(["a1"]);
    expect("bodyMd" in p1.items[0]).toBe(false);
  });

  test("ties on publishedAt break by slug", async () => {
    const repo = createFixtureRepository([make("b"), make("a"), make("c")]);
    const p = await repo.list({ page: 1, pageSize: 10 });
    expect(p.items.map((i) => i.slug)).toEqual(["a", "b", "c"]);
  });

  test("test_list_filters_by_category", async () => {
    const repo = createFixtureRepository(set());
    const p = await repo.list({ category: "education-career", page: 1, pageSize: 10 });
    expect(p.items.map((i) => i.slug)).toEqual(["a6", "a4", "a2"]);
    expect(p.total).toBe(3);
  });

  test("test_get_by_slug_and_unknown_slug_is_null", async () => {
    const repo = createFixtureRepository(set());
    expect((await repo.getBySlug("a3"))?.slug).toBe("a3");
    expect(await repo.getBySlug("nope")).toBeNull();
    expect(await repo.getBySlug("A3")).toBeNull();
    expect(await repo.getBySlug("a")).toBeNull();
  });

  test("test_search_ranks_title_matches_above_body_matches", async () => {
    const repo = createFixtureRepository([
      make("body-hit", { title: "Other", bodyMd: "about quantum things", publishedAt: day(9) }),
      make("title-hit", { title: "Quantum leap", publishedAt: day(1) }),
    ]);
    const p = await repo.search("quantum", { page: 1, pageSize: 10 });
    expect(p.items.map((i) => i.slug)).toEqual(["title-hit", "body-hit"]);
    expect(p.total).toBe(2);
  });

  test("search is case-insensitive, trims, and requires every term", async () => {
    const repo = createFixtureRepository([
      make("x", { title: "Nvidia chips", summary: "China buys" }),
      make("y", { title: "Nvidia only", summary: "nothing" }),
    ]);
    const p = await repo.search("  NVIDIA   china ", { page: 1, pageSize: 10 });
    expect(p.items.map((i) => i.slug)).toEqual(["x"]);
  });

  test("search matches tags and caps query length", async () => {
    const repo = createFixtureRepository([make("t", { tags: ["semiconductors"] })]);
    expect((await repo.search("semiconductors", { page: 1, pageSize: 5 })).total).toBe(1);
    const long = "a".repeat(5000);
    await expect(repo.search(long, { page: 1, pageSize: 5 })).resolves.toBeDefined();
  });

  test("test_search_blank_or_symbols_only_returns_empty_page", async () => {
    const repo = createFixtureRepository(set());
    for (const q of ["", "   ", "!!! ???", "---"]) {
      const p = await repo.search(q, { page: 1, pageSize: 5 });
      expect(p).toEqual({ items: [], total: 0, page: 1, pageSize: 5 });
    }
  });

  test("hostile query strings return a page without throwing", async () => {
    const repo = createFixtureRepository(set());
    for (const q of ["'", "%", "&", "|", ":*", "<script>", "a'; drop table x;--", "title:*&!|"]) {
      const p = await repo.search(q, { page: 1, pageSize: 5 });
      expect(Array.isArray(p.items)).toBe(true);
    }
    const p = await repo.search("<script>alert(1)</script>", { page: 1, pageSize: 5 });
    expect(p.total).toBe(0);
  });

  test("test_related_excludes_self_and_prefers_same_category", async () => {
    const articles = set();
    const repo = createFixtureRepository(articles);
    const self = articles[0]; // a1 health
    const rel = await repo.related(self, 4);
    expect(rel.map((r) => r.slug)).not.toContain("a1");
    expect(rel).toHaveLength(4);
    expect(rel.map((r) => r.slug)).toEqual(["a7", "a5", "a3", "a6"]);
    expect(await repo.related(self, 0)).toEqual([]);
  });

  test("test_all_slugs_lists_every_article", async () => {
    const repo = createFixtureRepository(set());
    const all = await repo.allSlugs();
    expect(all).toHaveLength(7);
    expect(all).toContainEqual({ slug: "a3", publishedAt: day(3) });
  });

  test("test_page_beyond_last_returns_empty_items_with_correct_total", async () => {
    const repo = createFixtureRepository(set());
    const p = await repo.list({ page: 9, pageSize: 3 });
    expect(p.items).toEqual([]);
    expect(p.total).toBe(7);
    expect(p.page).toBe(9);
  });

  test("page below 1 is treated as page 1", async () => {
    const repo = createFixtureRepository(set());
    const p = await repo.list({ page: 0, pageSize: 3 });
    expect(p.items.map((i) => i.slug)).toEqual(["a7", "a6", "a5"]);
  });
});

describe("fixture repository isolation and paging", () => {
  test("test_mutating_a_returned_article_does_not_affect_next_call", async () => {
    const repo = createFixtureRepository([make("a")]);
    const first = (await repo.getBySlug("a"))!;
    first.title = "HACKED";
    first.tags.push("evil");
    const second = (await repo.getBySlug("a"))!;
    expect(second.title).toBe("Title a");
    expect(second.tags).toEqual([]);
  });

  test("test_uses_shared_paging_sanitation", async () => {
    const repo = createFixtureRepository(set());
    const p = await repo.list({ page: Number.NaN, pageSize: 5000 });
    expect(p.page).toBe(1);
    expect(p.pageSize).toBe(100);
    expect((await repo.list({ page: 1e21, pageSize: 5 })).page).toBe(10000);
    expect((await repo.list({ page: 1.9, pageSize: 2.5 })).pageSize).toBe(2);
  });
});

describe("fixture repository parity with the database rules", () => {
  test("test_every_fixture_slug_in_all_slugs_resolves_and_has_a_known_category", async () => {
    const repo = createFixtureRepository();
    const slugs = await repo.allSlugs();
    expect(slugs.length).toBeGreaterThan(0);
    for (const { slug } of slugs) {
      const a = await repo.getBySlug(slug);
      expect(a, slug).not.toBeNull();
      expect(categoryBySlug(a!.category), `${slug} category`).toBeDefined();
    }
  });
});
