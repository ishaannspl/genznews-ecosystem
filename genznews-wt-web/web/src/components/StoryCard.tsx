import Link from "next/link";
import { formatRelative } from "@/lib/format";
import type { ArticleSummary } from "@/lib/types";
import { CategoryChip } from "./CategoryChip";
import { StoryCover } from "./StoryCover";

interface Props {
  story: ArticleSummary;
  ratio?: "16/9" | "4/3";
  now?: Date;
}

/** Image card: category chip over the cover, bold headline, date. The headline link covers the card. */
export function StoryCard({ story, ratio = "4/3", now }: Props) {
  return (
    <article data-category={story.category} className="relative flex min-w-0 flex-col">
      <div className="relative">
        <StoryCover src={story.imageUrl} alt="" category={story.category} ratio={ratio} />
        <CategoryChip category={story.category} className="absolute left-0 top-0 border-0" />
      </div>
      <h3 className="wrap-anywhere mt-3 text-[1.25rem] font-extrabold leading-[1.15]">
        <Link href={`/article/${story.slug}`} className="stretched-link">
          {story.title}
        </Link>
      </h3>
      <time dateTime={story.publishedAt} className="mt-2 font-display text-sm uppercase tracking-wide text-ink-soft">
        {formatRelative(story.publishedAt, now)}
      </time>
    </article>
  );
}
