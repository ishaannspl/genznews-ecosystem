import { isHttpUrl } from "@/lib/url";

interface Props {
  sourceName: string;
  sourceUrl: string;
  className?: string;
}

/** Same words the repository uses when a row names no outlet. */
const UNKNOWN_OUTLET = "the original outlet";

function safeUrl(url: string): string | null {
  return isHttpUrl(url) ? new URL(url).toString() : null;
}

/** "Reported by {outlet}. Rewritten by GenZNews." with a link to the original. */
export function SourceCredit({ sourceName, sourceUrl, className = "" }: Props) {
  const href = safeUrl(sourceUrl);
  const name = sourceName.trim() || UNKNOWN_OUTLET;
  const known = name !== UNKNOWN_OUTLET;
  return (
    <p className={`font-display text-base text-ink-soft ${className}`}>
      Reported by{" "}
      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-11 items-center font-semibold text-ink underline decoration-1 underline-offset-[0.2em] hover:decoration-2"
        >
          {name}
          <span className="sr-only"> (opens in a new tab)</span>
        </a>
      ) : (
        // Without a link "the original outlet" is ordinary prose, not a name to emphasise.
        <span className={known ? "font-semibold text-ink" : undefined}>{name}</span>
      )}
      . Rewritten by GenZNews.
    </p>
  );
}
