import { Fragment } from "react";
import { formatDate } from "@/lib/format";
import { PAGE_SIZE } from "@/lib/params";
import type { ArticleSummary } from "@/lib/types";
import { EmptyState } from "./EmptyState";
import { Pagination } from "./Pagination";
import { StoryRow } from "./StoryRow";

interface Props {
  stories: ArticleSummary[];
  page: number;
  total: number;
  basePath: string;
  params: Record<string, string | string[] | undefined>;
  /** Replaces the default empty copy. */
  emptyTitle?: string;
  /** Row category labels; off on a category page, where the h1 names it. Default true. */
  showCategory?: boolean;
  now?: Date;
}

/**
 * A paginated feed of full rows (with summaries) under a page h1. A page past
 * the end shows the empty state and keeps the links back.
 */
export function StoryFeed({ stories, page, total, basePath, params, emptyTitle, showCategory = true, now }: Props) {
  return (
    <div className="flex flex-col gap-6">
      {stories.length > 0 ? (
        <ul role="list" className="divide-y divide-rule border-y border-rule">
          {stories.map((story, i) => {
            // Stories arrive newest first, so a new day label starts wherever the date changes.
            const day = formatDate(story.publishedAt);
            const startsDay = day !== "" && (i === 0 || day !== formatDate(stories[i - 1].publishedAt));
            return (
              <Fragment key={story.id}>
                {startsDay ? (
                  <li role="presentation" data-day={day} className="section-label bg-transparent pb-1 pt-5 first:pt-3">
                    {day}
                  </li>
                ) : null}
                <li>
                  <StoryRow story={story} showSummary showCategory={showCategory} headingLevel="h2" now={now} />
                </li>
              </Fragment>
            );
          })}
        </ul>
      ) : (
        <EmptyState title={emptyTitle} />
      )}
      <Pagination page={page} total={total} pageSize={PAGE_SIZE} basePath={basePath} params={params} />
    </div>
  );
}
