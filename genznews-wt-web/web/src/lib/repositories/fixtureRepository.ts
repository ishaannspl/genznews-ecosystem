import data from "../fixtures/articles.json";
import type { CategorySlug } from "../categories";
import type { ArticleRepository } from "../repository";
import { normalizePaging } from "../paging";
import { summarize, type Article, type ArticleSummary, type Page } from "../types";

const MAX_QUERY = 100;

function newestFirst(a: Article, b: Article): number {
  if (a.publishedAt !== b.publishedAt) return a.publishedAt < b.publishedAt ? 1 : -1;
  return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
}

function paginate<T>(rows: T[], page: number, pageSize: number): Page<T> {
  const { page: p, pageSize: size } = normalizePaging(page, pageSize);
  const from = (p - 1) * size;
  return { items: rows.slice(from, from + size), total: rows.length, page: p, pageSize: size };
}

function terms(query: string): string[] {
  return query
    .slice(0, MAX_QUERY)
    .toLowerCase()
    .trim()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

export function createFixtureRepository(articles: Article[] = data as Article[]): ArticleRepository {
  const sorted = [...articles].sort(newestFirst);

  return {
    async getBySlug(slug) {
      const found = sorted.find((a) => a.slug === slug);
      // Clone so callers cannot mutate the shared fixture state.
      return found ? structuredClone(found) : null;
    },

    async list({ category, page, pageSize }) {
      const rows = category ? sorted.filter((a) => a.category === (category as CategorySlug)) : sorted;
      const res = paginate(rows, page, pageSize);
      return { ...res, items: res.items.map(summarize) };
    },

    async search(query, { page, pageSize }) {
      const ts = terms(query);
      if (ts.length === 0) return paginate<ArticleSummary>([], page, pageSize);

      const scored: { a: Article; score: number }[] = [];
      for (const a of sorted) {
        const title = a.title.toLowerCase();
        const rest = [a.summary, a.tags.join(" "), a.bodyMd].join("\n").toLowerCase();
        let score = 0;
        let ok = true;
        for (const t of ts) {
          const inTitle = title.includes(t);
          const inRest = rest.includes(t);
          if (!inTitle && !inRest) {
            ok = false;
            break;
          }
          if (inTitle) score += 3;
          if (inRest) score += 1;
        }
        if (ok) scored.push({ a, score });
      }
      // `sorted` is already newest-first and Array.sort is stable.
      scored.sort((x, y) => y.score - x.score);
      const res = paginate(scored, page, pageSize);
      return { ...res, items: res.items.map((s) => summarize(s.a)) };
    },

    async related(article, limit) {
      if (limit <= 0) return [];
      const others = sorted.filter((a) => a.id !== article.id && a.slug !== article.slug);
      const same = others.filter((a) => a.category === article.category);
      const rest = others.filter((a) => a.category !== article.category);
      return [...same, ...rest].slice(0, limit).map(summarize);
    },

    async allSlugs() {
      return sorted.map((a) => ({ slug: a.slug, publishedAt: a.publishedAt }));
    },
  };
}
