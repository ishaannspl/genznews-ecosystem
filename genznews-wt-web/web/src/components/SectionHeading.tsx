import Link from "next/link";
import type { ReactNode } from "react";
import type { CategorySlug } from "@/lib/categories";

interface Props {
  id: string;
  children: ReactNode;
  /** Makes the title a link and adds a "See all" link on the right. */
  href?: string;
  as?: "h1" | "h2";
  /** Colors the underline and title in this category's color. Default: plain ink. */
  category?: CategorySlug;
  className?: string;
}

/** Section title with an accent underline that sits on a full-width rule. */
export function SectionHeading({ id, children, href, as: Heading = "h2", category, className = "" }: Props) {
  return (
    <div data-category={category} className={`flex items-end justify-between gap-4 border-b border-rule ${className}`}>
      <Heading id={id} className={`section-label -mb-px border-b-[3px] pb-2 ${category ? "border-cat-base text-cat-text" : "border-ink"}`}>
        {href ? (
          <Link href={href} className="no-underline hover:underline">
            {children}
          </Link>
        ) : (
          children
        )}
      </Heading>
      {href ? (
        <Link href={href} className="text-link pb-2 text-sm">
          See all<span className="sr-only"> {children}</span>
        </Link>
      ) : null}
    </div>
  );
}
