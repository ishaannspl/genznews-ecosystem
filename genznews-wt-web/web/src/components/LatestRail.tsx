"use client";

import { useEffect, useState } from "react";
import { shuffled } from "@/lib/shuffle";
import type { ArticleSummary } from "@/lib/types";
import { StoryRow } from "./StoryRow";

/**
 * The Latest rail. Renders newest-first on the server (so the first paint matches hydration),
 * then reorders the stories in the browser so each page load shows a different mix.
 */
export function LatestRail({ stories, now }: { stories: ArticleSummary[]; now: Date }) {
  const [order, setOrder] = useState(stories);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- must run after hydration, never during render
    setOrder(shuffled(stories));
  }, [stories]);

  return (
    <ul role="list" className="divide-y divide-rule border-y border-rule">
      {order.map((story) => (
        <li key={story.id}>
          <StoryRow story={story} compact now={now} />
        </li>
      ))}
    </ul>
  );
}
