import { useId } from "react";

/** A plain GET form to /search; works without JavaScript. */
export function SearchForm({ defaultValue = "", className = "" }: { defaultValue?: string; className?: string }) {
  const id = useId();
  return (
    <form role="search" method="get" action="/search" className={`flex flex-col gap-2 ${className}`}>
      <label htmlFor={id} className="font-display text-base font-semibold">
        Search stories
      </label>
      <div className="flex max-w-xl gap-2">
        <input
          id={id}
          name="q"
          type="search"
          maxLength={100}
          defaultValue={defaultValue}
          autoComplete="off"
          enterKeyHint="search"
          className="h-12 min-w-0 flex-1 border-2 border-ink bg-paper px-3 font-display text-base text-ink placeholder:text-ink-soft focus-visible:outline-offset-2"
        />
        <button
          type="submit"
          className="h-12 shrink-0 bg-ink px-5 font-display text-base font-bold text-paper hover:opacity-90"
        >
          Search
        </button>
      </div>
    </form>
  );
}
