export const MAX_PAGE_SIZE = 100;
export const MAX_PAGE = 10000;

/** Shared paging sanitation: bad or fractional input never reaches a query. */
export function normalizePaging(page: number, pageSize: number): { page: number; pageSize: number } {
  const p = Number.isFinite(page) && page >= 1 ? Math.min(Math.floor(page), MAX_PAGE) : 1;
  const raw = Number.isNaN(pageSize) ? 1 : pageSize;
  const size = raw >= 1 ? Math.min(Math.floor(raw), MAX_PAGE_SIZE) : 1;
  return { page: p, pageSize: size };
}
