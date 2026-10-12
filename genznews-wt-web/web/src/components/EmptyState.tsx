export const EMPTY_COPY = "No stories here yet. New ones land after each review.";

/** Quiet empty state. `title` replaces the copy only where a page needs its own wording. */
export function EmptyState({ title = EMPTY_COPY, className = "" }: { title?: string; className?: string }) {
  return (
    <div role="status" className={`border-t border-rule py-10 ${className}`}>
      <p className="wrap-anywhere max-w-[36ch] font-display text-[1.375rem] font-semibold leading-snug">{title}</p>
    </div>
  );
}
