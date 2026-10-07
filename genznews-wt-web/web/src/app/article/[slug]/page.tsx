import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { ArticleBody } from "@/components/ArticleBody";
import { CategoryLabel } from "@/components/CategoryLabel";
import { RelatedStories } from "@/components/RelatedStories";
import { SourceCredit } from "@/components/SourceCredit";
import { StoryCover } from "@/components/StoryCover";
import { ThreeLineRead } from "@/components/ThreeLineRead";
import { parseAssembledBody } from "@/lib/articleBody";
import { formatRelative } from "@/lib/format";
import { logArticleDecisions } from "@/lib/pageLog";
import { getRepository } from "@/lib/repositories";
import { categoryBySlug } from "@/lib/categories";
import { articleMetadata, breadcrumbJsonLd, newsArticleJsonLd, safeJsonLd } from "@/lib/seo";

export const revalidate = 300;
// Articles published after the build render on first request, then join the ISR cache.
export const dynamicParams = true;

type Props = { params: Promise<{ slug: string }> };

// One read per request, shared by generateMetadata and the page.
const getArticle = cache((slug: string) => getRepository().getBySlug(slug));

export async function generateStaticParams() {
  try {
    const slugs = await getRepository().allSlugs();
    return slugs.map(({ slug }) => ({ slug }));
  } catch {
    // An unreachable data source must not fail the build; pages render on demand instead.
    return [];
  }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const article = await getArticle((await params).slug);
  if (!article) return { title: "Page not found", robots: { index: false, follow: false } };
  return articleMetadata(article);
}

export default async function ArticlePage({ params }: Props) {
  const { slug } = await params;
  // A RepositoryError is deliberately not caught here. This is an ISR page: a caught
  // error would be rendered and cached for 300 s. Thrown, Next keeps serving the last
  // generated page when regeneration fails and caches nothing. If the database is down
  // and an article was never generated, the response is Next's plain 500; already
  // generated articles keep serving from cache. Only a missing article is a 404.
  const article = await getArticle(slug);
  if (!article) notFound();

  const related = await getRepository().related(article, 4);
  const { tldr } = parseAssembledBody(article.bodyMd);
  logArticleDecisions(article, related, tldr.length);
  // Relative times are rendered on the server, so they can be up to 300 s stale (ISR window).
  const now = new Date();

  const categoryName = categoryBySlug(article.category)?.name ?? "";
  const jsonLd = [
    newsArticleJsonLd(article),
    breadcrumbJsonLd([
      { name: "Home", path: "/" },
      { name: categoryName, path: `/category/${article.category}` },
      { name: article.title, path: `/article/${article.slug}` },
    ]),
  ];

  return (
    <div className="mx-auto max-w-[680px] pt-8 md:pt-12">
      {jsonLd.map((block, i) => (
        // The one allowed dangerouslySetInnerHTML: safeJsonLd escapes everything that could end the script tag.
        <script key={i} type="application/ld+json" dangerouslySetInnerHTML={{ __html: safeJsonLd(block) }} />
      ))}
      <article data-category={article.category} className="min-w-0">
        <header className="flex flex-col">
          <CategoryLabel category={article.category} className="text-base" />
          <h1 className="wrap-anywhere mt-3 text-[clamp(2.125rem,1.5rem+2.6vw,3.5rem)] font-extrabold leading-[1.04] tracking-[-0.03em]">
            {article.title}
          </h1>
          <p className="mt-5 flex flex-wrap gap-x-4 gap-y-1 font-display text-base text-ink-soft">
            <span className="wrap-anywhere">{article.sourceName}</span>
            <time dateTime={article.publishedAt} className="font-semibold text-ink">
              {formatRelative(article.publishedAt, now)}
            </time>
          </p>
        </header>

        {/* With no image, a full-width placeholder would push the three-line read below the
            fold; StoryCover still falls back to it when a real image fails to load. */}
        {article.imageUrl ? (
          <StoryCover src={article.imageUrl} alt="" category={article.category} priority className="mt-8" />
        ) : null}

        {tldr.length > 0 ? <ThreeLineRead lines={tldr} size="sm" className="mt-8" /> : null}

        <ArticleBody markdown={article.bodyMd} className="mt-10" />

        <div className="mt-10 border-t border-rule pt-4">
          <SourceCredit sourceName={article.sourceName} sourceUrl={article.sourceUrl} />
          {article.tags.length > 0 ? (
            <ul role="list" aria-label="Tags" className="mt-3 flex flex-wrap gap-2">
              {article.tags.map((tag) => (
                <li key={tag} className="border border-rule px-2.5 py-1 font-display text-sm text-ink-soft">
                  {tag}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </article>

      <div className="mt-14">
        <RelatedStories stories={related} now={now} />
      </div>
    </div>
  );
}
