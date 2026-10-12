/**
 * An inline script that runs while the server HTML is parsed (before first paint) and is inert
 * when React renders it on the client. React 19 logs a red dev error for any executable
 * <script> it renders on the client (error boundary, 404 page). A text/plain script is not
 * executable, so the client render is clean; suppressHydrationWarning accepts the type
 * difference at hydration. Documented in Next's "Preventing flash before hydration" guide.
 *
 * `html` must be a constant authored in this codebase, never data from a request or a store.
 */
export function InlineScript({ html }: { html: string }) {
  return (
    <script
      type={typeof window === "undefined" ? "text/javascript" : "text/plain"}
      suppressHydrationWarning
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
