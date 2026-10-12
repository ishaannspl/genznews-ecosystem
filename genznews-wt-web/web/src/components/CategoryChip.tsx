import { categoryBySlug, type CategorySlug } from "@/lib/categories";

/** Boxed category tag: sits above a headline or over the corner of a cover. */
export function CategoryChip({ category, className = "" }: { category: CategorySlug; className?: string }) {
  const c = categoryBySlug(category);
  if (!c) return null;
  return (
    <span
      data-category={c.slug}
      data-category-label={c.slug}
      className={`inline-block border border-rule bg-paper px-2.5 py-1 font-display text-[0.8125rem] font-semibold leading-none text-ink ${className}`}
    >
      {c.shortName}
    </span>
  );
}
