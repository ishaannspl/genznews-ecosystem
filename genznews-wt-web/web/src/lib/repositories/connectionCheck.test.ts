// @vitest-environment node
import { createClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { resetFailureDedupe, setLogSink } from "../dataLog";
import { runConnectionCheck } from "./index";
import { checkConnection, type SupabaseLike } from "./supabaseRepository";

// The startup connection check through the REAL supabase-js client with a fake fetch (no network).
// Regression: a HEAD probe lost the PostgREST error body, so a missing table logged
// "connected: 0 published rows".

const FAKE_KEY = "sb_publishable_FAKEKEY123";
type Seen = { method: string; url: URL; headers: Headers };
let seen: Seen[] = [];
let lines: { level: string; line: string }[] = [];

function client(respond: () => Response): SupabaseLike {
  const real = createClient("https://example-project.supabase.co", FAKE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
        const method = (init?.method ?? "GET").toUpperCase();
        seen.push({ method, url, headers: new Headers(init?.headers) });
        const res = respond();
        // Like a real server: a HEAD response carries the status and headers but never a body.
        return method === "HEAD" ? new Response(null, { status: res.status, headers: res.headers }) : res;
      }) as typeof fetch,
    },
  });
  return real as unknown as SupabaseLike;
}

const json = (body: unknown, status: number, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

const PGRST205 = {
  code: "PGRST205",
  details: null,
  hint: "Perhaps you meant the table 'public.articles'",
  message: "Could not find the table 'public.site_articles' in the schema cache",
};

beforeEach(() => {
  seen = [];
  lines = [];
  vi.stubEnv("DATA_LOG", "1");
  setLogSink((level, line) => lines.push({ level, line }));
  resetFailureDedupe();
});
afterEach(() => {
  setLogSink(null);
  vi.unstubAllEnvs();
  resetFailureDedupe();
});

const text = () => lines.map((l) => l.line).join("\n");

describe("startup connection check (real supabase-js client)", () => {
  test("404 PGRST205 (table missing) is a failure with the reason and the migration hint", async () => {
    await runConnectionCheck(client(() => json(PGRST205, 404)));
    expect(text()).not.toContain("connected:");
    expect(lines).toHaveLength(1);
    expect(lines[0].level).toBe("error");
    expect(lines[0].line).toContain("connection check failed");
    expect(lines[0].line).toContain('reason="Table public.site_articles not found"');
    expect(lines[0].line).toContain("0001_site_tables.sql");
    expect(lines[0].line).toContain("0002_published_at_default.sql");
    expect(lines[0].line).toContain("code=PGRST205");
    expect(text()).not.toContain("FAKEKEY123");
  });

  test("a 404 with an empty body (what a HEAD probe sees) is a failure, never 'connected'", async () => {
    await runConnectionCheck(client(() => new Response(null, { status: 404 })));
    expect(text()).not.toContain("connected:");
    expect(text()).toContain("connection check failed");
  });

  test.each([
    [401, { message: "Invalid API key" }, "The key was rejected (401)"],
    [403, { code: "42501", message: "permission denied for table site_articles" }, "Not allowed to read this table (403)"],
    [500, { message: "boom" }, "Supabase returned a server error"],
  ])("HTTP %i is a failure with its reason", async (status, body, reason) => {
    await runConnectionCheck(client(() => json(body, status)));
    expect(text()).not.toContain("connected:");
    expect(text()).toContain(`reason="${reason}"`);
  });

  test("200 with content-range 0-0/12 logs connected: 12 published rows", async () => {
    await runConnectionCheck(client(() => json([{ id: "a" }], 200, { "content-range": "0-0/12" })));
    expect(lines).toHaveLength(1);
    expect(lines[0].line).toContain("connected: 12 published rows");
  });

  test("200 with */0 logs connected: 0 published rows (the table answered ok)", async () => {
    await runConnectionCheck(client(() => json([], 200, { "content-range": "*/0" })));
    expect(lines[0].line).toContain("connected: 0 published rows");
  });

  test("an ok answer without a row count is a failure, not a guessed 0", async () => {
    await runConnectionCheck(client(() => json([], 200)));
    expect(text()).not.toContain("connected:");
    expect(text()).toContain("connection check failed");
  });

  test("the probe is one GET with limit=1, count=exact, status filter, and no retry", async () => {
    await runConnectionCheck(client(() => json({ message: "Service Unavailable" }, 503)));
    expect(seen).toHaveLength(1);
    const s = seen[0];
    expect(s.method).toBe("GET");
    expect(s.url.pathname).toBe("/rest/v1/site_articles");
    expect(s.url.searchParams.get("limit")).toBe("1");
    expect(s.url.searchParams.get("status")).toBe("eq.PUBLISHED");
    expect(s.url.searchParams.get("select")).toBe("id");
    expect(s.headers.get("prefer")).toContain("count=exact");
    expect(text()).toContain("connection check failed");
  });

  test("checkConnection rejects on the missing table instead of resolving 0 rows", async () => {
    await expect(checkConnection(client(() => json(PGRST205, 404)))).rejects.toMatchObject({ code: "PGRST205", status: 404 });
  });
});
