import { describe, expect, test } from "vitest";
import { explainDataError, isTransientDataError } from "./explainError";

const FAKE_KEY = "sb_publishable_FAKEKEY123";
const FAKE_JWT = "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYW5vbiJ9.c2lnbmF0dXJlX2Zha2U";

const DNS_HINT = "The Supabase project address does not exist. Copy the Project URL from Supabase, Project Settings, API, into SUPABASE_URL.";
const KEY_HINT = "Check SUPABASE_ANON_KEY is the publishable (anon) key of the same project as SUPABASE_URL.";
const RLS_HINT = "Check the row level security policies from web/supabase/migrations/0001_site_tables.sql.";
const TIMEOUT_HINT = "Check SUPABASE_URL and that the Supabase project is not paused.";
const TABLE_HINT =
  "Run web/supabase/migrations/0001_site_tables.sql, then 0002_published_at_default.sql, in the Supabase SQL editor (or paste web/supabase/import/setup-and-import.sql, see the README).";

function withCause(message: string, cause: unknown): Error {
  return new Error(message, { cause });
}

const cases: [string, unknown, { reason: string; hint?: string; code?: string }][] = [
  ["ENOTFOUND in cause code", withCause("fetch failed", Object.assign(new Error("getaddrinfo ENOTFOUND abc.supabase.co"), { code: "ENOTFOUND" })), { reason: "Host name not found (DNS lookup failed)", hint: DNS_HINT, code: "ENOTFOUND" }],
  ["EAI_AGAIN", withCause("fetch failed", Object.assign(new Error("x"), { code: "EAI_AGAIN" })), { reason: "Host name not found (DNS lookup failed)", hint: DNS_HINT, code: "EAI_AGAIN" }],
  ["string-only details", { message: "TypeError: fetch failed", details: "TypeError: fetch failed\n cause: Error: getaddrinfo ENOTFOUND abc.supabase.co", hint: "", code: "" }, { reason: "Host name not found (DNS lookup failed)", hint: DNS_HINT, code: "ENOTFOUND" }],
  ["getaddrinfo substring only", "getaddrinfo something", { reason: "Host name not found (DNS lookup failed)", hint: DNS_HINT }],
  ["repository error wrapping supabase error", withCause("Could not load stories.", { message: "TypeError: fetch failed", details: "cause: Error: getaddrinfo ENOTFOUND abc.supabase.co" }), { reason: "Host name not found (DNS lookup failed)", hint: DNS_HINT, code: "ENOTFOUND" }],
  ["ECONNREFUSED", withCause("fetch failed", Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:9"), { code: "ECONNREFUSED" })), { reason: "Connection refused", code: "ECONNREFUSED" }],
  ["ETIMEDOUT", withCause("fetch failed", Object.assign(new Error("x"), { code: "ETIMEDOUT" })), { reason: "Connection timed out", hint: TIMEOUT_HINT, code: "ETIMEDOUT" }],
  ["UND_ERR_CONNECT_TIMEOUT", withCause("fetch failed", Object.assign(new Error("Connect Timeout Error"), { code: "UND_ERR_CONNECT_TIMEOUT" })), { reason: "Connection timed out", hint: TIMEOUT_HINT, code: "UND_ERR_CONNECT_TIMEOUT" }],
  ["AbortError timeout", Object.assign(new Error("The operation was aborted due to timeout"), { name: "AbortError" }), { reason: "Connection timed out", hint: TIMEOUT_HINT }],
  ["TimeoutError from AbortSignal.timeout", Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" }), { reason: "Connection timed out", hint: TIMEOUT_HINT }],
  ["supabase-wrapped timeout", { message: "TimeoutError: The operation was aborted due to timeout", details: "", hint: "", code: "" }, { reason: "Connection timed out", hint: TIMEOUT_HINT }],
  ["ECONNRESET", withCause("fetch failed", Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" })), { reason: "Connection reset by the server", code: "ECONNRESET" }],
  ["ECONNRESET in details", { message: "TypeError: fetch failed", details: "cause: Error: read ECONNRESET" }, { reason: "Connection reset by the server", code: "ECONNRESET" }],
  ["cert code", withCause("fetch failed", Object.assign(new Error("x"), { code: "CERT_HAS_EXPIRED" })), { reason: "TLS certificate problem", code: "CERT_HAS_EXPIRED" }],
  ["self signed text", { message: "fetch failed", details: "Error: SELF_SIGNED_CERT_IN_CHAIN" }, { reason: "TLS certificate problem" }],
  ["unable to verify", "UNABLE_TO_VERIFY_LEAF_SIGNATURE", { reason: "TLS certificate problem" }],
  ["status 401", { message: "Unauthorized", status: 401 }, { reason: "The key was rejected (401)", hint: KEY_HINT }],
  ["PGRST301", { message: "x", code: "PGRST301" }, { reason: "The key was rejected (401)", hint: KEY_HINT, code: "PGRST301" }],
  ["invalid api key", { message: "Invalid API key" }, { reason: "The key was rejected (401)", hint: KEY_HINT }],
  ["JWT text", { message: "JWT expired" }, { reason: "The key was rejected (401)", hint: KEY_HINT }],
  ["status 403", { message: "Forbidden", status: 403 }, { reason: "Not allowed to read this table (403)", hint: RLS_HINT }],
  ["42501", { message: "x", code: "42501" }, { reason: "Not allowed to read this table (403)", hint: RLS_HINT, code: "42501" }],
  ["permission denied", { message: "permission denied for table site_articles" }, { reason: "Not allowed to read this table (403)", hint: RLS_HINT }],
  ["row-level security", { message: "new row violates row-level security policy" }, { reason: "Not allowed to read this table (403)", hint: RLS_HINT }],
  ["status 404", { message: "Not Found", status: 404 }, { reason: "Table public.site_articles not found", hint: TABLE_HINT }],
  ["PGRST205", { message: "x", code: "PGRST205" }, { reason: "Table public.site_articles not found", hint: TABLE_HINT, code: "PGRST205" }],
  ["42P01", { message: "x", code: "42P01" }, { reason: "Table public.site_articles not found", hint: TABLE_HINT, code: "42P01" }],
  ["relation does not exist", { message: 'relation "public.site_articles" does not exist' }, { reason: "Table public.site_articles not found", hint: TABLE_HINT }],
  ["could not find the table", { message: "Could not find the table 'public.site_articles' in the schema cache" }, { reason: "Table public.site_articles not found", hint: TABLE_HINT }],
  ["PGRST103", { message: "Requested range not satisfiable", code: "PGRST103" }, { reason: "Requested page is beyond the last row", code: "PGRST103" }],
  ["status 503", { message: "Service Unavailable", status: 503 }, { reason: "Supabase returned a server error" }],
  ["status 500 on cause", withCause("Could not load stories.", { message: "boom", status: 500 }), { reason: "Supabase returned a server error" }],
];

describe("explainDataError", () => {
  test.each(cases)("%s", (_name, input, expected) => {
    const out = explainDataError(input);
    expect(out.reason).toBe(expected.reason);
    expect(out.hint).toBe(expected.hint);
    expect(out.code).toBe(expected.code);
  });

  test("unknown errors use the class name and no hint", () => {
    class WeirdError extends Error {}
    const out = explainDataError(new WeirdError("something odd"));
    expect(out.reason).toBe("Unexpected data error: WeirdError: something odd");
    expect(out.hint).toBeUndefined();
  });

  test("non-error values are handled", () => {
    expect(explainDataError(undefined).reason).toMatch(/^Unexpected data error/);
    expect(explainDataError(42).reason).toMatch(/^Unexpected data error/);
    expect(explainDataError(null).hint).toBeUndefined();
  });

  test("unexpected message is truncated", () => {
    const out = explainDataError(new Error("y".repeat(500)));
    expect(out.reason.length).toBeLessThan(200);
  });

  test("never outputs a key or JWT even if the message includes one", () => {
    const inputs = [
      new Error(`bad ${FAKE_KEY} and Bearer ${FAKE_JWT}`),
      { message: `${FAKE_JWT}`, details: `apikey=${FAKE_KEY}`, status: 418 },
      withCause("outer", new Error(`inner ${FAKE_KEY}`)),
      `Authorization: Bearer ${FAKE_JWT}`,
    ];
    for (const input of inputs) {
      const text = JSON.stringify(explainDataError(input));
      expect(text).not.toContain("FAKEKEY123");
      expect(text).not.toContain("eyJ");
    }
  });

  test("a cyclic cause chain terminates", () => {
    const a: Error & { cause?: unknown } = new Error("a");
    a.cause = a;
    expect(explainDataError(a).reason).toMatch(/^Unexpected data error/);
  });

  test("a secret-looking code or class name is never echoed", () => {
    const withCode = explainDataError(Object.assign(new Error("odd"), { code: "sb_publishable_ABCDEF123456" }));
    expect(withCode.code).toBe("[redacted]");
    class ErrSB_PUBLISHABLE_ABCDEF123456 extends Error {}
    const named = explainDataError(new ErrSB_PUBLISHABLE_ABCDEF123456("x"));
    expect(named.reason).not.toContain("ABCDEF123456");
    expect(named.reason).toContain("[redacted]");
  });

  test("plain object errors have no Object prefix", () => {
    expect(explainDataError({ message: "weird" }).reason).toBe("Unexpected data error: weird");
  });

  test("keys in multi-line stacks and nested cause strings are redacted", () => {
    const stack = `Error: boom\n    at fetch (x.js:1:1)\n    headers apikey: ${FAKE_KEY}\n    Bearer ${FAKE_JWT}`;
    const nested = { message: "outer", cause: { message: `inner "apikey":"plainvalue123" and x${FAKE_KEY}` } };
    for (const input of [Object.assign(new Error(stack), { stack }), new Error("o", { cause: nested })]) {
      const out = JSON.stringify(explainDataError(input));
      expect(out).not.toMatch(/FAKEKEY123|eyJ|plainvalue123/);
    }
  });
});

describe("isTransientDataError", () => {
  test.each<[string, unknown, boolean]>([
    ["502", { message: "x", status: 502 }, true],
    ["503", { message: "x", status: 503 }, true],
    ["504", { message: "x", status: 504 }, true],
    ["520", { message: "x", status: 520 }, true],
    ["500 is not retried", { message: "x", status: 500 }, false],
    ["TimeoutError name", Object.assign(new Error("aborted due to timeout"), { name: "TimeoutError" }), true],
    ["ECONNRESET code in cause", withCause("fetch failed", Object.assign(new Error("x"), { code: "ECONNRESET" })), true],
    ["UND_ERR_SOCKET in details", { message: "TypeError: fetch failed", details: "UND_ERR_SOCKET" }, true],
    ["wrapped RepositoryError", withCause("Could not load stories.", { message: "x", status: 503 }), true],
    ["ENOTFOUND", withCause("fetch failed", Object.assign(new Error("x"), { code: "ENOTFOUND" })), false],
    ["EAI_AGAIN", { message: "getaddrinfo EAI_AGAIN x" }, false],
    ["ECONNREFUSED", { message: "connect ECONNREFUSED" }, false],
    ["ETIMEDOUT", { message: "x", code: "ETIMEDOUT" }, false],
    ["401", { message: "x", status: 401 }, false],
    ["403", { message: "x", status: 403 }, false],
    ["404", { message: "x", status: 404 }, false],
    ["416", { message: "x", status: 416 }, false],
    ["PGRST205", { message: "x", code: "PGRST205" }, false],
    ["SQL code", { message: "x", code: "42P01" }, false],
    ["503 with PGRST code", { message: "x", code: "PGRST002", status: 503 }, false],
    ["string", "boom", false],
    ["undefined", undefined, false],
  ])("%s", (_n, input, expected) => {
    expect(isTransientDataError(input)).toBe(expected);
  });
});
