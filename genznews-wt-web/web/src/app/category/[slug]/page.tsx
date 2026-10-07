import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ErrorState } from "@/components/ErrorState";
import { StoryFeed } from "@/components/StoryFeed";
import { CATEGORIES, categoryBySlug } from "@/lib/categories";
import { PAGE_SIZE, parsePage } from "@/lib/params";
import { getRepository } from "@/lib/repositories";
import { logListDecision, logListError } from "@/lib/pageLog";
import { listMetadata } from "@/lib/seo";
import { orNullOnRepositoryError } from "@/lib/settle";

// Rendered per request (it reads searchParams): every visit queries the repository,
// so there is no ISR here and relative times are current at request time.
// The five categories are fixed. src/proxy.ts rewrites unknown slugs to the static
// not-found page (404 with full HTML); the notFound() below is a backstop. There is
// deliberately no loading.tsx here: a streamed notFound() would be sent as HTTP 200.
export const dynamicParams = false;

type Props = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export function generateStaticParams() {
  return CATEGORIES.map((c) => ({ slug: c.slug }));
}

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const category = categoryBySlug(slug);
  if (!category) return { title: "Page not found", robots: { index: false, follow: false } };
  return listMetadata({
    title: category.name,
    description: `The latest ${category.name.toLowerCase()} stories, each with the point in three lines.`,
    path: `/category/${category.slug}`,
    page: parsePage(query.page),
  });
}

export default async function CategoryPage({ params, searchParams }: Props) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const category = categoryBySlug(slug);
  // Checked before any data read, so the 404 status is set before streaming starts.
  if (!category) notFound();

  const page = parsePage(query.page);
  // A RepositoryError renders ErrorState inline with HTTP 200, so the message is in
  // the server HTML; any other error still reaches error.tsx.
  const result = await orNullOnRepositoryError(
    getRepository().list({ category: category.slug, page, pageSize: PAGE_SIZE }),
  );
  if (result) logListDecision("category", result, page, { category: category.slug });
  else logListError("category");
  const now = new Date();

  return (
    <div className="pt-8 md:pt-12" data-category={category.slug}>
      <div className="grid grid-cols-[6px_minmax(0,1fr)] gap-x-4 md:gap-x-5">
        <span className="spine w-1.5!" aria-hidden="true" />
        <h1 className="page-title wrap-anywhere text-cat-text">{category.name}</h1>
      </div>
      <div className="mt-6 md:mt-8">
        {result ? (
          <StoryFeed
            stories={result.items}
            page={page}
            total={result.total}
            basePath={`/category/${category.slug}`}
            params={{}}
            showCategory={false}
            now={now}
          />
        ) : (
          <ErrorState />
        )}
      </div>
    </div>
  );
}
