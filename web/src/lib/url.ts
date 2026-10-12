/**
 * URL checks shared by server and client code. Env-free and dependency-free on purpose:
 * client components import this module, so it must never pull in anything server-side.
 */

export const MAX_URL_LENGTH = 2048;

// Whitespace and control characters (C0, DEL, C1). `new URL` silently strips some of them
// (tabs, newlines, leading spaces), so a value containing any of them is refused outright.
const UNSAFE_CHARS = /[\s\u0000-\u001f\u007f-\u009f]/;

/**
 * True only for an absolute http(s) URL with a host. Rejects non-strings, empty values,
 * whitespace or control characters, relative and protocol-relative values, every other
 * scheme (javascript:, data:, vbscript:, mailto:, ...) and URLs longer than 2048 characters.
 */
export function isHttpUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_URL_LENGTH) return false;
  if (UNSAFE_CHARS.test(value)) return false;
  // An absolute URL starts with its scheme; this refuses "//host" and "/path" before parsing.
  if (!/^https?:\/\//i.test(value)) return false;
  try {
    const u = new URL(value);
    return (u.protocol === "http:" || u.protocol === "https:") && u.hostname.length > 0;
  } catch {
    return false;
  }
}

/** The value itself when it is a safe http(s) URL, otherwise null. */
export function safeHttpUrl(value: unknown): string | null {
  return isHttpUrl(value) ? value : null;
}
