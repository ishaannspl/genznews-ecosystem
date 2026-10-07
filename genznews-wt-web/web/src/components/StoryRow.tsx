import Link from "next/link";
import { formatRelative } from "@/lib/format";
import type { ArticleSummary } from "@/lib/types";
import { CategoryLabel } from "./CategoryLabel";
import { StoryCover } from "./StoryCover";

interface Props {
  story: ArticleSummary;
  /** Summary line (shown from 640px, clamped to two lines). Default true. */
  showSummary?: boolean;
  /** Tighter row for the Latest rail and related lists: no summary, no thumbnail. */
  compact?: boolean;
  headingLevel?: "h2" | "h3";
  /** Category label above the headline. Off inside a lane headed by the category. Default true. */
  showCategory?: boolean;
  now?: Date;
}

/**
 * One feed row: category spine, label, headline, meta. The headline anchor is
 * stretched over the row, so the whole row is one target and one tab stop.
 */
export function StoryRow({ story, showSummary = true, compact = false, headingLevel = "h3", showCategory = true, now }: Props) {
  const Heading = headingLevel;
  const thumb = !compact && story.imageUrl;

  return (
    <article
      data-category={story.category}
      data-compact={compact ? "true" : undefined}
      className={`story-row relative grid grid-cols-[4px_minmax(0,1fr)_auto] gap-x-4 sm:gap-x-5 ${
        compact ? "min-h-11 py-3" : "min-h-11 py-5"
      }`}
    >
      <span className="spine" aria-hidden="true" />

      <div className="flex min-w-0 flex-col">
        {showCategory ? (
          <CategoryLabel category={story.category} className={compact ? "text-[0.8125rem]" : ""} />
        ) : null}
        <Heading
          className={`wrap-anywhere ${showCategory ? (compact ? "mt-1" : "mt-1.5") : ""} ${
            compact
              ? "text-[1.0625rem] font-bold leading-[1.25]"
              : "text-[1.25rem] font-extrabold leading-[1.15] sm:text-[1.5rem]"
          }`}
        >
          <Link href={`/article/${story.slug}`} className="stretched-link">
            {story.title}
          </Link>
        </Heading>
        {showSummary && !compact && story.summary ? (
          <p className="wrap-anywhere mt-2 hidden max-w-[62ch] text-ink-soft sm:line-clamp-2">{story.summary}</p>
        ) : null}
        <p
          className={`flex flex-wrap gap-x-3 font-display text-ink-soft ${
            compact ? "mt-1 text-[0.8125rem]" : "mt-2.5 text-sm"
          }`}
        >
          <time dateTime={story.publishedAt} className="font-semibold text-ink">
            {formatRelative(story.publishedAt, now)}
          </time>
          <span className="wrap-anywhere">{story.sourceName}</span>
        </p>
      </div>

      {thumb ? (
        <StoryCover
          src={story.imageUrl}
          alt=""
          category={story.category}
          ratio="4/3"
          className="w-24 self-start sm:w-40"
        />
      ) : (
        <span aria-hidden="true" />
      )}
    </article>
  );
}
