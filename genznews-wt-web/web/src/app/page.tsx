import type { Metadata } from "next";
import { EmptyState } from "@/components/EmptyState";
import { HomeTop } from "@/components/HomeTop";
import { PageNumbers } from "@/components/PageNumbers";
import { SectionHeading } from "@/components/SectionHeading";
import { StoryCard } from "@/components/StoryCard";
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

const LANE_SIZE = 4;
/** How many recent stories are read to build the top block and the "most read" column. */
const POOL = 40;
/** Stories the browser can shuffle between the lead and the latest column. */
const TOP_MIN = 9;
const TOP_MAX = 20;
const MOST_READ = 5;
/** Stories per page on /latest, used for the numbered pager at the bottom. */
const LATEST_PAGE_SIZE = 12;

/** Calendar day in India, so a story approved at 11pm IST still counts as that day. */
function dayKey(iso: string): string {
  return new Date(iso).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

async function loadHome() {
  const repo = getRepository();
  const [newest, ...lanes] = await Promise.all([
    repo.list({ page: 1, pageSize: POOL }),
    ...CATEGORIES.map((c) => repo.list({ category: c.slug, page: 1, pageSize: LANE_SIZE })),
  ]);
  const pool = newest.items;
  // Everything from the newest day goes into the shuffle, with a floor so a quiet day still fills the block.
  const dayCount = pool.filter((a) => pool[0] && dayKey(a.publishedAt) === dayKey(pool[0].publishedAt)).length;
  const top = pool.slice(0, Math.min(TOP_MAX, Math.max(TOP_MIN, dayCount)));
  const afterTop = pool.slice(top.length, top.length + MOST_READ);
  return {
    top,
    lead: top[0] ?? null,
    // Server order. The browser reshuffles the lead and these (see HomeTop).
    latest: top.slice(1, 6),
    mostRead: afterTop.length > 0 ? afterTop : pool.slice(-MOST_READ),
    total: newest.total,
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
  logHomeDecisions(data);

  if (!data.lead) {
    return (
      <div className="pt-8 md:pt-12">
        <h1 className="section-label">Top stories</h1>
        <EmptyState className="mt-6" />
      </div>
    );
  }

  const today = now.toLocaleDateString("en-IN", {
    weekday: "long",
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  });

  return (
    <div className="pt-6 md:pt-8">
      <p className="mb-6 font-display text-sm text-ink-soft">{today}</p>
      <HomeTop stories={data.top} mostRead={data.mostRead} now={now} />

      <div className="mt-16 flex flex-col gap-14 md:mt-20">
        {data.lanes
          .filter((lane) => lane.stories.length > 0)
          .map(({ category, stories }, i) => {
            // Alternate a four-up grid with a three-up grid of wider cards.
            const wide = i % 2 === 1;
            const shown = wide ? stories.slice(0, 3) : stories;
            return (
              <section key={category.slug} data-category={category.slug} aria-labelledby={`lane-${category.slug}`}>
                <SectionHeading id={`lane-${category.slug}`} href={`/category/${category.slug}`} category={category.slug}>
                  {category.name}
                </SectionHeading>
                <ul
                  role="list"
                  className={`mt-6 grid gap-x-6 gap-y-8 sm:grid-cols-2 ${wide ? "lg:grid-cols-3" : "lg:grid-cols-4"}`}
                >
                  {shown.map((story) => (
                    <li key={story.id} className="min-w-0">
                      <StoryCard story={story} ratio={wide ? "16/9" : "4/3"} now={now} />
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
      </div>

      <div className="mt-16 border-t border-rule pt-8 md:mt-20">
        <PageNumbers page={1} total={data.total} pageSize={LATEST_PAGE_SIZE} basePath="/latest" />
      </div>
    </div>
  );
}
