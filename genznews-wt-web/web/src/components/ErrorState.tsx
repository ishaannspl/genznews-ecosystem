export const ERROR_COPY = "We couldn't load stories. Refresh the page, or try again in a minute.";

/** Says what failed and what to do. Announced immediately via role="alert". */
export function ErrorState({ title = ERROR_COPY, className = "" }: { title?: string; className?: string }) {
  return (
    <div role="alert" className={`border-t-4 border-ink py-10 ${className}`}>
      <p className="wrap-anywhere max-w-[36ch] font-display text-[1.375rem] font-semibold leading-snug">{title}</p>
    </div>
  );
}
