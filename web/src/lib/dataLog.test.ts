import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { dataLogEnabled, hostOf, logData, logFailure, redact, resetFailureDedupe, setLogSink } from "./dataLog";

const FAKE_KEY = "sb_publishable_FAKEKEY123";
const FAKE_JWT = "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYW5vbiJ9.c2lnbmF0dXJlX2Zha2U";

afterEach(() => setLogSink(null));

describe("dataLogEnabled", () => {
  test.each([
    [{ DATA_LOG: "1" }, true],
    [{ DATA_LOG: "true" }, true],
    [{ DATA_LOG: "on" }, true],
    [{ DATA_LOG: "0" }, false],
    [{ DATA_LOG: "false" }, false],
    [{ DATA_LOG: "off" }, false],
    [{ DATA_LOG: "0", NODE_ENV: "development" }, false],
    [{ DATA_LOG: "1", NODE_ENV: "production" }, true],
    [{ NODE_ENV: "development" }, true],
    [{ NODE_ENV: "production" }, false],
    [{ NODE_ENV: "test" }, false],
    [{}, false],
  ])("%j -> %s", (env, expected) => {
    expect(dataLogEnabled(env)).toBe(expected);
  });
});

describe("logData", () => {
  function capture() {
    const lines: { level: string; line: string }[] = [];
    setLogSink((level, line) => lines.push({ level, line }));
    return lines;
  }

  test("formats one line with scope, message and fields", () => {
    vi.stubEnv("DATA_LOG", "1");
    const lines = capture();
    logData("data", "list", { page: 2, ok: true, none: null, skip: undefined, q: "two words" });
    vi.unstubAllEnvs();
    expect(lines).toHaveLength(1);
    expect(lines[0].level).toBe("info");
    expect(lines[0].line).toMatch(/^\[genznews\] \d{2}:\d{2}:\d{2} data {2}list {2}page=2 ok=true none=null q="two words"$/);
    expect(lines[0].line).not.toContain("skip");
    expect(lines[0].line).not.toContain("\n");
  });

  test("levels, truncation and no ANSI", () => {
    vi.stubEnv("DATA_LOG", "1");
    const lines = capture();
    logData("data", "boom", { long: "x".repeat(300) }, "error");
    vi.unstubAllEnvs();
    expect(lines[0].level).toBe("error");
    expect(lines[0].line).not.toMatch(/\u001b/);
    expect(lines[0].line.length).toBeLessThan(200);
  });

  test("prints nothing when disabled", () => {
    vi.stubEnv("DATA_LOG", "0");
    const lines = capture();
    logData("data", "hidden");
    vi.unstubAllEnvs();
    expect(lines).toHaveLength(0);
  });

  test("redacts secrets in message and fields", () => {
    vi.stubEnv("DATA_LOG", "1");
    const lines = capture();
    logData("data", `failed with ${FAKE_KEY}`, { auth: `Bearer ${FAKE_JWT}` });
    vi.unstubAllEnvs();
    expect(lines[0].line).not.toContain("FAKEKEY123");
    expect(lines[0].line).not.toContain("eyJ");
    expect(lines[0].line).toContain("[redacted]");
  });

  test("writes to console when no sink is set", () => {
    vi.stubEnv("DATA_LOG", "1");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    logData("data", "careful", undefined, "warn");
    vi.unstubAllEnvs();
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});

describe("redact", () => {
  test.each([
    [`key ${FAKE_KEY} here`],
    ["sb_secret_ABCDEF123456"],
    [`token ${FAKE_JWT}`],
    [`Authorization: Bearer ${FAKE_KEY}`],
    ["Authorization: Basic abc123"],
    ["apikey=abc123def"],
    ["apikey: abc123def"],
    ["Bearer abc.def-ghi"],
  ])("removes secrets from %s", (text) => {
    const out = redact(text);
    expect(out).toContain("[redacted]");
    expect(out).not.toMatch(/FAKEKEY123|eyJ|ABCDEF123456|abc123|abc\.def/);
  });

  test("leaves ordinary text alone", () => {
    expect(redact("category=health-wellness page=2")).toBe("category=health-wellness page=2");
  });
});

describe("hostOf", () => {
  test("returns only the hostname", () => {
    expect(hostOf("https://example-project.supabase.co/rest/v1/x?apikey=abc&select=1")).toBe("example-project.supabase.co");
    expect(hostOf("not a url")).toBe("unknown-host");
  });
});

describe("redact shapes", () => {
  test.each([
    ["key glued after letters", "xsb_publishable_ABCDEF123456"],
    ["key after an underscore prefix", "pre_sb_publishable_ABCDEF123456"],
    ["jwt glued to a letter", "aeyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYW5vbiJ9.c2ln"],
    ["upper case publishable", "SB_PUBLISHABLE_ABCDEF123456"],
    ["mixed case secret", "Sb_Secret_ABCDEF123456"],
    ["json apikey", '{"apikey":"plainvalue123"}'],
    ["single quoted apikey", "{'apikey': 'plainvalue123'}"],
    ["x-api-key header", "x-api-key: plainvalue123"],
    ["api_key query", "api_key=plainvalue123"],
    ["api-key upper", "API-KEY: plainvalue123"],
    ["json authorization", '{"authorization": "Basic plainvalue123"}'],
    ["upper bearer", "BEARER plainvalue123"],
  ])("%s", (_name, input) => {
    const out = redact(input);
    expect(out).toContain("[redacted]");
    expect(out).not.toMatch(/ABCDEF123456|plainvalue123|eyJ/);
  });

  test("keys inside multi-line stacks and nested strings are redacted", () => {
    const stack = ["Error: boom", "    at a (x.js:1:1)", "    apikey=sb_publishable_ABCDEF123456&x=1", "  cause: Error: Bearer plainvalue123 failed"].join("\n");
    expect(redact(stack)).not.toMatch(/ABCDEF123456|plainvalue123/);
    expect(redact(stack)).toContain("    at a (x.js:1:1)");
  });
});

describe("logData safety", () => {
  test("scope and field keys are redacted too", () => {
    vi.stubEnv("DATA_LOG", "1");
    const lines: string[] = [];
    setLogSink((_l, line) => lines.push(line));
    logData("sc sb_publishable_ABCDEF123456", "m", { "key<sb_publishable_ABCDEF123456>": 1 });
    vi.unstubAllEnvs();
    expect(lines[0]).not.toContain("ABCDEF123456");
    expect(lines[0]).toContain("[redacted]");
  });

  test("a throwing sink never throws out of logData", () => {
    vi.stubEnv("DATA_LOG", "1");
    setLogSink(() => {
      throw new Error("sink boom");
    });
    expect(() => logData("data", "x")).not.toThrow();
    vi.unstubAllEnvs();
  });

  test("a throwing console never throws out of logData", () => {
    vi.stubEnv("DATA_LOG", "1");
    const spies = (["info", "warn", "error"] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => {
        throw new Error("EPIPE");
      }),
    );
    expect(() => {
      logData("data", "x");
      logData("data", "x", undefined, "warn");
      logData("data", "x", undefined, "error");
    }).not.toThrow();
    spies.forEach((s) => s.mockRestore());
    vi.unstubAllEnvs();
  });
});

describe("logFailure dedupe", () => {
  let lines: { level: string; line: string }[];
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubEnv("DATA_LOG", "1");
    resetFailureDedupe();
    lines = [];
    setLogSink((level, line) => lines.push({ level, line }));
  });
  afterEach(() => {
    resetFailureDedupe();
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  const fail = (extra: Record<string, string | number> = {}) =>
    logFailure("data", "list failed", { reason: "Host name not found", code: "ENOTFOUND", ...extra });

  test("only the first identical failure is printed, then one summary when the window closes", () => {
    fail({ category: "a", duration: "1ms" });
    fail({ category: "b", duration: "2ms" });
    fail({ category: "c", duration: "3ms" });
    expect(lines).toHaveLength(1);
    expect(lines[0].level).toBe("error");
    vi.advanceTimersByTime(5000);
    expect(lines).toHaveLength(2);
    expect(lines[1].line).toContain("... 2 more data call(s) failed with the same reason in the last 5s");
    vi.advanceTimersByTime(20000);
    expect(lines).toHaveLength(2);
  });

  test("no summary when nothing was suppressed, and a new window prints again", () => {
    fail();
    vi.advanceTimersByTime(5000);
    expect(lines).toHaveLength(1);
    fail();
    expect(lines).toHaveLength(2);
  });

  test("a different reason is not suppressed and successes never are", () => {
    fail();
    logFailure("data", "list failed", { reason: "The key was rejected (401)" });
    logData("data", "list", { rows: 1 });
    logData("data", "list", { rows: 1 });
    expect(lines).toHaveLength(4);
  });

  test("a throwing sink cannot break the dedupe", () => {
    setLogSink(() => {
      throw new Error("boom");
    });
    expect(() => {
      fail();
      fail();
      vi.advanceTimersByTime(5000);
    }).not.toThrow();
  });
});
