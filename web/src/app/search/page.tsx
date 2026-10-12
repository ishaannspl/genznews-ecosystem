import type { Metadata } from "next";
import { ErrorState } from "@/components/ErrorState";
import { SearchForm } from "@/components/SearchForm";
import { StoryFeed } from "@/components/StoryFeed";
import { PAGE_SIZE, parsePage, parseQuery } from "@/lib/params";
import { getRepository } from "@/lib/repositories";
import { logListError, logSearchDecision } from "@/lib/pageLog";
import { listMetadata } from "@/lib/seo";
import { orNullOnRepositoryError } from "@/lib/settle";

// Rendered per request (it reads searchParams): every visit with a query searches
// the repository, so there is no ISR here and relative times are current.

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const params = await searchParams;
  const q = parseQuery(params.q).replace(/\s+/g, " ").slice(0, 60).trim();
  return listMetadata({
    title: q ? `Search: ${q}` : "Search",
    description: "Search GenZNews headlines, summaries and full stories.",
    path: "/search",
    page: parsePage(params.page),
    noindex: true,
  });
}

function countText(total: number, q: string): string {
  return `${total} ${total === 1 ? "story" : "stories"} for “${q}”`;
}

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const q = parseQuery(params.q);
  const page = parsePage(params.page);

  // The query is only ever rendered as React text, which escapes it.
  // A RepositoryError renders ErrorState inline with HTTP 200, so the message is in
  // the server HTML; any other error still reaches error.tsx.
  const result = q ? await orNullOnRepositoryError(getRepository().search(q, { page, pageSize: PAGE_SIZE })) : null;
  const failed = q !== "" && result === null;
  if (failed) logListError("search");
  else logSearchDecision(q, result, page);
  const now = new Date();

  return (
    <div className="pt-8 md:pt-12">
      <h1 className="page-title">Search</h1>
      <SearchForm defaultValue={q} className="mt-6" />

      {failed ? (
        <ErrorState className="mt-10" />
      ) : result ? (
        <div className="mt-10">
          {result.total > 0 ? (
            <p role="status" className="wrap-anywhere mb-3 font-display text-lg font-semibold">
              {countText(result.total, q)}
            </p>
          ) : null}
          <StoryFeed
            stories={result.items}
            page={page}
            total={result.total}
            basePath="/search"
            params={{ q }}
            emptyTitle={result.total === 0 ? `No stories match “${q}”. Try fewer or different words.` : undefined}
            now={now}
          />
        </div>
      ) : (
        <p className="mt-4 max-w-[52ch] text-ink-soft">
          Search headlines, summaries and full stories. Try a topic, a name or a place.
        </p>
      )}
    </div>
  );
}
