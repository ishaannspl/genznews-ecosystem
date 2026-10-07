// @vitest-environment node
import { describe, expect, test } from "vitest";
import { canonicalUrlHash } from "../canonicalUrl";
import { parseAssembledBody } from "../articleBody";
import {
  buildImportPlan,
  buildMdIndex,
  renderImportSql,
  renderDiagnoseSql,
  renderSetupSql,
  seoTitle,
  uniqueSlugs,
  type LegacyRow,
} from "./legacyImport";

const CONTENT = `**The Hook**
A hook sentence.

**TL;DR (Quick Hits)**
- one
- two
- three

**The Breakdown**
Breakdown text.

**Why It Matters**
It matters.

---
*Sources: example.com. Synthesized and curated by GenZNews.*`;

function md(slug: string, url: string, meta = "A meta description."): string {
  return `# Title for ${slug}

**Niche:** Health Wellness
**Slug:** \`${slug}\`
**Meta Description:** *${meta}*
**Tags:** #a, #b
**Source URL:** [host](${url})
**Date Processed:** 2026-09-25T12:55:24.376620+00:00

---

## The Hook

Hook.

## TL;DR (Quick Hits)

- x

## The Breakdown

Body.

## Why It Matters

Why.

---

*Sources: host. Synthesized and curated by GenZNews.*
`;
}

function legacy(over: Partial<LegacyRow> = {}): LegacyRow {
  return {
    id: 1,
    source_url: "https://www.example.com/news/story-one?utm_source=rss&at_medium=RSS&id=7",
    domain: "www.example.com",
    genz_title: "  A   Gen Z\n title  ",
    genz_content: CONTENT,
    genz_tags: ["health", " #privacy ", "", "health"],
    status: "done",
    created_at: "2026-09-26T08:00:00.123456+00:00",
    ...over,
  };
}

const index = buildMdIndex([
  { path: "health_wellness/one.md", nicheKey: "health_wellness", markdown: md("story-one", "https://www.example.com/news/story-one?at_medium=RSS&id=7") },
  { path: "education_career/two.md", nicheKey: "education_career", markdown: md("story-two", "https://example.org/two") },
]).index;

describe("buildMdIndex", () => {
  test("keys by canonicalUrlHash of the md source URL and keeps the directory niche key", () => {
    const hit = index.get(canonicalUrlHash("https://www.example.com/news/story-one?id=7"))?.[0];
    expect(hit).toMatchObject({ nicheKey: "health_wellness", slug: "story-one", seoDescription: "A meta description." });
    expect(index.size).toBe(2);
  });

  test("unknown directories and unparsable files are reported, not indexed", () => {
    const r = buildMdIndex([
      { path: "sports/x.md", nicheKey: "sports", markdown: md("x", "https://a.com/x") },
      { path: "health_wellness/bad.md", nicheKey: "health_wellness", markdown: "nothing here" },
    ]);
    expect(r.index.size).toBe(0);
    expect(r.warnings).toHaveLength(2);
  });

  test("two md files for one source URL: both kept, sorted by path, and reported", () => {
    const files = [
      { path: "health_wellness/b.md", nicheKey: "health_wellness", markdown: md("bbb", "https://a.com/x") },
      { path: "education_career/a.md", nicheKey: "education_career", markdown: md("aaa", "https://a.com/x") },
    ];
    const one = buildMdIndex(files);
    const two = buildMdIndex([...files].reverse());
    expect(one.index.get(canonicalUrlHash("https://a.com/x"))?.map((m) => m.slug)).toEqual(["aaa", "bbb"]);
    expect(two.index.get(canonicalUrlHash("https://a.com/x"))?.map((m) => m.slug)).toEqual(["aaa", "bbb"]);
    expect(one.warnings.some((w) => w.includes("same source URL"))).toBe(true);
  });

  test("with several files for one URL the plan prefers the file whose title equals genz_title, else the first path", () => {
    const files = [
      { path: "health_wellness/a.md", nicheKey: "health_wellness", markdown: md("aaa", "https://a.com/x") },
      { path: "health_wellness/b.md", nicheKey: "health_wellness", markdown: md("bbb", "https://a.com/x") },
    ];
    const idx = buildMdIndex(files).index;
    const byTitle = buildImportPlan([legacy({ source_url: "https://a.com/x", genz_title: "Title for  bbb" })], idx, { status: "PUBLISHED" });
    expect(byTitle.rows[0].slug).toBe("bbb");
    expect(byTitle.notes.join("\n")).toContain("2 output files share this source URL; used health_wellness/b.md (title match)");
    const fallback = buildImportPlan([legacy({ source_url: "https://a.com/x", genz_title: "Other" })], idx, { status: "PUBLISHED" });
    expect(fallback.rows[0].slug).toBe("aaa");
    expect(fallback.notes.join("\n")).toContain("used health_wellness/a.md (first by path)");
  });
});

describe("buildImportPlan", () => {
  test("a matched row maps every column", () => {
    const plan = buildImportPlan([legacy()], index, { status: "PUBLISHED" });
    expect(plan.skipped).toEqual([]);
    expect(plan.rows).toHaveLength(1);
    const r = plan.rows[0];
    expect(r.url_hash).toBe(canonicalUrlHash(legacy().source_url!));
    expect(r.slug).toBe("story-one");
    expect(r.category).toBe("health_wellness");
    expect(r.title).toBe("A Gen Z title");
    expect(r.summary).toBe("A hook sentence.");
    expect(parseAssembledBody(r.body_md).tldr).toEqual(["one", "two", "three"]);
    expect(r.tags).toEqual(["health", "privacy"]);
    expect(r.source_url).toBe("https://www.example.com/news/story-one?id=7");
    expect(r.source_domain).toBe("www.example.com");
    expect(r.source_name).toBe("example.com");
    expect(r.status).toBe("PUBLISHED");
    expect(r.published_at).toBe("2026-09-26T08:00:00.123Z");
    expect(r.created_at).toBe(r.published_at);
    expect(r.flags).toEqual(["LEGACY_IMPORT"]);
    expect(r.seo_title).toBe("A Gen Z title");
    expect(r.seo_description).toBe("A meta description.");
    expect(plan.perCategory).toEqual({ health_wellness: 1 });
  });

  test("url_hash has parity with canonicalUrlHash (pipeline compute_url_hash)", () => {
    const url = "HTTPS://Example.COM/a/b/?b=2&a=1&fbclid=zz#frag";
    const plan = buildImportPlan(
      [legacy({ source_url: url })],
      buildMdIndex([{ path: "health_wellness/x.md", nicheKey: "health_wellness", markdown: md("x", "https://example.com/a/b?a=1&b=2") }]).index,
      { status: "PUBLISHED" },
    );
    expect(plan.rows[0].url_hash).toBe(canonicalUrlHash(url));
  });

  test("unmatched rows are excluded and reported with a truncated title", () => {
    const long = "T".repeat(80);
    const plan = buildImportPlan(
      [legacy(), legacy({ id: 2, source_url: "https://nowhere.example/x", domain: "nowhere.example", genz_title: long })],
      index,
      { status: "PUBLISHED" },
    );
    expect(plan.rows.map((r) => r.legacyId)).toEqual(["1"]);
    expect(plan.skipped).toEqual([
      {
        id: "2",
        title: `${"T".repeat(59)}…`,
        domain: "nowhere.example",
        reason: "no local output file matches this source URL, so no category",
      },
    ]);
  });

  test("other unusable rows are skipped with a reason and never throw", () => {
    const plan = buildImportPlan(
      [
        legacy({ id: 3, source_url: "not a url" }),
        legacy({ id: 4, genz_title: "   " }),
        legacy({ id: 5, created_at: "garbage" }),
        legacy({ id: 6, status: "failed" }),
        legacy({ id: 7, genz_content: "" }),
        legacy({ id: 8, source_url: null, domain: null, genz_title: null, genz_tags: null, created_at: null }),
      ],
      index,
      { status: "PUBLISHED" },
    );
    expect(plan.rows).toEqual([]);
    expect(plan.skipped.map((s) => [s.id, s.reason])).toEqual([
      ["3", "invalid source URL"],
      ["4", "missing genz_title"],
      ["5", "invalid created_at"],
      ["6", "legacy status is 'failed', not 'done'"],
      ["7", "no usable genz_content"],
      ["8", "invalid source URL"],
    ]);
  });

  test("a second row with the same source URL is reported, not exported twice", () => {
    const plan = buildImportPlan([legacy({ id: 9 }), legacy({ id: 1 })], index, { status: "PUBLISHED" });
    expect(plan.rows.map((r) => r.legacyId)).toEqual(["1"]);
    expect(plan.skipped).toEqual([expect.objectContaining({ id: "9", reason: "same source URL as legacy row 1" })]);
  });

  test("REVIEW_REQUIRED status is carried; anything else is refused", () => {
    expect(buildImportPlan([legacy()], index, { status: "REVIEW_REQUIRED" }).rows[0].status).toBe("REVIEW_REQUIRED");
    expect(() => buildImportPlan([legacy()], index, { status: "ARCHIVED" as never })).toThrow(/status/);
  });

  test("missing pieces degrade: no hook gives a null summary, no meta gives a null seo_description", () => {
    const idx = buildMdIndex([
      { path: "health_wellness/x.md", nicheKey: "health_wellness", markdown: md("x", "https://a.com/x", "") },
    ]).index;
    const plan = buildImportPlan(
      [legacy({ source_url: "https://a.com/x", genz_content: "Only a paragraph.", genz_tags: null })],
      idx,
      { status: "PUBLISHED" },
    );
    expect(plan.rows[0].summary).toBeNull();
    expect(plan.rows[0].seo_description).toBeNull();
    expect(plan.rows[0].tags).toEqual([]);
    expect(plan.rows[0].body_md).toBe("Only a paragraph.\n");
  });
});

describe("dash cleanup (editorial rule: no em-dashes)", () => {
  const DASHED = CONTENT.replace("A hook sentence.", "A hook\u2014Really.")
    .replace("- two", "- two \u2014 more")
    .replace("Breakdown text.", "Breakdown text\u2014it matters.\n\nSecond  para 2010\u20132020.")
    .replace("It matters.", "It matters \u2014 a lot.");

  test("title, summary, every body line, tags, seo fields are cleaned like remove_em_dashes; slug and structure kept", () => {
    const idx = buildMdIndex([
      { path: "health_wellness/x.md", nicheKey: "health_wellness", markdown: md("india-ai-quantum", "https://a.com/x", "Meta\u2014Desc here") },
    ]).index;
    const plan = buildImportPlan(
      [
        legacy({
          source_url: "https://a.com/x",
          genz_title: "India's Betting Big on AI and Quantum Tech\u2014Are You Ready?",
          genz_content: DASHED,
          genz_tags: ["ai\u2014quantum", "tech"],
        }),
      ],
      idx,
      { status: "PUBLISHED" },
    );
    const r = plan.rows[0];
    expect(r.title).toBe("India's Betting Big on AI and Quantum Tech: Are You Ready?");
    expect(r.seo_title).toBe("India's Betting Big on AI and Quantum Tech: Are You Ready?");
    expect(r.slug).toBe("india-ai-quantum");
    expect(r.summary).toBe("A hook: Really.");
    expect(r.tags).toEqual(["ai, quantum", "tech"]);
    expect(r.seo_description).toBe("Meta: Desc here");
    expect(r.body_md).toContain("- two - more\n");
    // A line with a dash gets the full Python treatment, so its double space collapses too.
    expect(r.body_md).toContain("Breakdown text, it matters.\n\nSecond para 2010 - 2020.");
    expect(r.body_md).toContain("## Why it matters\n\nIt matters - a lot.\n\n---\n\n*Sources:");
    expect(parseAssembledBody(r.body_md).tldr).toEqual(["one", "two - more", "three"]);
    for (const v of Object.values(r)) expect(JSON.stringify(v)).not.toMatch(/[\u2013\u2014]/);
  });

  test("text without dashes is unchanged by the cleanup", () => {
    const r = buildImportPlan([legacy()], index, { status: "PUBLISHED" }).rows[0];
    expect(r.title).toBe("A Gen Z title");
    expect(r.body_md).toBe(
      "**TL;DR**\n\n- one\n- two\n- three\n\nBreakdown text.\n\n## Why it matters\n\nIt matters.\n\n---\n\n*Sources: example.com. Synthesized and curated by GenZNews.*\n",
    );
  });

  test("renderImportSql refuses any value that still holds an em-dash or en-dash", () => {
    const p = buildImportPlan([legacy()], index, { status: "PUBLISHED" });
    for (const patch of [
      { title: "a\u2014b" },
      { body_md: "x\n\u2013\n" },
      { source_domain: "ex\u2013ample.com" },
      { tags: ["t\u2014"] },
      { seo_description: "\u2014" },
    ]) {
      expect(() => renderImportSql({ ...p, rows: [{ ...p.rows[0], ...patch }] })).toThrow(/em-dash or en-dash/);
    }
  });
});

describe("uniqueSlugs and seoTitle", () => {
  test("collisions get -<id>, invalid slugs are normalised, all match the URL-safe pattern", () => {
    const out = uniqueSlugs([
      { id: "1", slug: "same" },
      { id: "2", slug: "same" },
      { id: "3", slug: "Bad Slug!!_x" },
      { id: "4", slug: "" },
      { id: "5", slug: "same-2" },
      { id: "x y", slug: "same" },
    ]);
    expect(out).toEqual(["same", "same-2", "bad-slug-x", "legacy-4", "same-2-5", "same-x-y"]);
    for (const s of out) expect(s).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    expect(new Set(out).size).toBe(out.length);
  });

  test("seo title trims to 70 chars at a word boundary", () => {
    expect(seoTitle("short")).toBe("short");
    const t = "word ".repeat(20).trim();
    const s = seoTitle(t);
    expect(s.length).toBeLessThanOrEqual(70);
    expect(s.endsWith("word")).toBe(true);
    expect(seoTitle("x".repeat(90))).toBe("x".repeat(70));
  });
});

describe("renderImportSql", () => {
  const plan = () =>
    buildImportPlan(
      [
        legacy(),
        legacy({ id: 2, source_url: "https://example.org/two", domain: "example.org", genz_title: "It's \"two\" $$ \\ 🙂" }),
      ],
      index,
      { status: "PUBLISHED" },
    );

  test("one insert per row inside a transaction, with on conflict do nothing", () => {
    const sql = renderImportSql(plan());
    expect(sql).toMatch(/^-- /);
    expect(sql).toContain("\nbegin;\n");
    expect(sql).toContain("\ncommit;\n");
    expect(sql.match(/insert into public\.site_articles \(/g)).toHaveLength(2);
    expect(sql.match(/\) on conflict do nothing;/g)).toHaveLength(2);
    expect(sql).not.toMatch(/E'/);
    expect(sql).toContain("array[$gz");
    expect(sql).toContain("'2026-09-26T08:00:00.123Z'::timestamptz");
    expect(sql).toContain("array[$gz"); // flags
    expect(sql.indexOf("begin;")).toBeLessThan(sql.indexOf("insert into"));
    expect(sql.lastIndexOf("insert into")).toBeLessThan(sql.indexOf("commit;"));
  });

  test("deterministic: same input, same bytes, regardless of row order", () => {
    const a = renderImportSql(plan());
    const b = renderImportSql(plan());
    expect(a).toBe(b);
    const reversed = buildImportPlan(
      [
        legacy({ id: 2, source_url: "https://example.org/two", domain: "example.org", genz_title: "It's \"two\" $$ \\ 🙂" }),
        legacy(),
      ],
      index,
      { status: "PUBLISHED" },
    );
    expect(renderImportSql(reversed)).toBe(a);
  });

  test("an invalid status or category in a hand-built plan is refused", () => {
    const p = plan();
    expect(() => renderImportSql({ ...p, rows: [{ ...p.rows[0], status: "LIVE" as never }] })).toThrow(/status/);
    expect(() => renderImportSql({ ...p, rows: [{ ...p.rows[0], category: "sports" }] })).toThrow(/category/);
    expect(() => renderImportSql({ ...p, rows: [{ ...p.rows[0], slug: "Not Safe" }] })).toThrow(/slug/);
  });

  test("an empty plan still renders a valid (no-op) transaction", () => {
    const sql = renderImportSql({ rows: [], skipped: [], perCategory: {}, notes: [] });
    expect(sql).toContain("begin;\n");
    expect(sql).toContain("commit;\n");
    expect(sql).not.toContain("insert into");
  });
});

describe("renderSetupSql", () => {
  test("header, then each migration verbatim, then the import", () => {
    const out = renderSetupSql("-- import\nbegin;\ncommit;\n", [
      { name: "0001_site_tables.sql", sql: "create table a();\n" },
      { name: "0002_published_at_default.sql", sql: "create function b();\n" },
    ]);
    expect(out).toMatch(/^-- /);
    expect(out).toContain("SQL editor");
    expect(out).toContain("legacy-import.sql");
    const i1 = out.indexOf("create table a();\n");
    const i2 = out.indexOf("create function b();\n");
    const i3 = out.indexOf("-- import\nbegin;\ncommit;\n");
    expect(i1).toBeGreaterThan(0);
    expect(i2).toBeGreaterThan(i1);
    expect(i3).toBeGreaterThan(i2);
  });

  test("migration and import text are embedded byte for byte (blank-line runs are not collapsed)", () => {
    const importSql = "begin;\ninsert x values ($gz$a\n\n\n\n\nb$gz$);\ncommit;\n";
    const mig = "create table a();\n\n\n\n\n-- end\n";
    const out = renderSetupSql(importSql, [{ name: "0001_site_tables.sql", sql: mig }]);
    expect(out).toContain(mig);
    expect(out).toContain(importSql);
  });

  test("ends with the notify, after the check query; each migration appears exactly once", () => {
    const importSql = "begin;\ncommit;\n\n-- Check\nselect 1;\n";
    const out = renderSetupSql(importSql, [
      { name: "0001_site_tables.sql", sql: "create table a();\n" },
      { name: "0002_published_at_default.sql", sql: "create function b();\n" },
    ]);
    expect(out.endsWith("select 1;\n\n-- Ask the API (PostgREST) to refresh its table cache.\nnotify pgrst, 'reload schema';\n")).toBe(true);
    expect(out.split("create table a();\n").length - 1).toBe(1);
    expect(out.split("create function b();\n").length - 1).toBe(1);
    expect(out).not.toContain("NOT re-runnable");
    expect(out).toContain("safe to run again");
  });
});

describe("renderDiagnoseSql", () => {
  test("exact content, deterministic, no dashes", () => {
    const sql = renderDiagnoseSql();
    expect(sql).toBe(`-- GenZNews diagnostic: asks the API to refresh its table list, then shows which tables exist.
-- Safe to run any number of times. It changes no data.
notify pgrst, 'reload schema';
select
  to_regclass('public.site_articles') as site_articles,
  to_regclass('public.site_jobs')     as site_jobs,
  to_regclass('public.admin_emails')  as admin_emails,
  (select count(*) from public.articles) as legacy_articles_rows;
`);
    expect(renderDiagnoseSql()).toBe(sql);
    expect(sql).not.toMatch(/[\u2013\u2014]/);
  });
});
