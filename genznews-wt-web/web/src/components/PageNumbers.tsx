import Link from "next/link";

interface Props {
  page: number;
  total: number;
  pageSize: number;
  basePath: string;
  /** How many numbered links to show before "..." and the last page. */
  window?: number;
}

const item =
  "inline-flex min-h-11 min-w-11 items-center justify-center border border-rule px-3 font-display text-base font-semibold hover:bg-ink hover:text-paper";

function hrefFor(basePath: string, page: number): string {
  return page > 1 ? `${basePath}?page=${page}` : basePath;
}

/** Numbered pager: 1 2 3 4 5 ... last, Next. Links into the paged /latest list. */
export function PageNumbers({ page, total, pageSize, basePath, window = 5 }: Props) {
  const pages = Math.max(1, Math.ceil(total / Math.max(1, pageSize)));
  if (pages <= 1) return null;
  const shown = Array.from({ length: Math.min(window, pages) }, (_, i) => i + 1);
  const hasMore = pages > window;

  return (
    <nav aria-label="Pages" className="flex flex-wrap items-center justify-center gap-2">
      {shown.map((n) =>
        n === page ? (
          <span key={n} aria-current="page" className={`${item} bg-ink text-paper`}>
            {n}
          </span>
        ) : (
          <Link key={n} href={hrefFor(basePath, n)} className={item}>
            {n}
          </Link>
        ),
      )}
      {hasMore ? (
        <>
          <span aria-hidden="true" className="px-1 font-display text-ink-soft">
            ...
          </span>
          <Link href={hrefFor(basePath, pages)} className={item}>
            {pages}
          </Link>
        </>
      ) : null}
      {page < pages ? (
        <Link href={hrefFor(basePath, page + 1)} rel="next" className={`${item} font-bold`}>
          Next
        </Link>
      ) : null}
    </nav>
  );
}
