import { categoryBySlug, type CategorySlug } from "@/lib/categories";

interface Props {
  category: CategorySlug;
  /** Use the short name ("Health") instead of the full one. */
  short?: boolean;
  className?: string;
}

/** Sentence-case category name in the category text color. */
export function CategoryLabel({ category, short = false, className = "" }: Props) {
  const c = categoryBySlug(category);
  if (!c) return null;
  return (
    <span
      data-category={c.slug}
      data-category-label={c.slug}
      className={`font-display text-sm font-semibold leading-tight text-cat-text ${className}`}
    >
      {short ? c.shortName : c.name}
    </span>
  );
}
