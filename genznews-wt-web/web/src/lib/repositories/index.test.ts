import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { resetFailureDedupe, setLogSink } from "../dataLog";
import { getRepository, resetRepositoryForTests } from "./index";
import type { SupabaseLike } from "./supabaseRepository";

const FAKE_KEY = "sb_publishable_FAKEKEY123";
const FAKE_URL = "https://example-project.supabase.co";

type Result = { data: unknown; error: unknown; count?: number | null; status?: number };
let headResult: Result = { data: null, error: null, count: 12 };
let created: { url: string; key: string }[] = [];

vi.mock("./supabaseRepository", async (importActual) => {
  const actual = await importActual<typeof import("./supabaseRepository")>();
  return {
    ...actual,
    createSupabaseClient: (url: string, key: string): SupabaseLike => {
      created.push({ url, key });
      const chain = {
        eq: () => chain,
        limit: () => chain,
        then: (res: (v: Result) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(headResult).then(res, rej),
      };
      return { from: () => ({ select: () => chain }) } as unknown as SupabaseLike;
    },
  };
});

let lines: { level: string; line: string }[];
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  lines = [];
  created = [];
  headResult = { data: null, error: null, count: 12 };
  setLogSink((level, line) => lines.push({ level, line }));
  vi.stubEnv("DATA_LOG", "1");
  resetRepositoryForTests();
  resetFailureDedupe();
});
afterEach(() => {
  setLogSink(null);
  vi.unstubAllEnvs();
  resetRepositoryForTests();
});

function useSupabase() {
  vi.stubEnv("DATA_SOURCE", "supabase");
  vi.stubEnv("SUPABASE_URL", `${FAKE_URL}/rest/v1?apikey=zzz`);
  vi.stubEnv("SUPABASE_ANON_KEY", FAKE_KEY);
}

describe("getRepository with fixtures", () => {
  test("is memoized, fixture backed and warns loudly once", async () => {
    vi.stubEnv("DATA_SOURCE", "fixtures");
    const a = getRepository();
    expect(getRepository()).toBe(a);
    const page = await a.list({ page: 1, pageSize: 1 });
    expect(page.items.length).toBe(1);
    const banners = lines.filter((l) => l.line.includes("DEMO DATA"));
    expect(banners).toHaveLength(1);
    expect(banners[0].level).toBe("warn");
    expect(banners[0].line).toMatch(/DEMO DATA: serving 15 sample articles built from output\/\*\.md, NOT from the database \(DATA_SOURCE=fixtures\)/);
    expect(lines.some((l) => /DEMO list/.test(l.line))).toBe(true);
  });

  test("a missing DATA_SOURCE throws and says so on the console", () => {
    vi.stubEnv("DATA_SOURCE", "");
    expect(() => getRepository()).toThrow(/DATA_SOURCE/);
    expect(lines[0].level).toBe("error");
    expect(lines[0].line).toContain("DATA_SOURCE");
  });
});

describe("getRepository with supabase", () => {
  test("prints the banner once, with host only and never the key", async () => {
    useSupabase();
    getRepository();
    getRepository();
    await flush();
    const banners = lines.filter((l) => l.line.includes("source=supabase"));
    expect(banners).toHaveLength(1);
    const text = lines.map((l) => l.line).join("\n");
    expect(text).toContain("host=example-project.supabase.co");
    expect(text).toContain("table=public.site_articles");
    expect(text).toContain("fallback=none");
    expect(text).not.toContain("FAKEKEY123");
    expect(text).not.toContain("apikey");
    expect(text).not.toContain("/rest/v1");
    expect(created).toHaveLength(1);
  });

  test("banner is printed again only after the guard is cleared", async () => {
    useSupabase();
    getRepository();
    resetRepositoryForTests();
    getRepository();
    await flush();
    expect(lines.filter((l) => l.line.includes("source=supabase"))).toHaveLength(2);
  });

  test("a second evaluation of the module does not repeat the banner (globalThis guard)", async () => {
    useSupabase();
    getRepository();
    await flush();
    // A fresh module instance has its own (empty) log sink and cache, so it would print to the console.
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    vi.resetModules();
    const again = await import("./index");
    again.getRepository();
    await flush();
    expect(info).not.toHaveBeenCalled();
    info.mockRestore();
    expect(lines.filter((l) => l.line.includes("source=supabase"))).toHaveLength(1);
  });

  test("successful check logs the published row count without blocking", async () => {
    useSupabase();
    const repo = getRepository();
    expect(repo).toBeDefined();
    expect(lines.some((l) => l.line.includes("connected"))).toBe(false);
    await flush();
    expect(lines.some((l) => /connected: 12 published rows/.test(l.line) && l.level === "info")).toBe(true);
  });

  test("a failing check logs the explanation and never rejects", async () => {
    useSupabase();
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    headResult = {
      data: null,
      count: null,
      error: { message: `TypeError: fetch failed ${FAKE_KEY}`, details: "cause: Error: getaddrinfo ENOTFOUND example-project.supabase.co", hint: "", code: "" },
    };
    expect(() => getRepository()).not.toThrow();
    await flush();
    await flush();
    process.off("unhandledRejection", unhandled);
    const failed = lines.find((l) => l.line.includes("connection check failed"));
    expect(failed?.level).toBe("error");
    expect(failed?.line).toContain('reason="Host name not found (DNS lookup failed)"');
    expect(failed?.line).toContain("hint=");
    expect(failed?.line).toContain("code=ENOTFOUND");
    expect(lines.map((l) => l.line).join("\n")).not.toContain("FAKEKEY123");
    expect(unhandled).not.toHaveBeenCalled();
  });

  test("no connection check runs when logging is off", async () => {
    useSupabase();
    vi.stubEnv("DATA_LOG", "0");
    getRepository();
    await flush();
    expect(lines).toHaveLength(0);
  });

  test("a throwing sink and console do not break getRepository or the startup check", async () => {
    useSupabase();
    setLogSink(() => {
      throw new Error("sink boom");
    });
    headResult = { data: null, count: null, error: { message: "fetch failed", details: "ENOTFOUND x" } };
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    expect(() => getRepository()).not.toThrow();
    await flush();
    await flush();
    process.off("unhandledRejection", unhandled);
    expect(unhandled).not.toHaveBeenCalled();
  });
});
