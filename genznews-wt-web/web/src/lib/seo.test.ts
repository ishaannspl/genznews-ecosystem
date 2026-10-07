import { afterEach, describe, expect, test, vi } from "vitest";
import {
  absoluteUrl,
  articleMetadata,
  breadcrumbJsonLd,
  listMetadata,
  newsArticleJsonLd,
  safeJsonLd,
  siteUrl,
} from "./seo";
import type { Article } from "./types";

const article: Article = {
  id: "1",
  slug: "india-ai-semiconductors-2026",
  title: "India bets on AI chips",
  summary: "A short summary of the story.",
  bodyMd: "body",
  category: "education-career",
  tags: ["ai", "chips"],
  sourceName: "The Hindu",
  sourceUrl: "https://example.com/original",
  imageUrl: "https://example.com/img.jpg",
  publishedAt: "2026-10-01T08:00:00.000Z",
  seoTitle: null,
  seoDescription: null,
  framework: null,
};

afterEach(() => vi.unstubAllEnvs());

describe("siteUrl", () => {
  test("defaults, strips trailing slash, and rejects invalid values", () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "");
    expect(siteUrl()).toBe("http://localhost:3000");
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://genz.example/");
    expect(siteUrl()).toBe("https://genz.example");
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "not a url");
    expect(siteUrl()).toBe("http://localhost:3000");
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "javascript:alert(1)");
    expect(siteUrl()).toBe("http://localhost:3000");
  });
  test("absoluteUrl joins paths", () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://genz.example/");
    expect(absoluteUrl("/latest")).toBe("https://genz.example/latest");
    expect(absoluteUrl("latest")).toBe("https://genz.example/latest");
    expect(absoluteUrl("/")).toBe("https://genz.example/");
  });
});

describe("articleMetadata", () => {
  test("test_canonical_is_site_url_plus_article_path", () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://genz.example");
    const m = articleMetadata(article);
    expect(m.alternates?.canonical).toBe("https://genz.example/article/india-ai-semiconductors-2026");
  });

  test("test_title_and_description_fall_back_to_title_and_summary", () => {
    const m = articleMetadata(article);
    // The root layout title template adds " | GenZNews", so the page passes the bare title.
    expect(m.title).toBe("India bets on AI chips");
    expect(m.description).toBe("A short summary of the story.");
    const m2 = articleMetadata({ ...article, seoTitle: "SEO T", seoDescription: "SEO D" });
    expect(m2.title).toBe("SEO T");
    expect(m2.description).toBe("SEO D");
  });

  test("no double suffix and no markdown or newlines in text", () => {
    const m = articleMetadata({ ...article, title: "Hello\n  world", summary: "line one\n\nline two" });
    expect(m.title).toBe("Hello world");
    expect(String(m.title)).not.toContain("| GenZNews");
    expect(m.description).toBe("line one line two");
  });

  test("test_title_trimmed_to_70_chars_at_a_word_boundary", () => {
    const long = "headline ".repeat(12).trim();
    const t = String(articleMetadata({ ...article, title: long }).title);
    expect(t.length).toBeLessThanOrEqual(70);
    expect(t.endsWith("headline")).toBe(true);
    const s = String(articleMetadata({ ...article, seoTitle: long }).title);
    expect(s.length).toBeLessThanOrEqual(70);
  });

  test("test_empty_seo_title_falls_back_to_title", () => {
    expect(articleMetadata({ ...article, seoTitle: "  " }).title).toBe("India bets on AI chips");
  });

  test("test_description_falls_back_to_first_tldr_line_then_title_never_empty", () => {
    const body = "**TL;DR**\n\n- First *line* of the read\n- Second\n- Third\n\nBody\n";
    const m = articleMetadata({ ...article, summary: "", seoDescription: "", bodyMd: body });
    expect(m.description).toBe("First line of the read");
    const j = newsArticleJsonLd({ ...article, summary: "", seoDescription: null, bodyMd: body }) as Record<string, unknown>;
    expect(j.description).toBe("First line of the read");
    const bare = articleMetadata({ ...article, summary: " ", seoDescription: null, bodyMd: "Just a body" });
    expect(bare.description).toBe("India bets on AI chips");
  });

  test("test_plain_text_keeps_in_word_symbols_and_strips_html_and_paired_markdown", () => {
    const m = articleMetadata({
      ...article,
      title: "C# and snake_case_names stay",
      summary: "<b>Bold</b> **strong** _em_ `code` [link](https://x.example) ## not a heading <script>x</script>",
    });
    expect(m.title).toBe("C# and snake_case_names stay");
    expect(m.description).toBe("Bold strong em code link ## not a heading x");
    const h = articleMetadata({ ...article, title: "## Heading title" });
    expect(h.title).toBe("Heading title");
  });

  test("description is trimmed to 160 chars at a word boundary", () => {
    const long = "word ".repeat(80).trim();
    const d = String(articleMetadata({ ...article, summary: long }).description);
    expect(d.length).toBeLessThanOrEqual(160);
    expect(d.endsWith("word")).toBe(true);
  });

  test("test_open_graph_and_twitter_fields_present", () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://genz.example");
    const m = articleMetadata(article);
    const og = m.openGraph as Record<string, unknown>;
    expect(og).toMatchObject({
      type: "article",
      url: "https://genz.example/article/india-ai-semiconductors-2026",
      title: "India bets on AI chips",
      description: "A short summary of the story.",
      siteName: "GenZNews",
      locale: "en_IN",
      publishedTime: "2026-10-01T08:00:00.000Z",
      section: "Education and career",
      tags: ["ai", "chips"],
    });
    expect(og.images).toEqual([{ url: "https://example.com/img.jpg" }]);
    expect(m.twitter).toMatchObject({ card: "summary_large_image", title: "India bets on AI chips" });
    expect((m.twitter as { images?: unknown }).images).toEqual(["https://example.com/img.jpg"]);
    expect(m.robots).toEqual({ index: true, follow: true });
  });

  test("non-http or missing image falls back to the default branded image", () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://genz.example");
    for (const imageUrl of ["javascript:alert(1)", null]) {
      const m = articleMetadata({ ...article, imageUrl });
      expect((m.openGraph as { images?: unknown }).images).toEqual([{ url: "https://genz.example/opengraph-image" }]);
      expect((m.twitter as { images?: unknown }).images).toEqual(["https://genz.example/opengraph-image"]);
    }
  });
});

describe("listMetadata", () => {
  test("canonical is the bare path on page 1 and carries ?page=N after", () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://genz.example");
    const base = { title: "Latest stories", description: "d", path: "/latest" };
    expect(listMetadata(base).alternates?.canonical).toBe("https://genz.example/latest");
    expect(listMetadata({ ...base, page: 1 }).alternates?.canonical).toBe("https://genz.example/latest");
    expect(listMetadata({ ...base, page: 3 }).alternates?.canonical).toBe("https://genz.example/latest?page=3");
  });
  test("noindex only when asked", () => {
    const base = { title: "Search", description: "d", path: "/search" };
    expect(listMetadata({ ...base, noindex: true }).robots).toEqual({ index: false, follow: true });
    expect(listMetadata(base).robots).toBeUndefined();
  });
});

describe("JSON-LD", () => {
  test("test_news_article_jsonld_has_headline_dates_publisher_and_desk_author", () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://genz.example");
    const j = newsArticleJsonLd({ ...article, title: "x".repeat(200) }) as Record<string, unknown>;
    expect(j["@context"]).toBe("https://schema.org");
    expect(j["@type"]).toBe("NewsArticle");
    expect(String(j.headline).length).toBeLessThanOrEqual(110);
    expect(j.datePublished).toBe(article.publishedAt);
    expect(j.dateModified).toBe(article.publishedAt);
    expect(j.author).toEqual({ "@type": "Organization", name: "GenZNews Desk" });
    expect(j.publisher).toEqual({ "@type": "Organization", name: "GenZNews", url: "https://genz.example" });
    expect(j.mainEntityOfPage).toBe("https://genz.example/article/india-ai-semiconductors-2026");
    expect(j.articleSection).toBe("Education and career");
    expect(j.keywords).toBe("ai,chips");
    expect(j.inLanguage).toBe("en-IN");
    expect(j.isBasedOn).toBe("https://example.com/original");
    expect(j.image).toEqual(["https://example.com/img.jpg"]);
  });

  test.each([
    ["empty", ""],
    ["javascript:", "javascript:alert(1)"],
    ["relative", "/article/x"],
    ["null", null],
  ])("test_jsonld_is_based_on_omitted_for_%s", (_name, sourceUrl) => {
    const j = newsArticleJsonLd({ ...article, sourceUrl: sourceUrl as string });
    expect("isBasedOn" in j).toBe(false);
  });

  test("test_jsonld_is_based_on_kept_for_a_valid_url", () => {
    expect((newsArticleJsonLd(article) as Record<string, unknown>).isBasedOn).toBe("https://example.com/original");
  });

  test("test_jsonld_image_omitted_when_no_image", () => {
    const j = newsArticleJsonLd({ ...article, imageUrl: null });
    expect("image" in j).toBe(false);
  });

  test("test_safe_jsonld_escapes_angle_brackets_ampersand_and_line_separators", () => {
    const s = safeJsonLd({ a: "</script><b>&\u2028\u2029" });
    expect(s).not.toMatch(/[<>&\u2028\u2029]/);
    expect(s).toContain("\\u003c/script\\u003e");
    expect(JSON.parse(s)).toEqual({ a: "</script><b>&\u2028\u2029" });
  });

  test("test_breadcrumb_has_home_category_article", () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://genz.example");
    const b = breadcrumbJsonLd([
      { name: "Home", path: "/" },
      { name: "Education and career", path: "/category/education-career" },
      { name: "India bets on AI chips", path: "/article/x" },
    ]) as { "@type": string; itemListElement: { position: number; name: string; item: string }[] };
    expect(b["@type"]).toBe("BreadcrumbList");
    expect(b.itemListElement.map((i) => i.position)).toEqual([1, 2, 3]);
    expect(b.itemListElement[1].item).toBe("https://genz.example/category/education-career");
    expect(b.itemListElement[0].item).toBe("https://genz.example/");
  });
});
