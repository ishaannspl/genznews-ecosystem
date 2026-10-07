import { MAX_PAGE } from "./paging";

export const PAGE_SIZE = 12;
export const MAX_QUERY_LENGTH = 100;

type SearchParam = string | string[] | undefined;

function first(value: SearchParam): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

/**
 * A `?page=` value as a page number: a plain positive integer, else 1.
 * Clamped to the same cap as normalizePaging.
 */
export function parsePage(value: SearchParam): number {
  const raw = first(value).trim();
  if (!/^\d+$/.test(raw)) return 1;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(n, MAX_PAGE);
}

/** A `?q=` value: first value, trimmed, at most 100 characters. */
export function parseQuery(value: SearchParam): string {
  return first(value).trim().slice(0, MAX_QUERY_LENGTH).trim();
}
