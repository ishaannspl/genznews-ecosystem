/**
 * Markdown or HTML-ish text reduced to one line of plain text, for metadata and short reads.
 * Env-free and dependency-free. It removes markup, not characters: "C#" and `snake_case`
 * survive, because only paired emphasis markers, backtick pairs and a leading heading or
 * quote marker are stripped.
 */
export function plainText(text: string): string {
  return (
    String(text ?? "")
      // Tags first, so markdown inside them is not mistaken for text structure.
      .replace(/<[^>]*>/g, "")
      // Links and images: keep the visible text.
      .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
      // Leading heading or quote markers, on every line.
      .replace(/^[ \t]*(?:#{1,6}|>+)[ \t]+/gm, "")
      // Paired emphasis. Underscores only count at word edges, so snake_case stays intact.
      .replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, "$1")
      .replace(/(^|\W)__(?=\S)([\s\S]*?\S)__(?!\w)/g, "$1$2")
      .replace(/\*(?=\S)([^*]*?\S)\*/g, "$1")
      .replace(/(^|\W)_(?=\S)([^_]*?\S)_(?!\w)/g, "$1$2")
      .replace(/~~(?=\S)([\s\S]*?\S)~~/g, "$1")
      .replace(/`([^`]*)`/g, "$1")
      .replace(/\s+/g, " ")
      .trim()
  );
}
