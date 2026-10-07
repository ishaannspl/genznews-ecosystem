import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState } from "@/components/EmptyState";
import { LatestRail } from "@/components/LatestRail";
import { LeadStory } from "@/components/LeadStory";
import { StoryRow } from "@/components/StoryRow";
import { CATEGORIES } from "@/lib/categories";
import { getRepository } from "@/lib/repositories";
import { logHomeDecisions, logHomeError } from "@/lib/pageLog";
import { RepositoryError } from "@/lib/repository";
import { DEFAULT_DESCRIPTION, DEFAULT_TITLE, listMetadata } from "@/lib/seo";

export const revalidate = 300;

export const metadata: Metadata = {
  ...listMetadata({ title: DEFAULT_TITLE, description: DEFAULT_DESCRIPTION, path: "/" }),
  // The default title already carries the brand, so the layout template must not add it again.
  title: { absolute: DEFAULT_TITLE },
};

const LANE_SIZE = 3;
/** How many recent stories are read to find "the latest day". */
const LATEST_POOL = 40;

/** Calendar day in India, so a story approved at 11pm IST still counts as that day. */
function dayKey(iso: string): string {
  return new Date(iso).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

async function loadHome() {
  const repo = getRepository();
  // The rail is a list read; the lead needs its full body for the three-line read, so
  // that one read chains off the list while every lane runs alongside it.
  const newestWithLead = repo.list({ page: 1, pageSize: LATEST_POOL }).then(async (newest) => {
    const first = newest.items[0];
    return { newest: newest.items, lead: first ? await repo.getBySlug(first.slug) : null };
  });
  const [{ newest, lead }, ...lanes] = await Promise.all([
    newestWithLead,
    ...CATEGORIES.map((c) => repo.list({ category: c.slug, page: 1, pageSize: LANE_SIZE })),
  ]);
  return {
    lead,
    // Latest is every story from the newest day (the lead excluded). LatestRail then shows
    // them in random order, so approving a batch of stories fills this section for that day.
    latest: newest.slice(1).filter((a) => newest[0] && dayKey(a.publishedAt) === dayKey(newest[0].publishedAt)),
    lanes: CATEGORIES.map((category, i) => ({ category, stories: lanes[i].items })),
  };
}

export default async function HomePage() {
  let data: Awaited<ReturnType<typeof loadHome>>;
  try {
    data = await loadHome();
  } catch (error) {
    if (error instanceof RepositoryError) logHomeError(error);
    // Rethrown on purpose. During ISR regeneration Next keeps serving the last good home page
    // and retries on a later request, so an outage never gets cached as the home page.
    // A home page that was never generated renders app/error.tsx instead. A `next build`
    // while the database is unreachable therefore fails at "/", which is intended.
    throw error;
  }

  // Relative times are rendered on the server, so they can be up to 300 s stale (ISR window).
  const now = new Date();
  const { lead, latest } = data;
  logHomeDecisions(data);

  if (!lead) {
    return (
      <div className="pt-8 md:pt-12">
        <h1 className="section-label">Today in three lines</h1>
        <EmptyState className="mt-6" />
      </div>
    );
  }

  return (
    <div className="pt-6 md:pt-10">
      <div className="grid gap-y-12 lg:grid-cols-12 lg:gap-x-14">
        <section aria-labelledby="today" className="min-w-0 lg:col-span-7">
          <h1 id="today" className="section-label mb-4">
            Today in three lines
          </h1>
          <LeadStory article={lead} now={now} />
        </section>

        {latest.length > 0 ? (
          <section aria-labelledby="latest" className="min-w-0 lg:col-span-5">
            <h2 id="latest" className="section-label mb-2">
              Latest
            </h2>
            <LatestRail stories={latest} now={now} />
            <Link href="/latest" className="text-link mt-2">
              See all latest stories
            </Link>
          </section>
        ) : null}
      </div>

      <div className="mt-16 flex flex-col gap-14 md:mt-20">
        {data.lanes
          .filter((lane) => lane.stories.length > 0)
          .map(({ category, stories }) => (
            <section
              key={category.slug}
              data-category={category.slug}
              aria-labelledby={`lane-${category.slug}`}
              className="grid min-w-0 gap-y-2 lg:grid-cols-12 lg:grid-rows-[auto_1fr] lg:gap-x-14"
            >
              <h2 id={`lane-${category.slug}`} className="section-label text-cat-text lg:col-span-4 lg:row-start-1">
                <Link href={`/category/${category.slug}`} className="no-underline hover:underline">
                  {category.name}
                </Link>
              </h2>
              <ul
                role="list"
                className="min-w-0 divide-y divide-rule border-y border-rule lg:col-span-8 lg:col-start-5 lg:row-span-2 lg:row-start-1"
              >
                {stories.map((story) => (
                  <li key={story.id}>
                    <StoryRow story={story} showSummary={false} showCategory={false} now={now} />
                  </li>
                ))}
              </ul>
              <Link
                href={`/category/${category.slug}`}
                className="text-link self-start justify-self-start text-base lg:col-span-4 lg:row-start-2"
              >
                See all {category.shortName.toLowerCase()} stories
              </Link>
            </section>
          ))}
      </div>
    </div>
  );
}
