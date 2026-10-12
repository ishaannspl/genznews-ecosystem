import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { logFailure, resetFailureDedupe, setLogSink } from "./dataLog";
import { logHomeError, logListError } from "./pageLog";
import { RepositoryError } from "./repository";

const SECRET_CAUSE = {
  message: "TypeError: fetch failed apikey=sb_secret_FAKEKEY123 Authorization: Bearer eyJabc.def.ghi",
  details: "getaddrinfo ENOTFOUND example-project.supabase.co",
};
const outage = () => new RepositoryError("Could not load stories.", { cause: SECRET_CAUSE });

describe("page-level failure lines are de-duplicated like data failures", () => {
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
    setLogSink(null);
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  test("test_home_render_failed_logs_once_per_window_at_warn_then_one_summary", () => {
    for (let i = 0; i < 5; i++) logHomeError(outage());
    expect(lines).toHaveLength(1);
    expect(lines[0].level).toBe("warn");
    expect(lines[0].line).toContain("home  render failed");
    expect(lines[0].line).toContain('reason="Host name not found (DNS lookup failed)"');
    vi.advanceTimersByTime(5000);
    expect(lines).toHaveLength(2);
    expect(lines[1].level).toBe("warn");
    expect(lines[1].line).toContain("home  ... 4 more page render(s) failed with the same reason in the last 5s");
    vi.advanceTimersByTime(20_000);
    expect(lines).toHaveLength(2);
    // A new window logs the line again.
    logHomeError(outage());
    expect(lines).toHaveLength(3);
  });

  test("test_list_error_lines_are_deduplicated_per_scope_at_warn", () => {
    logListError("latest");
    logListError("latest");
    logListError("category");
    logListError("latest");
    expect(lines.map((l) => [l.level, l.line.includes("error state shown")])).toEqual([
      ["warn", true],
      ["warn", true],
    ]);
    vi.advanceTimersByTime(5000);
    expect(lines).toHaveLength(3);
    expect(lines[2].line).toContain("latest  ... 2 more page render(s) failed");
  });

  test("test_first_data_failure_line_stays_at_error", () => {
    logFailure("data", "list failed", { reason: "Host name not found (DNS lookup failed)", code: "ENOTFOUND" });
    logHomeError(outage());
    expect(lines.map((l) => l.level)).toEqual(["error", "warn"]);
  });

  test("test_lines_and_summary_leak_no_secrets", () => {
    for (let i = 0; i < 3; i++) logHomeError(outage());
    vi.advanceTimersByTime(5000);
    const all = lines.map((l) => l.line).join("\n");
    expect(lines).toHaveLength(2);
    for (const secret of ["sb_secret", "FAKEKEY123", "eyJ", "Bearer", "apikey"]) expect(all, secret).not.toContain(secret);
  });
});
