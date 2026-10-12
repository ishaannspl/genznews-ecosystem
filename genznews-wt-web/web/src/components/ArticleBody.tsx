import type { ComponentProps } from "react";
import Markdown, { type Components } from "react-markdown";
import type { PluggableList } from "unified";
import { parseAssembledBody } from "@/lib/articleBody";
import { sanitizePlugins } from "@/lib/markdownSchema";

// Absolute http(s) links and protocol-relative ones (//host) leave the site; relative and #anchor links do not.
const EXTERNAL = /^(https?:)?\/\//i;

function BodyLink({ href, children, node: _node, ...rest }: ComponentProps<"a"> & { node?: unknown }) {
  void _node;
  // A link whose URL was stripped as unsafe reads as plain text, not a dead link.
  if (!href) return <>{children}</>;
  if (EXTERNAL.test(href)) {
    return (
      <a {...rest} href={href} target="_blank" rel="noopener noreferrer">
        {children}
        <span className="sr-only"> (opens in a new tab)</span>
      </a>
    );
  }
  return (
    <a {...rest} href={href}>
      {children}
    </a>
  );
}

const components: Components = {
  // One h1 per page: the article title. Body headings start at h2.
  h1: ({ node: _node, ...props }) => {
    void _node;
    return <h2 {...props} />;
  },
  a: BodyLink,
  img: () => null,
};

interface RendererProps {
  body: string;
  /**
   * Test seams only. Pages never pass these: they exist so tests can turn off
   * react-markdown's own defences and prove the sanitize step alone holds.
   */
  skipHtml?: boolean;
  urlTransform?: (url: string) => string;
  preRehypePlugins?: PluggableList;
}

/** The markdown render path ArticleBody uses, with sanitization always last. */
export function MarkdownRenderer({ body, skipHtml = true, urlTransform, preRehypePlugins = [] }: RendererProps) {
  return (
    <Markdown
      rehypePlugins={[...preRehypePlugins, ...sanitizePlugins]}
      components={components}
      skipHtml={skipHtml}
      {...(urlTransform ? { urlTransform } : {})}
    >
      {body}
    </Markdown>
  );
}

/**
 * Renders only the article body: the TL;DR, trailing rule and attribution are
 * removed here because the page renders them as their own blocks.
 */
export function ArticleBody({ markdown, className = "" }: { markdown: string; className?: string }) {
  const { body } = parseAssembledBody(markdown);
  return (
    <div className={`article-body ${className}`}>
      <MarkdownRenderer body={body} />
    </div>
  );
}
