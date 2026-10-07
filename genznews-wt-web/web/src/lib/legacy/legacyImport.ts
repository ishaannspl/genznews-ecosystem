import { canonicalUrlHash } from "../canonicalUrl";
import { categoryByNicheKey } from "../categories";
import { hasDash, removeEmDashes, removeEmDashesPerLine } from "../removeEmDashes";
import { cleanUrl, importOutputMd, outputMdSourceUrl } from "../fixtures/importOutputMd";
import { legacyBodyMd, parseLegacyContent } from "./legacyContent";
import { cleanText, dollarQuote, sqlNullableText, sqlTextArray, sqlTimestamptz } from "./sqlLiteral";

/**
 * Builds `public.site_articles` inserts from the legacy `public.articles` rows.
 * Category and slug come only from a deterministic match (by canonical source URL hash) to the
 * pipeline's local `output/<niche_key>/*.md` files; unmatched rows are reported, never guessed.
 */

/** The legacy columns the export reads (original_content is deliberately not fetched). */
export interface LegacyRow {
  id: string | number;
  source_url: string | null;
  domain: string | null;
  genz_title: string | null;
  genz_content: string | null;
  genz_tags: string[] | null;
  status: string | null;
  created_at: string | null;
}
export const LEGACY_COLUMNS = "id,source_url,domain,genz_title,genz_content,genz_tags,status,created_at";

/** Every status the `site_articles` check constraint allows (0001_site_tables.sql). */
export const SITE_STATUSES = ["PROCESSING", "REVIEW_REQUIRED", "APPROVED", "PUBLISHED", "REJECTED", "FAILED", "ARCHIVED"] as const;
export type SiteStatus = (typeof SITE_STATUSES)[number];
/** The statuses an import may use. */
export const IMPORT_STATUSES = ["PUBLISHED", "REVIEW_REQUIRED"] as const;
export type ImportStatus = (typeof IMPORT_STATUSES)[number];

export const NO_MATCH_REASON = "no local output file matches this source URL, so no category";
export const LEGACY_FLAG = "LEGACY_IMPORT";
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SEO_TITLE_MAX = 70;
const REPORT_TITLE_MAX = 60;

export interface MdMatch {
  nicheKey: string;
  slug: string;
  title: string;
  seoDescription: string | null;
  path: string;
}
/** url_hash to every output file with that source URL, sorted by path. */
export type MdIndex = Map<string, MdMatch[]>;
export interface MdFile {
  /** `<niche_key>/<file>.md`, used for ordering and messages. */
  path: string;
  nicheKey: string;
  markdown: string;
}

export interface SiteInsert {
  legacyId: string;
  url_hash: string;
  slug: string;
  title: string;
  summary: string | null;
  body_md: string;
  category: string;
  tags: string[];
  seo_title: string;
  seo_description: string | null;
  source_url: string;
  source_domain: string;
  source_name: string;
  status: SiteStatus;
  flags: string[];
  published_at: string;
  created_at: string;
}

export interface SkippedRow {
  id: string;
  title: string;
  domain: string;
  reason: string;
}

export interface ImportPlan {
  rows: SiteInsert[];
  skipped: SkippedRow[];
  /** Exported rows per category niche key. */
  perCategory: Record<string, number>;
  /** Structural notes about exported rows (never article text). */
  notes: string[];
}

function byPath(a: MdFile, b: MdFile): number {
  return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
}

/** Indexes output files by `canonicalUrlHash` of their raw source URL. Files sharing a URL are all kept, in path order. */
export function buildMdIndex(files: readonly MdFile[]): { index: MdIndex; warnings: string[] } {
  const index: MdIndex = new Map();
  const warnings: string[] = [];
  for (const f of [...files].sort(byPath)) {
    if (!categoryByNicheKey(f.nicheKey)) {
      warnings.push(`${f.path}: directory '${f.nicheKey}' is not one of the five niche keys, ignored`);
      continue;
    }
    const article = importOutputMd(f.markdown, f.nicheKey);
    const rawUrl = outputMdSourceUrl(f.markdown);
    if (!article || !rawUrl) {
      warnings.push(`${f.path}: could not parse, ignored`);
      continue;
    }
    const hash = canonicalUrlHash(rawUrl);
    const match: MdMatch = { nicheKey: f.nicheKey, slug: article.slug, title: article.title, seoDescription: article.seoDescription, path: f.path };
    const existing = index.get(hash);
    if (existing) {
      warnings.push(`${f.path}: same source URL as ${existing[0].path} (the legacy row's title decides which is used)`);
      existing.push(match);
    } else {
      index.set(hash, [match]);
    }
  }
  return { index, warnings };
}

function oneLine(value: string | null | undefined): string {
  return cleanText(String(value ?? "")).replace(/\s+/g, " ").trim();
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

/** Trims to 70 characters at a word boundary (hard cut when the first word is longer). */
export function seoTitle(title: string): string {
  const t = oneLine(title);
  if (t.length <= SEO_TITLE_MAX) return t;
  const cut = t.slice(0, SEO_TITLE_MAX + 1);
  const space = cut.lastIndexOf(" ");
  return (space > 0 ? cut.slice(0, space) : t.slice(0, SEO_TITLE_MAX)).trim();
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** URL-safe, unique slugs in input order. A taken slug gets `-<id>` (then `-2`, `-3`... if needed). */
export function uniqueSlugs(items: readonly { id: string; slug: string }[]): string[] {
  const used = new Set<string>();
  return items.map(({ id, slug }) => {
    const idPart = slugify(id) || "row";
    const base = slugify(slug) || `legacy-${idPart}`;
    let candidate = used.has(base) ? `${base}-${idPart}` : base;
    for (let n = 2; used.has(candidate); n++) candidate = `${base}-${idPart}-${n}`;
    used.add(candidate);
    return candidate;
  });
}

function compareIds(a: string, b: string): number {
  const na = /^\d+$/.test(a) ? Number(a) : NaN;
  const nb = /^\d+$/.test(b) ? Number(b) : NaN;
  if (!Number.isNaN(na) && !Number.isNaN(nb) && na !== nb) return na - nb;
  return a < b ? -1 : a > b ? 1 : 0;
}

function cleanTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) return [];
  const out: string[] = [];
  for (const t of tags) {
    const v = oneLine(removeEmDashes(typeof t === "string" ? t : "")).replace(/^#+/, "").trim();
    if (v && !out.includes(v)) out.push(v);
  }
  return out;
}

function isImportStatus(value: string): value is ImportStatus {
  return (IMPORT_STATUSES as readonly string[]).includes(value);
}

export function buildImportPlan(rows: readonly LegacyRow[], index: MdIndex, opts: { status: ImportStatus }): ImportPlan {
  if (!isImportStatus(opts.status)) {
    throw new Error(`Unsupported import status '${String(opts.status)}'. Use one of: ${IMPORT_STATUSES.join(", ")}.`);
  }
  const sorted = [...rows].sort((a, b) => compareIds(String(a.id), String(b.id)));
  const skipped: SkippedRow[] = [];
  const notes: string[] = [];
  const pending: (Omit<SiteInsert, "slug"> & { mdSlug: string })[] = [];
  const seenHash = new Map<string, string>();

  for (const row of sorted) {
    const id = String(row.id);
    // Editorial rule (no em-dashes): the same cleanup as remove_em_dashes in app/ai_writer.py.
    const title = oneLine(removeEmDashes(row.genz_title ?? ""));
    const domain = oneLine(row.domain);
    const skip = (reason: string) => skipped.push({ id, title: truncate(title, REPORT_TITLE_MAX), domain, reason });

    if ((row.status ?? "") !== "done") {
      skip(`legacy status is '${oneLine(row.status) || "none"}', not 'done'`);
      continue;
    }
    const rawUrl = typeof row.source_url === "string" ? row.source_url.trim() : "";
    const url = rawUrl ? cleanUrl(rawUrl) : null;
    if (!url || !/^https?:$/.test(url.protocol)) {
      skip("invalid source URL");
      continue;
    }
    if (!title) {
      skip("missing genz_title");
      continue;
    }
    const createdMs = row.created_at ? new Date(row.created_at).getTime() : NaN;
    if (Number.isNaN(createdMs)) {
      skip("invalid created_at");
      continue;
    }
    const content = parseLegacyContent(row.genz_content);
    const body = removeEmDashesPerLine(legacyBodyMd(content));
    const hook = removeEmDashesPerLine(content.hook);
    if (!content.hook && !content.breakdown && !content.whyItMatters && content.tldr.length === 0) {
      skip("no usable genz_content");
      continue;
    }
    const hash = canonicalUrlHash(rawUrl);
    const candidates = index.get(hash) ?? [];
    if (candidates.length === 0) {
      skip(NO_MATCH_REASON);
      continue;
    }
    // Several output files for one URL: prefer the one whose title equals genz_title, else the first path.
    const byTitle = candidates.find((c) => oneLine(removeEmDashes(c.title)).toLowerCase() === title.toLowerCase());
    const match = byTitle ?? candidates[0];
    if (candidates.length > 1) {
      notes.push(
        `row ${id}: ${candidates.length} output files share this source URL; used ${match.path} (${byTitle ? "title match" : "first by path"})`,
      );
    }
    const firstId = seenHash.get(hash);
    if (firstId !== undefined) {
      skip(`same source URL as legacy row ${firstId}`);
      continue;
    }
    seenHash.set(hash, id);

    const missing: string[] = [];
    if (!content.hook) missing.push("no hook (summary is null)");
    if (content.tldr.length !== 3) missing.push(`${content.tldr.length} TL;DR bullets`);
    if (!content.breakdown) missing.push("no breakdown");
    if (!content.whyItMatters) missing.push("no why-it-matters");
    if (!content.attribution) missing.push("no attribution");
    if (missing.length > 0) notes.push(`row ${id}: ${missing.join(", ")}`);

    const at = new Date(createdMs).toISOString();
    pending.push({
      legacyId: id,
      mdSlug: match.slug,
      url_hash: hash,
      title,
      summary: oneLine(hook) ? cleanText(hook).trim() : null,
      body_md: cleanText(body),
      category: match.nicheKey,
      tags: cleanTags(row.genz_tags),
      seo_title: seoTitle(title),
      seo_description: match.seoDescription ? oneLine(removeEmDashes(match.seoDescription)) || null : null,
      source_url: url.toString(),
      source_domain: domain || url.hostname,
      source_name: url.hostname.replace(/^www\./i, ""),
      status: opts.status,
      flags: [LEGACY_FLAG],
      published_at: at,
      created_at: at,
    });
  }

  const slugs = uniqueSlugs(pending.map((p) => ({ id: p.legacyId, slug: p.mdSlug })));
  const out: SiteInsert[] = pending.map((p, i) => {
    const { mdSlug, ...rest } = p;
    void mdSlug;
    return { ...rest, slug: slugs[i] };
  });
  const perCategory: Record<string, number> = {};
  for (const r of out) perCategory[r.category] = (perCategory[r.category] ?? 0) + 1;
  return { rows: out, skipped, perCategory, notes };
}

const COLUMNS = [
  "url_hash",
  "slug",
  "title",
  "summary",
  "body_md",
  "category",
  "tags",
  "seo_title",
  "seo_description",
  "source_url",
  "source_domain",
  "source_name",
  "framework",
  "content_type",
  "image_url",
  "job_id",
  "status",
  "flags",
  "published_at",
  "created_at",
] as const;

/** Last line of defence for the editorial rule: no value with an em-dash or en-dash is written. */
function assertNoDashes(r: SiteInsert): void {
  for (const [column, value] of Object.entries(r)) {
    if (column === "legacyId") continue;
    const texts = Array.isArray(value) ? value : [value];
    if (texts.some((t) => typeof t === "string" && hasDash(t))) {
      throw new Error(`legacy row ${r.legacyId}: ${column} still contains an em-dash or en-dash`);
    }
  }
}

function valuesOf(r: SiteInsert): string[] {
  assertNoDashes(r);
  if (!(SITE_STATUSES as readonly string[]).includes(r.status)) throw new Error(`invalid status '${r.status}' for legacy row ${r.legacyId}`);
  if (!categoryByNicheKey(r.category)) throw new Error(`invalid category '${r.category}' for legacy row ${r.legacyId}`);
  if (!SLUG_PATTERN.test(r.slug)) throw new Error(`invalid slug for legacy row ${r.legacyId}`);
  if (!/^[0-9a-f]{64}$/.test(r.url_hash)) throw new Error(`invalid url_hash for legacy row ${r.legacyId}`);
  return [
    dollarQuote(r.url_hash),
    dollarQuote(r.slug),
    dollarQuote(r.title),
    sqlNullableText(r.summary),
    dollarQuote(r.body_md),
    dollarQuote(r.category),
    sqlTextArray(r.tags),
    dollarQuote(r.seo_title),
    sqlNullableText(r.seo_description),
    dollarQuote(r.source_url),
    dollarQuote(r.source_domain),
    dollarQuote(r.source_name),
    "null",
    "null",
    "null",
    "null",
    dollarQuote(r.status),
    sqlTextArray(r.flags),
    sqlTimestamptz(r.published_at),
    sqlTimestamptz(r.created_at),
  ];
}

/** `begin; insert ... on conflict do nothing; ... commit;` plus a read-only check query. Deterministic. */
export function renderImportSql(plan: ImportPlan): string {
  const rows = [...plan.rows].sort((a, b) => compareIds(a.legacyId, b.legacyId));
  const statuses = [...new Set(rows.map((r) => r.status))].sort();
  const cats = Object.keys(plan.perCategory)
    .sort()
    .map((k) => `${k} ${plan.perCategory[k]}`)
    .join(", ");
  const out: string[] = [
    "-- GenZNews: import of the legacy public.articles rows into public.site_articles.",
    "-- Generated by `npm run export:legacy-sql` (web/scripts/export-legacy-sql.ts). Do not edit by hand.",
    `-- Rows: ${rows.length}. Status: ${statuses.join(", ") || "none"}. Per category: ${cats || "none"}.`,
    "-- Needs public.site_articles (migrations 0001 and 0002).",
    "-- Safe to re-run: a row whose url_hash or slug already exists is left untouched (on conflict do nothing).",
    "",
    "begin;",
    "",
  ];
  for (const r of rows) {
    const values = valuesOf(r);
    if (/^[A-Za-z0-9_-]{1,64}$/.test(r.legacyId)) out.push(`-- legacy public.articles id ${r.legacyId}`);
    out.push(`insert into public.site_articles (${COLUMNS.join(", ")}) values (`);
    out.push(values.map((v, i) => `  ${v}${i < values.length - 1 ? "," : ""}`).join("\n"));
    out.push(") on conflict do nothing;", "");
  }
  out.push(
    "commit;",
    "",
    "-- Check: rows that came from this import, by status.",
    `select status, count(*) as rows from public.site_articles where ${dollarQuote(LEGACY_FLAG)} = any(flags) group by status order by status;`,
    "",
  );
  return out.join("\n");
}

/** One paste-able file: an explanatory header, the migrations verbatim, then the import. */
export function renderSetupSql(importSql: string, migrations: readonly { name: string; sql: string }[]): string {
  const header = [
    "-- GenZNews: one-time setup of the site tables plus the legacy articles import.",
    "-- Generated by `npm run export:legacy-sql` (web/scripts/export-legacy-sql.ts). Do not edit by hand.",
    "--",
    "-- How to apply: Supabase dashboard, SQL editor, New query, paste this whole file, Run.",
    "--",
    "-- Contents, in order:",
    ...migrations.map((m, i) => `--   ${i + 1}. web/supabase/migrations/${m.name} (verbatim)`),
    `--   ${migrations.length + 1}. the legacy import (the same statements as legacy-import.sql)`,
    "--",
    "-- Re-running: everything in this file is safe to run again (policies are dropped and recreated,",
    "-- the trigger is replaced, imported rows that already exist are left untouched). The file ends",
    "-- by asking the API to refresh its table cache.",
    "",
  ].join("\n");
  // Plain concatenation: the migrations and the import are embedded byte for byte.
  let out = `${header}\n`;
  for (const m of migrations) {
    out += `-- ===== ${m.name} =====\n\n${m.sql.endsWith("\n") ? m.sql : `${m.sql}\n`}\n`;
  }
  out += `-- ===== legacy import =====\n\n${importSql}`;
  return `${out}\n${RELOAD_NOTE}\n${RELOAD_SCHEMA}\n`;
}

export const RELOAD_SCHEMA = "notify pgrst, 'reload schema';";
const RELOAD_NOTE = "-- Ask the API (PostgREST) to refresh its table cache.";

/** diagnose.sql: refreshes the API's table cache, then shows which site tables exist. Deterministic. */
export function renderDiagnoseSql(): string {
  return [
    "-- GenZNews diagnostic: asks the API to refresh its table list, then shows which tables exist.",
    "-- Safe to run any number of times. It changes no data.",
    RELOAD_SCHEMA,
    "select",
    "  to_regclass('public.site_articles') as site_articles,",
    "  to_regclass('public.site_jobs')     as site_jobs,",
    "  to_regclass('public.admin_emails')  as admin_emails,",
    "  (select count(*) from public.articles) as legacy_articles_rows;",
    "",
  ].join("\n");
}
