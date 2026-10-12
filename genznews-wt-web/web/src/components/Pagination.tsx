import Link from "next/link";
import { Fragment } from "react";

type Params = Record<string, string | string[] | undefined>;

interface Props {
  page: number;
  total: number;
  pageSize: number;
  basePath: string;
  params: Params;
}

/** Keeps every other query param; page 1 drops `page` so it matches the canonical URL. */
function hrefFor(basePath: string, params: Params, page: number): string {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (key === "page" || value === undefined) continue;
    for (const v of Array.isArray(value) ? value : [value]) qs.append(key, v);
  }
  if (page > 1) qs.set("page", String(page));
  const s = qs.toString();
  return s ? `${basePath}?${s}` : basePath;
}

const boxClass =
  "inline-flex h-11 min-w-11 items-center justify-center border border-rule px-3 font-display text-base font-bold";
const linkClass = `${boxClass} hover:border-ink`;
const currentClass = `${boxClass} border-ink bg-ink text-paper`;

/** 1 2 3 4 5 … 12 near the start, 1 … 8 9 10 11 12 near the end, 1 … 5 6 7 … 12 between. */
function pageItems(current: number, pages: number): (number | "gap-start" | "gap-end")[] {
  if (pages <= 7) return Array.from({ length: pages }, (_, i) => i + 1);
  if (current <= 4) return [1, 2, 3, 4, 5, "gap-end", pages];
  if (current >= pages - 3) return [1, "gap-start", pages - 4, pages - 3, pages - 2, pages - 1, pages];
  return [1, "gap-start", current - 1, current, current + 1, "gap-end", pages];
}

/**
 * Numbered pages with Prev/Next, e.g. 1 2 3 4 5 … 12 Next. Renders nothing for a single page.
 * A page past the end (with stories before it) highlights no number and says so; every number still links.
 */
export function Pagination({ page, total, pageSize, basePath, params }: Props) {
  const pages = Math.max(1, Math.ceil(total / Math.max(1, pageSize)));
  const beyond = total > 0 && Math.floor(page) > pages;
  if (pages <= 1 && !beyond) return null;
  const current = beyond ? 0 : Math.min(Math.max(1, Math.floor(page)), pages);

  return (
    <nav aria-label="Pagination" className="border-t border-rule pt-6">
      <div className="flex flex-wrap items-center justify-center gap-2">
        {current > 1 ? (
          <Link href={hrefFor(basePath, params, current - 1)} rel="prev" className={linkClass}>
            Prev
          </Link>
        ) : null}
        {pageItems(current, pages).map((item) =>
          typeof item === "string" ? (
            <span key={item} aria-hidden="true" className="px-2 font-display font-bold text-ink-soft">
              …
            </span>
          ) : (
            <Fragment key={item}>
              {item === current ? (
                <span aria-current="page" className={currentClass}>
                  {item}
                </span>
              ) : (
                <Link href={hrefFor(basePath, params, item)} aria-label={`Page ${item}`} className={linkClass}>
                  {item}
                </Link>
              )}
            </Fragment>
          ),
        )}
        {current < pages ? (
          <Link href={hrefFor(basePath, params, current + 1)} rel="next" className={linkClass}>
            Next
          </Link>
        ) : null}
      </div>
      {beyond ? (
        <p className="mt-3 text-center font-display text-sm text-ink-soft">Page {pages} is the last page</p>
      ) : null}
    </nav>
  );
}
