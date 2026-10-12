import type { CategorySlug } from "./categories";
import type { Article, ArticleSummary, Page } from "./types";

export interface ArticleRepository {
  getBySlug(slug: string): Promise<Article | null>;
  list(opts: { category?: CategorySlug; page: number; pageSize: number }): Promise<Page<ArticleSummary>>;
  search(query: string, opts: { page: number; pageSize: number }): Promise<Page<ArticleSummary>>;
  related(article: Article, limit: number): Promise<ArticleSummary[]>;
  allSlugs(): Promise<{ slug: string; publishedAt: string }[]>;
}

export class RepositoryError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "RepositoryError";
  }
}
