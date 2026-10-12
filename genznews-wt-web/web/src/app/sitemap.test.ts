import { beforeEach, describe, expect, test, vi } from "vitest";
import { RepositoryError } from "@/lib/repository";

const allSlugs = vi.fn();
vi.mock("@/lib/repositories", () => ({ getRepository: () => ({ allSlugs }) }));

const { default: sitemap } = await import("./sitemap");

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://genz.example");
  allSlugs.mockReset();
});

describe("sitemap", () => {
  test("test_sitemap_lists_home_categories_and_every_article_with_lastModified", async () => {
    allSlugs.mockResolvedValue([
      { slug: "a-one", publishedAt: "2026-10-01T00:00:00.000Z" },
      { slug: "b-two", publishedAt: "2026-10-02T00:00:00.000Z" },
    ]);
    const entries = await sitemap();
    const urls = entries.map((e) => e.url);
    expect(urls).toContain("https://genz.example/");
    expect(urls).toContain("https://genz.example/latest");
    expect(urls).toContain("https://genz.example/about");
    expect(urls.filter((u) => u.includes("/category/"))).toHaveLength(5);
    expect(urls).toContain("https://genz.example/article/a-one");
    expect(urls).toContain("https://genz.example/article/b-two");
    expect(entries).toHaveLength(10);
    const article = entries.find((e) => e.url.endsWith("/article/b-two"));
    expect(article?.lastModified).toEqual(new Date("2026-10-02T00:00:00.000Z"));
  });

  test("test_sitemap_survives_repository_error_with_static_routes_only", async () => {
    allSlugs.mockRejectedValue(new RepositoryError("down"));
    const entries = await sitemap();
    expect(entries).toHaveLength(8);
    expect(entries.some((e) => e.url.includes("/article/"))).toBe(false);
  });
});
