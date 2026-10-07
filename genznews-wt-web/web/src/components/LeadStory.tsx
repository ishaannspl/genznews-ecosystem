import Link from "next/link";
import { parseAssembledBody } from "@/lib/articleBody";
import { formatRelative } from "@/lib/format";
import type { Article } from "@/lib/types";
import { CategoryLabel } from "./CategoryLabel";
import { StoryCover } from "./StoryCover";
import { ThreeLineRead } from "./ThreeLineRead";

interface Props {
  article: Article;
  headingLevel?: "h1" | "h2";
  now?: Date;
}

/** The lead story: cover, big headline and the large animated three-line read. */
export function LeadStory({ article, headingLevel = "h2", now }: Props) {
  const Heading = headingLevel;
  const href = `/article/${article.slug}`;
  const { tldr } = parseAssembledBody(article.bodyMd);

  return (
    <article data-category={article.category} className="flex min-w-0 flex-col">
      <StoryCover src={article.imageUrl} alt="" category={article.category} priority />

      <CategoryLabel category={article.category} className="mt-5 text-base" />
      <Heading className="wrap-anywhere mt-2 text-[clamp(2rem,1.35rem+2.8vw,3.5rem)] font-extrabold leading-[1.02] tracking-[-0.03em]">
        <Link href={href} className="no-underline hover:underline decoration-[3px] underline-offset-[0.12em]">
          {article.title}
        </Link>
      </Heading>

      {tldr.length > 0 ? (
        <ThreeLineRead lines={tldr} animate size="lg" className="mt-6 max-w-[34ch]" />
      ) : (
        <p className="wrap-anywhere mt-5 max-w-[60ch] text-lg text-ink-soft">{article.summary}</p>
      )}

      <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-1 font-display">
        <Link
          href={href}
          className="inline-flex min-h-11 items-center text-base font-bold underline decoration-2 underline-offset-[0.2em]"
        >
          Read the story<span className="sr-only">: {article.title}</span>
        </Link>
        <p className="flex min-w-0 flex-wrap gap-x-3 text-sm text-ink-soft">
          <time dateTime={article.publishedAt} className="font-semibold text-ink">
            {formatRelative(article.publishedAt, now)}
          </time>
          <span className="wrap-anywhere">{article.sourceName}</span>
        </p>
      </div>
    </article>
  );
}
