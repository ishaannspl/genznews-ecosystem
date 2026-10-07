import { dataLogEnabled, logData, logFailure, type LogFields } from "../dataLog";
import { explainDataError } from "../explainError";
import { cleanQuery } from "../queryText";
import type { ArticleRepository } from "../repository";

export interface LoggingMeta {
  source: "supabase" | "fixtures";
  label: string;
}

const MAX_Q = 60;

function cleanQ(raw: string): string {
  return `"${cleanQuery(raw, MAX_Q).replace(/"/g, "'")}"`;
}

/**
 * Logs one line per repository call (operation, filters, row counts, duration, source).
 * Results, ordering, timing and error types are untouched: failures are logged and the
 * original error is rethrown. Fixture lines carry a DEMO prefix.
 */
export function withDataLogging(inner: ArticleRepository, meta: LoggingMeta): ArticleRepository {
  const demo = meta.source === "fixtures" ? "DEMO " : "";

  function run<T>(op: string, filter: LogFields, call: () => Promise<T>, outcome: (value: T) => LogFields): Promise<T> {
    if (!dataLogEnabled()) return call();
    const started = performance.now();
    const took = () => `${Math.round(performance.now() - started)}ms`;
    return call().then(
      (value) => {
        try {
          logData("data", `${demo}${op}`, { ...filter, ...outcome(value), duration: took(), source: meta.label });
        } catch {
          // logging never changes a result
        }
        return value;
      },
      (error: unknown) => {
        try {
          const why = explainDataError(error);
          logFailure("data", `${demo}${op} failed`, {
            ...filter,
            reason: why.reason,
            hint: why.hint,
            code: why.code,
            duration: took(),
            source: meta.label,
          });
        } catch {
          // logging never masks the original error
        }
        throw error;
      },
    );
  }

  return {
    getBySlug: (slug) =>
      run("getBySlug", { slug }, () => inner.getBySlug(slug), (a) => ({ result: a ? "found" : "not-found" })),

    list: (opts) =>
      run(
        "list",
        { category: opts.category, page: opts.page, pageSize: opts.pageSize },
        () => inner.list(opts),
        (p) => ({ rows: p.items.length, total: p.total }),
      ),

    search: (query, opts) =>
      run(
        "search",
        { q: cleanQ(query), page: opts.page, pageSize: opts.pageSize },
        () => inner.search(query, opts),
        (p) => ({ rows: p.items.length, total: p.total }),
      ),

    related: (article, limit) =>
      run("related", { slug: article.slug, limit }, () => inner.related(article, limit), (r) => ({ rows: r.length })),

    allSlugs: () => run("allSlugs", {}, () => inner.allSlugs(), (r) => ({ rows: r.length })),
  };
}
