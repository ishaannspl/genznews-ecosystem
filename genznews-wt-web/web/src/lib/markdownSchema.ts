import rehypeSanitize, { defaultSchema, type Options as SanitizeSchema } from "rehype-sanitize";
import type { PluggableList } from "unified";

// GitHub-style sanitation, tightened: no images at all, and links may only use
// http, https or mailto (relative links have no protocol and stay allowed).
export const sanitizeSchema: SanitizeSchema = {
  ...defaultSchema,
  tagNames: (defaultSchema.tagNames ?? []).filter((t) => t !== "img" && t !== "picture" && t !== "source"),
  attributes: Object.fromEntries(
    Object.entries(defaultSchema.attributes ?? {}).filter(([tag]) => tag !== "img"),
  ),
  protocols: { href: ["http", "https", "mailto"] },
  strip: [...(defaultSchema.strip ?? []), "style"],
};

/** The rehype plugins every rendered article body goes through. */
export const sanitizePlugins: PluggableList = [[rehypeSanitize, sanitizeSchema]];
