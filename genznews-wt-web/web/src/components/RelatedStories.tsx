import { useId } from "react";
import type { ArticleSummary } from "@/lib/types";
import { StoryRow } from "./StoryRow";

interface Props {
  stories: ArticleSummary[];
  title?: string;
  now?: Date;
}

/** A labelled list of compact rows. Renders nothing when there are no stories. */
export function RelatedStories({ stories, title = "Related stories", now }: Props) {
  const id = useId();
  if (stories.length === 0) return null;
  return (
    <section aria-labelledby={id}>
      <h2 id={id} className="text-[1.375rem] font-extrabold">
        {title}
      </h2>
      <ul role="list" className="mt-3 divide-y divide-rule border-y border-rule">
        {stories.map((s) => (
          <li key={s.id}>
            <StoryRow story={s} compact now={now} />
          </li>
        ))}
      </ul>
    </section>
  );
}
