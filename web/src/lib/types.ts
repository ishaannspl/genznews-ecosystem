import type { CategorySlug } from "./categories";

export interface Article {
  id: string;
  slug: string;
  title: string;
  summary: string;
  bodyMd: string;
  category: CategorySlug;
  tags: string[];
  sourceName: string;
  sourceUrl: string;
  imageUrl: string | null;
  publishedAt: string;
  seoTitle: string | null;
  seoDescription: string | null;
  framework: string | null;
}

export type ArticleSummary = Pick<
  Article,
  "id" | "slug" | "title" | "summary" | "category" | "imageUrl" | "publishedAt" | "sourceName"
>;

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

/** Single source of truth for reducing an Article to its list-card shape. */
export function summarize(a: Article): ArticleSummary {
  return {
    id: a.id,
    slug: a.slug,
    title: a.title,
    summary: a.summary,
    category: a.category,
    imageUrl: a.imageUrl,
    publishedAt: a.publishedAt,
    sourceName: a.sourceName,
  };
}
