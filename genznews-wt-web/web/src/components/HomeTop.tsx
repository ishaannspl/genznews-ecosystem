"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { formatRelative } from "@/lib/format";
import { shuffled } from "@/lib/shuffle";
import type { ArticleSummary } from "@/lib/types";
import { CategoryChip } from "./CategoryChip";
import { SectionHeading } from "./SectionHeading";
import { StoryCover } from "./StoryCover";

const LATEST_COUNT = 4;
const THUMB_COUNT = 3;

interface Props {
  /** The newest stories (newest first). The browser reshuffles them on every load. */
  stories: ArticleSummary[];
  /** Stand-in for "most read": we do not track views, so these are the next newest stories. */
  mostRead: ArticleSummary[];
  now: Date;
}

/** A shuffled lead should have a picture; fall back to the first story when none does. */
function withImageFirst(list: ArticleSummary[]): ArticleSummary[] {
  const i = list.findIndex((s) => s.imageUrl);
  return i <= 0 ? list : [list[i], ...list.slice(0, i), ...list.slice(i + 1)];
}

function Continue({ story }: { story: ArticleSummary }) {
  return (
    <Link href={`/article/${story.slug}`} className="text-link mt-2 text-sm">
      Continue reading<span className="sr-only">: {story.title}</span>
    </Link>
  );
}

function Meta({ story, now }: { story: ArticleSummary; now: Date }) {
  return (
    <div className="flex items-center gap-3">
      <CategoryChip category={story.category} />
      <time dateTime={story.publishedAt} className="font-display text-sm text-ink-soft">
        {formatRelative(story.publishedAt, now)}
      </time>
    </div>
  );
}

/**
 * Three-column home top: lead story, latest news, most read. Server render is newest-first so
 * first paint matches hydration; after mount the lead and the latest column reshuffle.
 */
export function HomeTop({ stories, mostRead, now }: Props) {
  const [order, setOrder] = useState(stories);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- must run after hydration, never during render
    setOrder(withImageFirst(shuffled(stories)));
  }, [stories]);

  const [lead, ...rest] = order;
  const thumbs = rest.slice(0, THUMB_COUNT);
  const latest = rest.slice(THUMB_COUNT, THUMB_COUNT + LATEST_COUNT);
  if (!lead) return null;

  return (
    <div className="grid gap-y-12 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,0.9fr)] lg:gap-x-0">
      <section aria-labelledby="top-stories" className="min-w-0 lg:pr-8">
        <SectionHeading id="top-stories" as="h1">
          Top stories
        </SectionHeading>
        <article data-category={lead.category} className="mt-6 flex min-w-0 flex-col">
          <div className="relative">
            <StoryCover src={lead.imageUrl} alt="" category={lead.category} ratio="4/3" priority />
            <CategoryChip category={lead.category} className="absolute left-0 top-0 border-0" />
          </div>
          <time dateTime={lead.publishedAt} className="mt-4 font-display text-sm text-ink-soft">
            {formatRelative(lead.publishedAt, now)}
          </time>
          <h2 className="wrap-anywhere mt-2 text-[clamp(1.5rem,1.2rem+1.2vw,2rem)] font-extrabold leading-[1.1]">
            <Link href={`/article/${lead.slug}`} className="no-underline hover:underline">
              {lead.title}
            </Link>
          </h2>
          {lead.summary ? <p className="wrap-anywhere mt-3 line-clamp-4 text-ink-soft">{lead.summary}</p> : null}
          <Continue story={lead} />
          {thumbs.length > 0 ? (
            <ul role="list" className="mt-6 grid grid-cols-3 gap-3">
              {thumbs.map((s) => (
                <li key={s.id} data-category={s.category}>
                  <Link href={`/article/${s.slug}`} aria-label={s.title} className="block">
                    <StoryCover src={s.imageUrl} alt="" category={s.category} ratio="4/3" />
                  </Link>
                </li>
              ))}
            </ul>
          ) : null}
        </article>
      </section>

      <section aria-labelledby="latest-news" className="min-w-0 lg:border-l lg:border-rule lg:px-8">
        <SectionHeading id="latest-news" href="/latest">
          Latest news
        </SectionHeading>
        <ul role="list" className="mt-6 divide-y divide-dotted divide-ink-soft/40">
          {latest.map((s) => (
            <li key={s.id} data-category={s.category} className="flex flex-col py-5 first:pt-0">
              <Meta story={s} now={now} />
              <h3 className="wrap-anywhere mt-3 text-[1.375rem] font-extrabold leading-[1.15]">
                <Link href={`/article/${s.slug}`} className="no-underline hover:underline">
                  {s.title}
                </Link>
              </h3>
              {s.summary ? <p className="wrap-anywhere mt-2 line-clamp-2 text-ink-soft">{s.summary}</p> : null}
              <Continue story={s} />
            </li>
          ))}
        </ul>
      </section>

      {mostRead.length > 0 ? (
        <section aria-labelledby="most-read" className="min-w-0 lg:border-l lg:border-rule lg:pl-8">
          <SectionHeading id="most-read">Most read</SectionHeading>
          <ul role="list" className="mt-6 divide-y divide-dotted divide-ink-soft/40">
            {mostRead.map((s) => (
              <li key={s.id} data-category={s.category} className="grid grid-cols-[minmax(0,1fr)_6.5rem] gap-x-4 py-5 first:pt-0">
                <div className="flex min-w-0 flex-col">
                  <Meta story={s} now={now} />
                  <h3 className="wrap-anywhere mt-2 text-base font-bold leading-[1.25]">
                    <Link href={`/article/${s.slug}`} className="no-underline hover:underline">
                      {s.title}
                    </Link>
                  </h3>
                  <Continue story={s} />
                </div>
                <StoryCover src={s.imageUrl} alt="" category={s.category} ratio="4/3" className="self-start" />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
