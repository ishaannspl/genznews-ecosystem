import { describe, expect, test, vi } from "vitest";

const getBySlug = vi.fn();
vi.mock("next/font/google", () => ({
  Bricolage_Grotesque: () => ({ variable: "" }),
  Source_Serif_4: () => ({ variable: "" }),
}));
vi.mock("@/lib/repositories", () => ({ getRepository: () => ({ getBySlug }) }));

const { generateMetadata: article } = await import("./article/[slug]/page");
const { generateMetadata: search } = await import("./search/page");
const { generateMetadata: category } = await import("./category/[slug]/page");
const { metadata: home } = await import("./page");
const { metadata: layout } = await import("./layout");
const { generateMetadata: latest } = await import("./latest/page");
const { metadata: about } = await import("./about/page");
const { metadata: notFound } = await import("./not-found");
const { listMetadata } = await import("@/lib/seo");

describe("page metadata", () => {
  test("unknown article gives a harmless noindex title, not a throw", async () => {
    getBySlug.mockResolvedValue(null);
    const m = await article({ params: Promise.resolve({ slug: "nope" }) });
    expect(m.title).toBe("Page not found");
    expect(m.robots).toEqual({ index: false, follow: false });
  });

  test("search is noindex, with the query cleaned and capped at 60 chars", async () => {
    const m = await search({ searchParams: Promise.resolve({ q: `  a\n${"b".repeat(100)}` }) });
    expect(m.robots).toEqual({ index: false, follow: true });
    const title = String(m.title);
    expect(title.startsWith("Search: a b")).toBe(true);
    expect(title.length).toBeLessThanOrEqual("Search: ".length + 60);
    expect(title).not.toContain("\n");
  });

  test("category title is the bare full name; template and home do not double the suffix", async () => {
    const m = await category({
      params: Promise.resolve({ slug: "health-wellness" }),
      searchParams: Promise.resolve({ page: "2" }),
    });
    expect(m.title).toBe("Health and wellness");
    expect(String(m.alternates?.canonical)).toMatch(/\/category\/health-wellness\?page=2$/);
    expect(layout.title).toMatchObject({ template: "%s | GenZNews", default: "GenZNews: Truth First. News Always." });
    expect(home.title).toEqual({ absolute: "GenZNews: Truth First. News Always." });
  });

  test("every page renders exactly one GenZNews suffix after the layout template", async () => {
    getBySlug.mockResolvedValue({
      slug: "a-b", title: "Story", summary: "S", bodyMd: "", category: "health-wellness", tags: [],
      sourceName: "X", sourceUrl: "https://x.test/", imageUrl: null, publishedAt: "2026-10-01T00:00:00.000Z",
      seoTitle: null, seoDescription: null, framework: null, id: "1",
    });
    const sp = (o: Record<string, string>) => Promise.resolve(o);
    const known = await article({ params: Promise.resolve({ slug: "a-b" }) });
    getBySlug.mockResolvedValue(null);
    const unknown = await article({ params: Promise.resolve({ slug: "nope" }) });
    const all = [
      home, about, notFound, known, unknown,
      await latest({ searchParams: sp({}) }),
      await latest({ searchParams: sp({ page: "2" }) }),
      await category({ params: Promise.resolve({ slug: "health-wellness" }), searchParams: sp({}) }),
      await category({ params: Promise.resolve({ slug: "nope" }), searchParams: sp({}) }),
      await search({ searchParams: sp({}) }),
      await search({ searchParams: sp({ q: "nhs" }) }),
    ];
    const tpl = layout.title as { default: string; template: string };
    for (const m of all) {
      const t = m.title as string | { absolute: string };
      const final = typeof t === "string" ? tpl.template.replace("%s", t) : t.absolute;
      expect(final.match(/GenZNews/g)?.length, final).toBeLessThanOrEqual(2);
      expect(final.split("| GenZNews").length - 1, final).toBeLessThanOrEqual(1);
      expect(final.endsWith("| GenZNews | GenZNews")).toBe(false);
    }
    expect(tpl.template.replace("%s", about.title as string)).toBe("About | GenZNews");
  });

  test("not-found is bare and noindex, unknown article falls back to the same title", async () => {
    expect(notFound.title).toBe("Page not found");
    expect(notFound.robots).toEqual({ index: false, follow: false });
  });

  test("listMetadata carries absolute og and twitter images", () => {
    const m = listMetadata({ title: "T", description: "d", path: "/x" });
    const og = (m.openGraph as { images: { url: string }[] }).images;
    const tw = (m.twitter as { images: string[] }).images;
    expect(og[0].url).toMatch(/^https?:\/\/.+\/opengraph-image$/);
    expect(tw[0]).toMatch(/^https?:\/\/.+\/opengraph-image$/);
  });
});
