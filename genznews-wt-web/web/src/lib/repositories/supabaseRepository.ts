import { createClient } from "@supabase/supabase-js";
import { canonicalUrlHash } from "../canonicalUrl";
import { categoryByNicheKey, categoryBySlug, expectedNicheKey, type CategorySlug } from "../categories";
import { logData } from "../dataLog";
import { explainDataError, isTransientDataError } from "../explainError";
import { normalizePaging } from "../paging";
import { cleanQuery } from "../queryText";
import { RepositoryError, type ArticleRepository } from "../repository";
import type { Article, ArticleSummary, Page } from "../types";
import { safeHttpUrl } from "../url";

const TABLE = "site_articles";
const STATUS = "PUBLISHED";
const GENERIC_ERROR = "Could not load stories.";

/** Only the columns the site needs. Internal columns are deliberately absent. */
const SUMMARY_COLS = "id,slug,title,summary,category,image_url,published_at,created_at,source_name,source_domain,source_url";
const ARTICLE_COLS = `${SUMMARY_COLS},body_md,tags,seo_title,seo_description,framework`;
const SLUG_COLS = "slug,category,published_at,created_at";
/** Shown when a row names no outlet at all; SourceCredit then reads "Reported by the original outlet." */
export const UNKNOWN_OUTLET = "the original outlet";

export interface SiteArticleRow {
  id: string;
  slug: string | null;
  title: string | null;
  summary: string | null;
  body_md: string | null;
  category: string | null;
  tags: string[] | null;
  source_name: string | null;
  source_domain: string | null;
  source_url: string | null;
  image_url: string | null;
  published_at: string | null;
  created_at: string | null;
  seo_title: string | null;
  seo_description: string | null;
  framework: string | null;
}

type SummaryRow = Pick<
  SiteArticleRow,
  | "id"
  | "slug"
  | "title"
  | "summary"
  | "category"
  | "image_url"
  | "published_at"
  | "created_at"
  | "source_name"
  | "source_domain"
  | "source_url"
>;

/** Minimal structural view of the supabase-js client (the real client is assignable to it). */
export interface QueryResult {
  data: unknown;
  error: { message: string; code?: string; status?: number; details?: string; hint?: string } | null;
  count?: number | null;
  status?: number;
}
export interface QueryLike extends PromiseLike<QueryResult> {
  eq(column: string, value: string): this;
  neq(column: string, value: string): this;
  order(column: string, options?: { ascending?: boolean; nullsFirst?: boolean }): this;
  range(from: number, to: number): this;
  textSearch(column: string, query: string, options?: { type?: "websearch"; config?: string }): this;
  limit(count: number): this;
  /** postgrest-js retries GET/HEAD network failures 3 times with 1s, 2s, 4s backoff; the site fails fast instead. */
  retry?(enabled: boolean): this;
  maybeSingle(): PromiseLike<QueryResult>;
}
export interface SupabaseLike {
  from(table: string): {
    select(columns: string, options?: { count?: "exact"; head?: boolean }): QueryLike;
  };
}

/** Names the stored value and, for a near miss such as `Health-Wellness`, the exact key expected. */
function unknownCategory(category: string | null | undefined): string {
  const expected = category ? expectedNicheKey(category) : undefined;
  return `unknown category '${category || "none"}'${expected ? ` (expected '${expected}')` : ""}`;
}

/** Why toSummary/rowToArticle would drop this row; used only to explain skipped rows. */
function skipReason(row: Partial<Pick<SummaryRow, "category" | "slug" | "title">>): string {
  if (!row.slug) return "missing slug";
  if (!row.title) return "missing title";
  return row.category && categoryByNicheKey(row.category) ? "unmappable row" : unknownCategory(row.category);
}

type SlugRow = { slug: string | null; category: string | null; published_at: string | null; created_at: string | null };

/** Why a sitemap row is dropped. Uses the same category rule as the page mappers. */
function slugSkipReason(row: SlugRow): string {
  if (!row.slug) return "missing slug";
  if (!(row.category && categoryByNicheKey(row.category))) return unknownCategory(row.category);
  return "missing date";
}

export type DecisionFn = (message: string, fields?: Record<string, string | number>) => void;
export interface SupabaseRepositoryOptions {
  /** Wait before the single retry of a transient failure. Default 300 ms; tests pass 0. */
  retryDelayMs?: number;
  /** Told when rows are dropped (unknown category, missing slug or title). Default: no-op. */
  onDecision?: DecisionFn;
}

function toSummary(row: SummaryRow): ArticleSummary | null {
  const cat = row.category ? categoryByNicheKey(row.category) : undefined;
  if (!cat || !row.slug || !row.title) return null;
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    summary: row.summary ?? "",
    category: cat.slug,
    // Rendered as an <img src> and in og:image: anything but an absolute http(s) URL becomes null.
    imageUrl: safeHttpUrl(row.image_url),
    publishedAt: row.published_at ?? row.created_at ?? "",
    sourceName:
      row.source_name?.trim() || row.source_domain?.trim() || hostOf(safeHttpUrl(row.source_url) ?? "") || UNKNOWN_OUTLET,
  };
}

/** Returns null (never throws) when the category is unknown or slug/title is missing. */
export function rowToArticle(row: SiteArticleRow): Article | null {
  const s = toSummary(row);
  if (!s) return null;
  return {
    ...s,
    bodyMd: row.body_md ?? "",
    tags: row.tags ?? [],
    sourceUrl: row.source_url ?? "",
    seoTitle: row.seo_title ?? null,
    seoDescription: row.seo_description ?? null,
    framework: row.framework ?? null,
  };
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
}

/** Used only by the dev seed script. Byline is left to the column default. */
export function articleToRow(a: Article): Record<string, unknown> {
  const cat = categoryBySlug(a.category);
  return {
    url_hash: canonicalUrlHash(a.sourceUrl),
    slug: a.slug,
    title: a.title,
    summary: a.summary,
    body_md: a.bodyMd,
    category: cat ? cat.nicheKey : a.category,
    tags: a.tags,
    source_name: a.sourceName,
    source_domain: hostOf(a.sourceUrl) || a.sourceName,
    source_url: a.sourceUrl,
    image_url: a.imageUrl,
    seo_title: a.seoTitle,
    seo_description: a.seoDescription,
    framework: a.framework,
    published_at: a.publishedAt,
    status: STATUS,
    ai_disclosure: false,
  };
}

function fail(cause: unknown): RepositoryError {
  return new RepositoryError(GENERIC_ERROR, { cause });
}

/** The query error with the HTTP status of the response attached, so it can be explained later. */
function errorOf(res: QueryResult): unknown {
  return res.error && { ...res.error, status: res.error.status ?? res.status };
}

function rows(res: QueryResult): unknown[] {
  if (res.error) throw fail(errorOf(res));
  return Array.isArray(res.data) ? res.data : [];
}

/**
 * Turns off postgrest-js's own network retries (3 tries with 1 s, 2 s, 4 s backoff) so a dead
 * host fails within one request timeout; `guard` adds a single bounded retry of its own.
 */
function failFast(q: QueryLike): QueryLike {
  return typeof q.retry === "function" ? q.retry(false) : q;
}

/**
 * Cheap startup probe: counts published rows with a GET for at most one id plus an exact count.
 * Not a HEAD request: a HEAD response has no body, so PostgREST's error (for example PGRST205,
 * table not found) was lost and postgrest-js reported the 404 as an empty success.
 * Succeeds only when the table answered 200/206 with a row count. Otherwise rejects with the raw
 * error object (status attached) so `explainDataError` can classify it. Not retried.
 */
export async function checkConnection(client: SupabaseLike): Promise<{ publishedRows: number }> {
  const res = await failFast(client.from(TABLE).select("id", { count: "exact" }))
    .eq("status", STATUS)
    .limit(1);
  if (res.error) throw errorOf(res);
  if (res.status !== undefined && res.status !== 200 && res.status !== 206) {
    throw { message: `Unexpected answer from public.site_articles (HTTP ${res.status})`, status: res.status };
  }
  if (typeof res.count !== "number" || !Number.isFinite(res.count)) {
    throw { message: "public.site_articles answered without a row count" };
  }
  return { publishedRows: res.count };
}

export function createSupabaseRepository(client: SupabaseLike, options: SupabaseRepositoryOptions = {}): ArticleRepository {
  const onDecision: DecisionFn = options.onDecision ?? (() => {});

  /** Maps raw rows, reporting (once per call) how many were dropped and why. */
  function mapRows<T, R = SummaryRow>(
    raw: unknown[],
    map: (r: R) => T | null,
    reason: (r: R) => string = skipReason as unknown as (r: R) => string,
  ): T[] {
    const out: T[] = [];
    const reasons = new Map<string, number>();
    for (const r of raw) {
      const mapped = map(r as R);
      if (mapped) out.push(mapped);
      else {
        const why = reason(r as R);
        reasons.set(why, (reasons.get(why) ?? 0) + 1);
      }
    }
    if (reasons.size > 0) {
      const dropped = raw.length - out.length;
      onDecision(`skipped ${dropped} of ${raw.length} rows`, {
        reasons: [...reasons].map(([why, n]) => `${why} x${n}`).join(", "),
      });
    }
    return out;
  }
  const summaries = (raw: unknown[]) => mapRows(raw, toSummary);

  const published = (cols: string, opts?: { count?: "exact"; head?: boolean }) =>
    failFast(client.from(TABLE).select(cols, opts)).eq("status", STATUS);
  const newestFirst = (q: QueryLike) =>
    q.order("published_at", { ascending: false, nullsFirst: false }).order("created_at", { ascending: false });

  const retryDelayMs = options.retryDelayMs ?? 300;

  /**
   * Runs a call; one transient failure (502/503/504/520, TimeoutError, reset socket) is retried once
   * after a short wait. `fn` builds its queries from scratch on every invocation, because a PostgREST
   * builder cannot be awaited twice. postgrest-js retries are off (see failFast), so this is the only retry.
   */
  async function guard<T>(fn: () => PromiseLike<T> | T): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await fn();
      } catch (e) {
        const err = e instanceof RepositoryError ? e : fail(e);
        if (attempt > 0 || !isTransientDataError(err)) throw err;
        logData("data", "retrying once after transient error", {
          reason: explainDataError(err).reason,
          delay: `${retryDelayMs}ms`,
        });
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
      }
    }
  }

  type Filtered = (cols: string, opts?: { count?: "exact"; head?: boolean }) => QueryLike;

  function outOfRange(res: QueryResult): boolean {
    return res.error?.code === "PGRST103" || res.error?.status === 416 || (res.error !== null && res.status === 416);
  }

  async function pageOf(filtered: Filtered, page: number, pageSize: number): Promise<Page<ArticleSummary>> {
    const from = (page - 1) * pageSize;
    const res = await newestFirst(filtered(SUMMARY_COLS, { count: "exact" })).range(from, from + pageSize - 1);
    if (outOfRange(res)) {
      // Offset beyond the last row: PostgREST answers 416. Mirror the fixture repository
      // (empty page, real total) using a cheap count-only query with the same filters.
      const counted = await filtered("id", { count: "exact", head: true });
      if (counted.error) throw fail(errorOf(counted));
      return { items: [], total: counted.count ?? 0, page, pageSize };
    }
    const items = summaries(rows(res));
    // `total` is the server count, so it can exceed items.length when unmappable rows were skipped.
    return { items, total: res.count ?? items.length, page, pageSize };
  }

  return {
    getBySlug: (slug) =>
      guard(async () => {
        const res = await published(ARTICLE_COLS).eq("slug", slug).maybeSingle();
        // PGRST116 = "no row" from older clients using the object media type; slug is unique.
        if (res.error?.code === "PGRST116") return null;
        if (res.error) throw fail(errorOf(res));
        if (!res.data) return null;
        const article = mapRows([res.data], (r) => rowToArticle(r as SiteArticleRow));
        return article[0] ?? null;
      }),

    list: ({ category, page, pageSize }) =>
      guard(async () => {
        const p = normalizePaging(page, pageSize);
        const cat = category ? categoryBySlug(category) : undefined;
        if (category && !cat) return { items: [], total: 0, ...p };
        const filtered: Filtered = (cols, opts) => {
          const q = published(cols, opts);
          return cat ? q.eq("category", cat.nicheKey) : q;
        };
        return pageOf(filtered, p.page, p.pageSize);
      }),

    search: (query, { page, pageSize }) =>
      guard(async () => {
        const p = normalizePaging(page, pageSize);
        const text = cleanQuery(query);
        if (!text) return { items: [], total: 0, ...p };
        // The query is passed as a bound value; websearch syntax cannot alter the filter structure.
        // Results are newest first (supabase-js cannot order by ts_rank).
        const filtered: Filtered = (cols, opts) =>
          published(cols, opts).textSearch("search_tsv", text, { type: "websearch", config: "english" });
        return pageOf(filtered, p.page, p.pageSize);
      }),

    related: (article, limit) =>
      guard(async () => {
        if (!(limit >= 1)) return [];
        const n = Math.min(Math.floor(limit), 100);
        const nicheKey = categoryBySlug(article.category)?.nicheKey ?? article.category;
        const same = summaries(
          rows(await newestFirst(published(SUMMARY_COLS).eq("category", nicheKey).neq("id", article.id).neq("slug", article.slug)).limit(n)),
        );
        if (same.length >= n) return same.slice(0, n);
        const more = summaries(
          rows(await newestFirst(published(SUMMARY_COLS).neq("category", nicheKey).neq("id", article.id)).limit(n - same.length)),
        );
        return [...same, ...more];
      }),

    allSlugs: () =>
      guard(async () => {
        const res = await newestFirst(published(SLUG_COLS));
        // Only rows a page can render: an unknown category would list a URL that answers 404.
        return mapRows<{ slug: string; publishedAt: string }, SlugRow>(
          rows(res),
          (row) => {
            const at = row.published_at ?? row.created_at;
            const known = row.category ? categoryByNicheKey(row.category) : undefined;
            return row.slug && at && known ? { slug: row.slug, publishedAt: at } : null;
          },
          slugSkipReason,
        );
      }),
  };
}

type ShallowClient = { from(table: string): { select(columns: string, options?: { count?: "exact"; head?: boolean }): unknown } };

export const REQUEST_TIMEOUT_MS = 6000;

/** The network error code (ECONNREFUSED, ENOTFOUND, ...) hidden in a failed fetch's cause chain. */
function networkCode(err: unknown): string | undefined {
  let node: unknown = err;
  for (let depth = 0; depth < 4 && typeof node === "object" && node !== null; depth++) {
    const o = node as { code?: unknown; cause?: unknown; errors?: unknown };
    if (typeof o.code === "string" && /^[A-Z][A-Z0-9_]{2,40}$/.test(o.code)) return o.code;
    if (Array.isArray(o.errors) && o.errors.length > 0) {
      const inner = networkCode(o.errors[0]);
      if (inner) return inner;
    }
    node = o.cause;
  }
  return undefined;
}

/**
 * undici reports every connection problem as the bare "TypeError: fetch failed" and keeps the
 * reason in `cause`, which supabase-js drops. Naming the code in the message keeps the reason
 * (for example "Connection refused") readable in the data log.
 */
function withNetworkCode(err: unknown): unknown {
  const code = networkCode(err);
  if (!(err instanceof Error) || !code || err.message.includes(code)) return err;
  return new Error(`${err.name}: ${err.message} (${code})`, { cause: err });
}

/** Wraps fetch so every request aborts after `ms`, combined with any signal the caller supplied. */
export function withTimeout(base: typeof fetch, ms: number = REQUEST_TIMEOUT_MS): typeof fetch {
  return async (input, init) => {
    const timeout = AbortSignal.timeout(ms);
    const given = init?.signal;
    const signal = given ? (typeof AbortSignal.any === "function" ? AbortSignal.any([given, timeout]) : given) : timeout;
    try {
      return await base(input, { ...init, signal });
    } catch (error) {
      throw withNetworkCode(error);
    }
  };
}

/** The only place the supabase-js client is created. Anon key only, no session persistence. */
export function createSupabaseClient(url: string, anonKey: string, options: { timeoutMs?: number } = {}): SupabaseLike {
  const real = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: withTimeout((input, init) => fetch(input, init), options.timeoutMs ?? REQUEST_TIMEOUT_MS) },
  });
  // A full structural assignment of the real client to SupabaseLike makes tsc give up
  // (TS2589, builder generics are too deep). This shallow check still proves that
  // from(table).select(columns, { count }) exists on the real client; the chain methods
  // used by the repository (eq, neq, order, range, textSearch, limit, maybeSingle) are
  // exercised by the fake in tests and by the production build.
  const shallow: ShallowClient = real;
  return shallow as unknown as SupabaseLike;
}

export type { CategorySlug };
