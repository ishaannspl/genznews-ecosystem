// @vitest-environment node
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { canonicalUrlHash } from "../canonicalUrl";
import { getAll, getOnly, parseArgs, readMigrations, readOutputFiles, runExport, type ExportDeps } from "./exportLegacy";
import type { LegacyRow } from "./legacyImport";

const WEB = fileURLToPath(new URL("../../..", import.meta.url));
const FAKE_URL = "https://example-project.supabase.co";
const FAKE_KEY = "sb_publishable_FAKEKEY123";

const CONTENT = "**The Hook**\nHook.\n\n**TL;DR (Quick Hits)**\n- a\n- b\n- c\n\n**The Breakdown**\nB.\n\n**Why It Matters**\nW.\n\n---\n*Sources: x.*";

function md(slug: string, url: string): string {
  return `# T\n\n**Slug:** \`${slug}\`  \n**Meta Description:** *M.*  \n**Tags:** #a  \n**Source URL:** [h](${url})  \n**Date Processed:** 2026-09-25T12:55:24+00:00  \n\n## The Hook\n\nH.\n\n## TL;DR (Quick Hits)\n\n- x\n\n## The Breakdown\n\nB.\n\n## Why It Matters\n\nW.\n`;
}

function row(id: number, url: string): LegacyRow {
  return {
    id,
    source_url: url,
    domain: new URL(url).hostname,
    genz_title: `Title ${id}`,
    genz_content: CONTENT,
    genz_tags: ["t"],
    status: "done",
    created_at: "2026-09-27T10:00:00+00:00",
  };
}

type Call = { url: string; method: string; headers: Headers };

function fakeFetch(pages: LegacyRow[][], calls: Call[]): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    calls.push({ url, method: (init?.method ?? "GET").toUpperCase(), headers: new Headers(init?.headers) });
    const offset = Number(new URL(url).searchParams.get("offset") ?? "0");
    const page = pages[Math.floor(offset / 1000)] ?? [];
    return new Response(JSON.stringify(page), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
}

function deps(over: Partial<ExportDeps> = {}) {
  const calls: Call[] = [];
  const written: { path: string; content: string }[] = [];
  const made: string[] = [];
  const lines: string[] = [];
  const d: ExportDeps = {
    env: { SUPABASE_URL: `${FAKE_URL}/rest/v1?apikey=zzz`, SUPABASE_ANON_KEY: FAKE_KEY },
    loadEnvFile: () => {
      throw new Error("should not be called");
    },
    envFileExists: () => false,
    fetch: fakeFetch([[row(1, "https://a.com/one"), row(2, "https://b.com/two")]], calls),
    readOutputFiles: () => [{ path: "health_wellness/one.md", nicheKey: "health_wellness", markdown: md("one", "https://a.com/one") }],
    readMigrations: () => [
      { name: "0001_site_tables.sql", sql: "-- 0001\n" },
      { name: "0002_published_at_default.sql", sql: "-- 0002\n" },
    ],
    mkdir: (p) => made.push(p),
    writeFile: (path, content) => written.push({ path, content }),
    log: (l) => lines.push(l),
    webDir: "/web",
    ...over,
  };
  return { d, calls, written, made, lines };
}

describe("parseArgs", () => {
  test("defaults, flags and both --x v and --x=v forms", () => {
    expect(parseArgs([])).toEqual({ dryRun: false, status: "PUBLISHED", outDir: null, help: false });
    expect(parseArgs(["--dry-run", "--status", "REVIEW_REQUIRED", "--out", "tmp/x"])).toEqual({
      dryRun: true,
      status: "REVIEW_REQUIRED",
      outDir: "tmp/x",
      help: false,
    });
    expect(parseArgs(["--status=PUBLISHED", "--out=y"])).toMatchObject({ status: "PUBLISHED", outDir: "y" });
  });

  test("status validation and unknown arguments", () => {
    expect(() => parseArgs(["--status", "ARCHIVED"])).toThrow(/--status must be one of PUBLISHED, REVIEW_REQUIRED/);
    expect(() => parseArgs(["--status", "published"])).toThrow(/--status/);
    expect(() => parseArgs(["--status"])).toThrow(/--status needs a value/);
    expect(() => parseArgs(["--out"])).toThrow(/--out needs a value/);
    expect(() => parseArgs(["--yes"])).toThrow(/Unknown argument/);
  });
});

describe("network: GET only", () => {
  test("getOnly refuses any other method without touching the network", async () => {
    const calls: Call[] = [];
    const guarded = getOnly(fakeFetch([], calls));
    for (const method of ["POST", "PATCH", "PUT", "DELETE", "HEAD", "post"]) {
      await expect(guarded("https://x.example/rest/v1/articles", { method })).rejects.toThrow(/read only/);
    }
    expect(calls).toHaveLength(0);
    await guarded("https://x.example/rest/v1/articles");
    await guarded("https://x.example/rest/v1/articles", { method: "GET" });
    expect(calls.map((c) => c.method)).toEqual(["GET", "GET"]);
  });

  test("getAll paginates 1000 per page ordered by id with GET requests only", async () => {
    const calls: Call[] = [];
    const page1 = Array.from({ length: 1000 }, (_, i) => row(i + 1, `https://a.com/${i + 1}`));
    const page2 = [row(1001, "https://a.com/1001")];
    const rows = await getAll(FAKE_URL, FAKE_KEY, fakeFetch([page1, page2], calls));
    expect(rows).toHaveLength(1001);
    expect(calls).toHaveLength(2);
    expect(new Set(calls.map((c) => c.method))).toEqual(new Set(["GET"]));
    for (const [i, c] of calls.entries()) {
      const u = new URL(c.url);
      expect(u.origin + u.pathname).toBe(`${FAKE_URL}/rest/v1/articles`);
      expect(u.searchParams.get("order")).toBe("id.asc");
      expect(u.searchParams.get("limit")).toBe("1000");
      expect(u.searchParams.get("offset")).toBe(String(i * 1000));
      expect(u.searchParams.get("select")).not.toContain("original_content");
      expect(c.headers.get("apikey")).toBe(FAKE_KEY);
    }
  });

  test("an HTTP error is reported by status and code, never by key or URL", async () => {
    const bad = (async () =>
      new Response(JSON.stringify({ code: "PGRST205", message: `relation missing ${FAKE_KEY}` }), { status: 404 })) as unknown as typeof fetch;
    const err = (await getAll(FAKE_URL, FAKE_KEY, bad).catch((e: unknown) => e)) as Error;
    expect(err.message).toContain("HTTP 404");
    expect(err.message).toContain("PGRST205");
    expect(err.message).not.toContain("FAKEKEY123");
    expect(err.message).not.toContain("example-project");
  });

  test("runExport issues only GET requests to /rest/v1/articles", async () => {
    const { d, calls } = deps();
    expect(await runExport([], d)).toBe(0);
    expect(calls.length).toBeGreaterThan(0);
    for (const c of calls) {
      expect(c.method).toBe("GET");
      expect(new URL(c.url).pathname).toBe("/rest/v1/articles");
    }
  });
});

describe("runExport", () => {
  test("writes both files to <web>/supabase/import and prints a summary with the host only", async () => {
    const { d, written, made, lines } = deps();
    expect(await runExport([], d)).toBe(0);
    expect(made).toEqual([join("/web", "supabase", "import")]);
    expect(written.map((w) => w.path)).toEqual([
      join("/web", "supabase", "import", "legacy-import.sql"),
      join("/web", "supabase", "import", "setup-and-import.sql"),
      join("/web", "supabase", "import", "diagnose.sql"),
    ]);
    const [importSql, setup, diagnose] = written.map((w) => w.content);
    expect(setup).toContain(importSql);
    expect(setup.endsWith(`${importSql}\n-- Ask the API (PostgREST) to refresh its table cache.\nnotify pgrst, 'reload schema';\n`)).toBe(true);
    expect(diagnose).toContain("notify pgrst, 'reload schema';");
    expect(diagnose).toContain("to_regclass('public.site_articles')");
    expect(setup.indexOf("-- 0001\n")).toBeLessThan(setup.indexOf("-- 0002\n"));
    expect(importSql).toContain(canonicalUrlHash("https://a.com/one"));
    const out = lines.join("\n");
    expect(out).toContain("host: example-project.supabase.co");
    expect(out).toContain("rows read: 2");
    expect(out).toContain("rows exported: 1");
    expect(out).toContain("rows skipped: 1");
    expect(out).toContain("no local output file matches this source URL, so no category");
    expect(out).toContain("health_wellness: 1");
    expect(out).not.toContain("FAKEKEY123");
    expect(out).not.toContain("apikey");
    expect(out).not.toContain("/rest/v1");
    expect(out).not.toContain("Hook.");
  });

  test("--dry-run prints the summary and writes nothing", async () => {
    const { d, written, made, lines } = deps();
    expect(await runExport(["--dry-run"], d)).toBe(0);
    expect(written).toEqual([]);
    expect(made).toEqual([]);
    expect(lines.join("\n")).toContain("dry run: nothing written");
    expect(lines.join("\n")).toContain("rows exported: 1");
  });

  test("--out overrides the directory; --status REVIEW_REQUIRED is carried into the SQL", async () => {
    const { d, written } = deps();
    expect(await runExport(["--out", "/tmp/elsewhere", "--status", "REVIEW_REQUIRED"], d)).toBe(0);
    expect(written[0].path).toBe(join("/tmp/elsewhere", "legacy-import.sql"));
    expect(written[0].content).toContain("REVIEW_REQUIRED");
    expect(written[0].content).not.toMatch(/\$PUBLISHED\$/);
  });

  test("an invalid --status exits 2 before any network request", async () => {
    const { d, calls, written, lines } = deps();
    expect(await runExport(["--status", "LIVE"], d)).toBe(2);
    expect(calls).toHaveLength(0);
    expect(written).toHaveLength(0);
    expect(lines.join("\n")).toContain("--status must be one of");
  });

  test("missing env loads web/.env.local via loadEnvFile; still missing exits 2 naming the variable", async () => {
    const loaded: string[] = [];
    const env: Record<string, string | undefined> = {};
    const { d, calls, lines } = deps({
      env,
      envFileExists: () => true,
      loadEnvFile: (p) => {
        loaded.push(p);
        env.SUPABASE_URL = FAKE_URL;
      },
    });
    expect(await runExport([], d)).toBe(2);
    expect(loaded).toEqual([join("/web", ".env.local")]);
    expect(calls).toHaveLength(0);
    expect(lines.join("\n")).toContain("SUPABASE_ANON_KEY");
  });

  test("env from .env.local is enough to run", async () => {
    const env: Record<string, string | undefined> = {};
    const { d } = deps({
      env,
      envFileExists: () => true,
      loadEnvFile: () => {
        env.SUPABASE_URL = FAKE_URL;
        env.SUPABASE_ANON_KEY = FAKE_KEY;
      },
    });
    expect(await runExport(["--dry-run"], d)).toBe(0);
  });

  test("a network failure exits 1 with an explained reason, nothing written, no secrets", async () => {
    const failing = (async () => {
      throw new TypeError("fetch failed", { cause: Object.assign(new Error("getaddrinfo ENOTFOUND"), { code: "ENOTFOUND" }) });
    }) as unknown as typeof fetch;
    const { d, written, lines } = deps({ fetch: failing });
    expect(await runExport([], d)).toBe(1);
    expect(written).toHaveLength(0);
    const out = lines.join("\n");
    expect(out).toContain("Host name not found");
    expect(out).not.toContain("FAKEKEY123");
  });
});

describe("dash guard in runExport", () => {
  test("a value that still holds a dash after cleanup fails the export (exit 1), clearly, writing nothing", async () => {
    const dashed = { ...row(1, "https://a.com/one"), domain: "a\u2013b.com" };
    const calls: Call[] = [];
    const { d, written, made, lines } = deps({ fetch: fakeFetch([[dashed]], calls) });
    expect(await runExport([], d)).toBe(1);
    expect(written).toEqual([]);
    expect(made).toEqual([]);
    expect(lines.join("\n")).toMatch(/error: .*legacy row 1: source_domain still contains an em-dash or en-dash/);
  });
});

describe("real repository files", () => {
  test("all 15 output files are read and indexed, and both migrations are found in order", async () => {
    const files = readOutputFiles(join(WEB, "..", "output"));
    expect(files).toHaveLength(15);
    expect(new Set(files.map((f) => f.nicheKey)).size).toBe(5);
    const migs = readMigrations(join(WEB, "supabase", "migrations"));
    expect(migs.map((m) => m.name)).toEqual(["0001_site_tables.sql", "0002_published_at_default.sql"]);
  });
});
