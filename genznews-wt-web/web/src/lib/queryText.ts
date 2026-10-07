/** Env-free text helpers for search queries, shared by the repository and the data logs. */

export const MAX_QUERY = 100;

/**
 * One line of query text: control characters become spaces, runs of whitespace collapse,
 * and the result is trimmed and cut to `max` characters (trimmed again after the cut).
 */
export function cleanQuery(raw: string, max: number = MAX_QUERY): string {
  return raw
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max)
    .trim();
}
