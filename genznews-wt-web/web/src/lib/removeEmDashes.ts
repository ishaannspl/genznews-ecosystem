/**
 * TypeScript port of `remove_em_dashes` in app/ai_writer.py (the editorial rule: no em-dashes).
 * Same five steps in the same order:
 *   1. word char + dash + upper-case ASCII letter  -> ": "
 *   2. word char + dash + lower-case ASCII letter  -> ", "
 *   3. any remaining dash with surrounding whitespace -> " - "
 *   4. literal replacements: em-dash -> " - ", en-dash -> "-", " -- " -> " - "
 *   5. runs of 2+ spaces -> one space, then trim
 *
 * Differences from Python, none of which change the result for article text:
 * - "word char" is `[\p{L}\p{N}_]` (Unicode letters, numbers, underscore), which approximates
 *   Python 3's Unicode-aware `\w` (str.isalnum() or `_`); like Python it excludes combining marks.
 *   JS `\w` would be ASCII only and would treat `café\u2014ok` differently from Python.
 * - `\s` and `trim()` use JS's whitespace set; Python's `\s` and `strip()` differ only for rare
 *   control characters (U+001C..U+001F) and U+FEFF.
 * Env-free, never throws.
 */
export function removeEmDashes(text: string): string {
  if (!text) return text;
  let out = text.replace(/(?<=[\p{L}\p{N}_])[\u2014\u2013](?=[A-Z])/gu, ": ");
  out = out.replace(/(?<=[\p{L}\p{N}_])[\u2014\u2013](?=[a-z])/gu, ", ");
  out = out.replace(/\s*[\u2014\u2013]\s*/gu, " - ");
  out = out.replaceAll("\u2014", " - ").replaceAll("\u2013", "-").replaceAll(" -- ", " - ");
  out = out.replace(/ {2,}/g, " ");
  return out.trim();
}

const NEEDS_CLEANUP = /[\u2014\u2013]| -- /;

/**
 * For markdown bodies: applies `removeEmDashes` line by line, so blank lines and line breaks are
 * kept and a dash never joins two lines. Lines without a dash (or ` -- `) are left byte for byte;
 * a cleaned line keeps its leading indentation.
 */
export function removeEmDashesPerLine(text: string): string {
  if (!text) return text;
  return text
    .split("\n")
    .map((line) => {
      if (!NEEDS_CLEANUP.test(line)) return line;
      const indent = /^[ \t]*/.exec(line)![0];
      return indent + removeEmDashes(line.slice(indent.length));
    })
    .join("\n");
}

/** True when the text still holds an em-dash (U+2014) or an en-dash (U+2013). */
export function hasDash(text: string): boolean {
  return /[\u2014\u2013]/.test(text);
}
