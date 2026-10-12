/**
 * Server console logging for data decisions. One line per event, no colors.
 * Every message and field value goes through `redact`, and URLs are reduced to a hostname
 * with `hostOf`, so keys, tokens and query strings never reach the console.
 * Article bodies are never logged: callers pass slugs, ids, counts and truncated titles.
 */

export type LogLevel = "info" | "warn" | "error";
export type LogFields = Record<string, string | number | boolean | null | undefined>;
export type LogSink = (level: LogLevel, line: string) => void;

const MAX_VALUE = 120;
/** Cap for lines whose values are lists of slugs or fix hints; ordinary values stay at 120. */
export const LONG_VALUE = 400;
const ON = new Set(["1", "true", "on"]);
const OFF = new Set(["0", "false", "off"]);

let sink: LogSink | null = null;

/** Test hook: replaces the console output. Pass null to restore it. */
export function setLogSink(fn: LogSink | null): void {
  sink = fn;
}

/** DATA_LOG=1/true/on enables, 0/false/off disables; unset means on only in development. */
export function dataLogEnabled(env: Record<string, string | undefined> = process.env): boolean {
  const raw = env.DATA_LOG?.trim().toLowerCase();
  if (raw && ON.has(raw)) return true;
  if (raw && OFF.has(raw)) return false;
  return env.NODE_ENV === "development";
}

const SECRET_PATTERNS: RegExp[] = [
  // Header and JSON shapes: Authorization: ..., "authorization": "...", 'Authorization'='...'
  /authorization["']?\s*[:=][^\r\n]*/gi,
  /\bbearer\s+[\w.~+/=-]+/gi,
  // apikey, api-key, api_key, x-api-key as header, query, JSON or single-quoted object keys
  /(?:x-)?api[-_]?key["']?\s*[:=]\s*["']?[^\s&,;"'}]+/gi,
  // No leading word boundary on purpose: a key glued to other characters is still a key.
  /sb_(?:publishable|secret)_[\w-]+/gi,
  /eyJ[\w-]+\.[\w-]+\.[\w-]*/g,
];

/** Replaces anything that looks like a secret with [redacted]. */
export function redact(text: string): string {
  let out = text;
  for (const re of SECRET_PATTERNS) out = out.replace(re, "[redacted]");
  return out;
}

/** Hostname only (never path, query or credentials); `unknown-host` when the URL does not parse. */
export function hostOf(url: string): string {
  try {
    return new URL(url).hostname || "unknown-host";
  } catch {
    return "unknown-host";
  }
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function formatValue(value: string | number | boolean | null, max: number): string {
  if (typeof value !== "string") return String(value);
  const clean = truncate(redact(value).replace(/[\r\n\t]+/g, " "), max);
  // A value the caller already wrapped in double quotes (a search query) is kept as is.
  if (clean.length >= 2 && clean.startsWith('"') && clean.endsWith('"') && !clean.slice(1, -1).includes('"')) return clean;
  return clean === "" || /[\s"]/.test(clean) ? `"${clean.replace(/"/g, "'")}"` : clean;
}

function clock(now: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(now.getHours())}:${p(now.getMinutes())}:${p(now.getSeconds())}`;
}

export function logData(
  scope: string,
  message: string,
  fields?: LogFields,
  level: LogLevel = "info",
  maxValue: number = MAX_VALUE,
): void {
  // Logging must never break a request or mask the error being reported, so nothing escapes.
  try {
    if (!dataLogEnabled()) return;
    const pairs = fields
      ? Object.entries(fields).flatMap(([k, v]) =>
          v === undefined ? [] : [`${redact(k).replace(/\s+/g, "_")}=${formatValue(v, maxValue)}`],
        )
      : [];
    const head = `[genznews] ${clock(new Date())} ${redact(scope).replace(/\s+/g, "_")}  ${redact(message).replace(/[\r\n]+/g, " ")}`;
    const grouped = pairs.length ? `${head}  ${pairs.join(" ")}` : head;
    if (sink) sink(level, grouped);
    else if (level === "error") console.error(grouped);
    else if (level === "warn") console.warn(grouped);
    else console.info(grouped);
  } catch {
    // A throwing sink or console (for example EPIPE) is swallowed.
  }
}

const FAILURE_WINDOW_MS = 5000;
interface FailureWindow {
  scope: string;
  reason: string;
  /** What failed, for the summary line: "data call(s)" or "page render(s)". */
  what: string;
  start: number;
  suppressed: number;
  timer: ReturnType<typeof setTimeout> | undefined;
}
const failureWindows = new Map<string, FailureWindow>();

function flushFailureWindow(key: string): void {
  try {
    const w = failureWindows.get(key);
    if (!w) return;
    failureWindows.delete(key);
    if (w.timer !== undefined) clearTimeout(w.timer);
    if (w.suppressed > 0) {
      logData(
        w.scope,
        `... ${w.suppressed} more ${w.what} failed with the same reason in the last ${Math.round(FAILURE_WINDOW_MS / 1000)}s`,
        { reason: w.reason },
        "warn",
        LONG_VALUE,
      );
    }
  } catch {
    // never throws
  }
}

/** Test hook: forgets all failure windows without printing summaries. */
export function resetFailureDedupe(): void {
  for (const w of failureWindows.values()) if (w.timer !== undefined) clearTimeout(w.timer);
  failureWindows.clear();
}

/**
 * Logs a data layer failure line, but only the first identical failure (same scope, reason and code)
 * within 5 seconds. Later ones are counted and summarised once when the window closes.
 * Successes and decision lines use logData and are never suppressed. Never throws.
 */
export function logFailure(
  scope: string,
  message: string,
  fields: LogFields,
  maxValue: number = LONG_VALUE,
  options: { level?: LogLevel; what?: string } = {},
): void {
  try {
    if (!dataLogEnabled()) return;
    const key = `${scope}|${String(fields.reason)}|${String(fields.code)}`;
    const now = Date.now();
    const open = failureWindows.get(key);
    if (open && now - open.start < FAILURE_WINDOW_MS) {
      open.suppressed += 1;
      return;
    }
    if (open) flushFailureWindow(key);
    const timer = setTimeout(() => flushFailureWindow(key), FAILURE_WINDOW_MS);
    (timer as { unref?: () => void }).unref?.();
    const level = options.level ?? "error";
    const what = options.what ?? "data call(s)";
    failureWindows.set(key, { scope, reason: String(fields.reason), what, start: now, suppressed: 0, timer });
    logData(scope, message, fields, level, maxValue);
  } catch {
    // never throws
  }
}

export type DecisionScope = "home" | "latest" | "category" | "article" | "search";

/**
 * A page could not render its data because the data layer failed (already logged at error by the
 * data line). Logged at warn, since an unreachable database is an operator problem, not a crash,
 * and de-duplicated like data failures (scope, reason and code; 5 s window; one summary), so dev
 * re-renders and Fast Refresh do not repeat it. Never throws.
 */
export function logPageFailure(scope: DecisionScope, message: string, fields: LogFields): void {
  logFailure(scope, message, fields, LONG_VALUE, { level: "warn", what: "page render(s)" });
}

/** Thin helper for pages: one decision line under the page's own scope. */
export function logDecision(scope: DecisionScope, message: string, fields?: LogFields, level: LogLevel = "info"): void {
  // Decision lines carry lists of slugs, so their values get a larger cap than the 120 default.
  logData(scope, message, fields, level, LONG_VALUE);
}
