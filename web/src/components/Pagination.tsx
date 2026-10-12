import Link from "next/link";

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

const linkClass =
  "inline-flex min-h-11 items-center font-display text-base font-bold underline decoration-2 underline-offset-[0.2em]";

/**
 * Newer/older links with "Page N of M". Renders nothing for a single page.
 * A page past the end (with stories before it) links back to the last page.
 */
export function Pagination({ page, total, pageSize, basePath, params }: Props) {
  const pages = Math.max(1, Math.ceil(total / Math.max(1, pageSize)));
  const beyond = total > 0 && Math.floor(page) > pages;
  if (pages <= 1 && !beyond) return null;
  const current = Math.min(Math.max(1, Math.floor(page)), pages);

  if (beyond) {
    return (
      <nav aria-label="Pagination" className="flex flex-wrap items-center gap-x-6 border-t border-rule pt-3">
        <Link href={hrefFor(basePath, params, pages)} className={linkClass}>
          Newer stories
        </Link>
        <p className="font-display text-sm text-ink-soft">Page {pages} is the last page</p>
      </nav>
    );
  }

  return (
    <nav
      aria-label="Pagination"
      className="grid grid-cols-[1fr_auto_1fr] items-center gap-x-4 border-t border-rule pt-3"
    >
      <div>
        {current > 1 ? (
          <Link href={hrefFor(basePath, params, current - 1)} rel="prev" className={linkClass}>
            Newer stories
          </Link>
        ) : null}
      </div>
      <p className="font-display text-sm text-ink-soft">
        Page {current} of {pages}
      </p>
      <div className="text-right">
        {current < pages ? (
          <Link href={hrefFor(basePath, params, current + 1)} rel="next" className={linkClass}>
            Older stories
          </Link>
        ) : null}
      </div>
    </nav>
  );
}
