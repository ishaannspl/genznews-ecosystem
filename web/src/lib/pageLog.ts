import { categoryBySlug } from "./categories";
import { dataLogEnabled, hostOf, logDecision, logPageFailure } from "./dataLog";
import { explainDataError } from "./explainError";
import { cleanQuery } from "./queryText";
import type { Article, ArticleSummary, Page } from "./types";

/**
 * Decision logs for server-rendered pages. Each helper is synchronous, does nothing (and builds
 * no strings) when logging is off, and logs slugs, ids, counts and rules, never article bodies.
 * Pages render at build/ISR time or per request, so a line appears when the page is rendered.
 */

const slugs = (items: { slug: string }[]) => items.map((s) => s.slug).join(",");
const isDemo = () => process.env.DATA_SOURCE?.trim() === "fixtures";

export function cleanForLog(raw: string): string {
  return cleanQuery(raw, 60);
}

export function logHomeDecisions(data: {
  lead: ArticleSummary | null;
  latest: ArticleSummary[];
  lanes: { category: { slug: string }; stories: ArticleSummary[] }[];
}): void {
  if (!dataLogEnabled()) return;
  if (!data.lead) {
    logDecision("home", "empty", { reason: "no published stories in the database" });
    return;
  }
  logDecision("home", "lead", {
    lead: data.lead.slug,
    published: data.lead.publishedAt,
    rule: "newest published story (published_at, created_at breaks ties)",
  });
  logDecision("home", "latest", { rail: slugs(data.latest), rule: "the next 5 newest" });
  for (const { category, stories } of data.lanes) {
    if (stories.length === 0) {
      logDecision("home", "category lane skipped", { lane: category.slug, reason: "no published stories" });
    } else {
      logDecision("home", "category lane", {
        lane: category.slug,
        picked: slugs(stories),
        rule: "3 newest published in category",
      });
    }
  }
}

export function logHomeError(error: unknown): void {
  if (!dataLogEnabled()) return;
  const why = explainDataError(error);
  logPageFailure("home", "render failed", {
    reason: why.reason,
    code: why.code,
    result: "last good page kept, or the error page if none was generated",
  });
}

export function logListError(scope: "latest" | "category" | "search"): void {
  if (!dataLogEnabled()) return;
  logPageFailure(scope, "error state shown", { reason: "the data call failed, see the data error line above" });
}

export function logListDecision(
  scope: "latest" | "category",
  result: Page<ArticleSummary>,
  page: number,
  extra?: { category?: string },
): void {
  if (!dataLogEnabled()) return;
  logDecision(scope, "page", {
    category: extra?.category,
    page,
    pages: Math.max(1, Math.ceil(result.total / result.pageSize)),
    rows: result.items.length,
    total: result.total,
    rule: "newest published first",
  });
}

export function logSearchDecision(query: string, result: Page<ArticleSummary> | null, page: number): void {
  if (!dataLogEnabled()) return;
  const q = cleanForLog(query);
  if (!q) {
    logDecision("search", "no query, search not run");
    return;
  }
  if (!result) return;
  logDecision("search", "query", {
    q: `"${q.replace(/"/g, "'")}"`,
    terms: q.split(" ").length,
    results: result.total,
    page,
    pages: Math.max(1, Math.ceil(result.total / result.pageSize)),
    rows: result.items.length,
    rule: isDemo() ? "demo keyword match" : "postgres websearch on title, summary and body (english)",
  });
  if (result.total === 0) {
    logDecision("search", "empty", { reason: "no published story matched every term" });
  }
}

export function logArticleDecisions(article: Article, related: ArticleSummary[], tldrLines: number): void {
  if (!dataLogEnabled()) return;
  logDecision("article", "provenance", {
    slug: article.slug,
    id: article.id,
    category: categoryBySlug(article.category)?.slug ?? article.category,
    outlet: article.sourceName,
    original: hostOf(article.sourceUrl),
    published: article.publishedAt,
    body: isDemo() ? "output/*.md (demo)" : "site_articles.body_md",
    tldr: tldrLines,
  });
  logDecision("article", "related", {
    picked: slugs(related),
    rule: "newest published in the same category, topped up from other categories",
  });
}
