import { redact } from "./dataLog";

export interface ErrorExplanation {
  reason: string;
  hint?: string;
  code?: string;
}

const MAX_MESSAGE = 120;
const MAX_DEPTH = 8;

const HINTS = {
  dns: "The Supabase project address does not exist. Copy the Project URL from Supabase, Project Settings, API, into SUPABASE_URL.",
  key: "Check SUPABASE_ANON_KEY is the publishable (anon) key of the same project as SUPABASE_URL.",
  rls: "Check the row level security policies from web/supabase/migrations/0001_site_tables.sql.",
  table:
    "Run web/supabase/migrations/0001_site_tables.sql, then 0002_published_at_default.sql, in the Supabase SQL editor (or paste web/supabase/import/setup-and-import.sql, see the README).",
  timeout: "Check SUPABASE_URL and that the Supabase project is not paused.",
};

interface Collected {
  text: string;
  codes: string[];
  statuses: number[];
  first: unknown;
  firstName: string;
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/** Walks Error.cause, supabase error objects and plain strings, gathering text, codes and statuses. */
function collect(err: unknown): Collected {
  const out: Collected = { text: "", codes: [], statuses: [], first: err, firstName: "" };
  const seen = new Set<unknown>();
  const parts: string[] = [];
  let node: unknown = err;
  for (let depth = 0; depth < MAX_DEPTH && node !== undefined && node !== null; depth++) {
    if (typeof node === "string") {
      parts.push(node);
      break;
    }
    if (typeof node !== "object" || seen.has(node)) break;
    seen.add(node);
    const o = node as Record<string, unknown>;
    if (depth === 0) {
      const ctor = (node as object).constructor?.name;
      out.firstName = node instanceof Error && ctor && ctor !== "Object" ? ctor : str(o.name) || ctor || "Object";
    }
    for (const key of ["name", "message", "details", "hint", "code"]) parts.push(str(o[key]));
    const code = str(o.code).trim();
    if (code) out.codes.push(code);
    for (const key of ["status", "statusCode"]) if (typeof o[key] === "number") out.statuses.push(o[key]);
    node = o.cause;
  }
  out.text = parts.filter(Boolean).join("\n");
  return out;
}

function matchToken(text: string, tokens: string[]): string | undefined {
  return tokens.find((t) => text.includes(t));
}

function safeCode(code: string | undefined): string | undefined {
  if (!code) return undefined;
  if (code === "[redacted]") return code;
  // A code that looks like a secret is never echoed.
  if (redact(code) !== code) return "[redacted]";
  return /^[A-Za-z0-9_]{1,40}$/.test(code) ? code : undefined;
}

/**
 * True for failures worth one quick retry: HTTP 502/503/504/520, a TimeoutError, or a reset socket.
 * Never for DNS failures, refused connections, other 4xx, or PostgREST/SQL error codes.
 */
export function isTransientDataError(err: unknown): boolean {
  const c = collect(err);
  const upper = c.text.toUpperCase();
  if (matchToken(upper, ["ENOTFOUND", "EAI_AGAIN", "ECONNREFUSED"]) || upper.includes("GETADDRINFO")) return false;
  if (c.statuses.some((s) => s >= 400 && s < 500)) return false;
  if (c.codes.some((code) => /^(PGRST|\d{5}$)/i.test(code) && !/^(ECONN|UND_ERR)/i.test(code))) return false;
  if (c.statuses.some((s) => [502, 503, 504, 520].includes(s))) return true;
  return upper.includes("TIMEOUTERROR") || matchToken(upper, ["ECONNRESET", "UND_ERR_SOCKET"]) !== undefined;
}

/** Turns any data layer failure into a short reason and, when known, a fix hint. Never includes secrets. */
export function explainDataError(err: unknown): ErrorExplanation {
  const c = collect(err);
  const upper = c.text.toUpperCase();
  const lower = c.text.toLowerCase();
  const structured = safeCode(c.codes[0]);
  const has = (code: string) => c.codes.some((x) => x.toUpperCase() === code);
  const done = (reason: string, hint?: string, code?: string): ErrorExplanation => {
    const result: ErrorExplanation = { reason };
    if (hint) result.hint = hint;
    const finalCode = safeCode(code);
    if (finalCode) result.code = finalCode;
    return result;
  };

  const dnsToken = matchToken(upper, ["ENOTFOUND", "EAI_AGAIN"]);
  if (dnsToken || upper.includes("GETADDRINFO")) {
    return done("Host name not found (DNS lookup failed)", HINTS.dns, structured ?? dnsToken);
  }
  if (upper.includes("ECONNREFUSED")) return done("Connection refused", undefined, structured ?? "ECONNREFUSED");
  const resetToken = matchToken(upper, ["ECONNRESET", "UND_ERR_SOCKET"]);
  if (resetToken) return done("Connection reset by the server", undefined, structured ?? resetToken);
  const timeoutToken = matchToken(upper, ["ETIMEDOUT", "UND_ERR_CONNECT_TIMEOUT"]);
  const abortTimeout =
    upper.includes("TIMEOUTERROR") || (upper.includes("ABORTERROR") && /timeout|timed out/i.test(c.text));
  if (timeoutToken || abortTimeout) {
    return done("Connection timed out", HINTS.timeout, structured ?? timeoutToken);
  }
  if (/CERT_|SELF_SIGNED|UNABLE_TO_VERIFY/.test(upper)) return done("TLS certificate problem", undefined, structured);

  if (has("PGRST103") || upper.includes("PGRST103")) {
    return done("Requested page is beyond the last row", undefined, "PGRST103");
  }
  if (c.statuses.includes(401) || has("PGRST301") || lower.includes("invalid api key") || /\bjwt\b/i.test(c.text)) {
    return done("The key was rejected (401)", HINTS.key, structured);
  }
  if (
    c.statuses.includes(403) ||
    has("42501") ||
    lower.includes("permission denied") ||
    lower.includes("row-level security") ||
    lower.includes("row level security")
  ) {
    return done("Not allowed to read this table (403)", HINTS.rls, structured);
  }
  if (
    c.statuses.includes(404) ||
    has("PGRST205") ||
    has("42P01") ||
    /relation .* does not exist/i.test(c.text) ||
    lower.includes("could not find the table")
  ) {
    return done("Table public.site_articles not found", HINTS.table, structured);
  }
  if (c.statuses.some((s) => s >= 500 && s <= 599)) return done("Supabase returned a server error", undefined, structured);

  const message = redact(typeof err === "string" ? err : str((err as { message?: unknown } | null)?.message))
    .replace(/\s+/g, " ")
    .trim();
  const name = typeof err === "string" ? "string" : err === undefined || err === null ? String(err) : redact(c.firstName);
  const detail = name === "Object" && message ? message : message ? `${name}: ${message}` : name;
  const clipped = detail.length > MAX_MESSAGE ? `${detail.slice(0, MAX_MESSAGE - 1)}…` : detail;
  return done(`Unexpected data error: ${clipped}`, undefined, structured);
}
