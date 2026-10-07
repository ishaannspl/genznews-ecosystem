import { createHash } from "node:crypto";

/**
 * SQL literals for generated import scripts. Strings are always dollar-quoted with a tag that
 * provably does not occur in the value, so no character in the value (quote, backslash, `$`,
 * newline, psql meta-command) can end the literal or change the statement. Never `E'...'`.
 */

// NUL is not allowed in Postgres text; other C0 controls and DEL have no business in an article.
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

/** Removes NUL and control characters (keeps tab, LF, CR) and replaces lone surrogates with U+FFFD. */
export function cleanText(value: string): string {
  return value.replace(CONTROL, "").replace(LONE_SURROGATE, "�");
}

/** The i-th candidate tag, `$gz<12 hex>$`. Independent of the value, so output is deterministic. */
export function dollarTagCandidate(i: number): string {
  return `$gz${createHash("sha256").update(`genznews-dollar-tag:${i}`).digest("hex").slice(0, 12)}$`;
}

/**
 * `$gz…$value$gz…$`. A tag is accepted only when its first occurrence in `value + tag` is the
 * closing tag itself: that rules out a tag inside the value and a value ending in a tag prefix.
 */
export function dollarQuote(raw: string): string {
  const value = cleanText(raw);
  for (let i = 0; ; i++) {
    const tag = dollarTagCandidate(i);
    if ((value + tag).indexOf(tag) === value.length) return `${tag}${value}${tag}`;
  }
}

export function sqlNullableText(value: string | null | undefined): string {
  return value === null || value === undefined ? "null" : dollarQuote(value);
}

export function sqlTextArray(values: readonly string[]): string {
  if (values.length === 0) return "'{}'::text[]";
  return `array[${values.map(dollarQuote).join(", ")}]::text[]`;
}

/** Validates with `new Date` and emits the normalised UTC ISO form (only digits, `-:.TZ`). */
export function sqlTimestamptz(value: string): string {
  const d = new Date(value);
  if (!value || Number.isNaN(d.getTime())) throw new Error(`invalid timestamp: ${JSON.stringify(String(value).slice(0, 40))}`);
  return `'${d.toISOString()}'::timestamptz`;
}
