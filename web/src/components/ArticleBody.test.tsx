import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import rehypeRaw from "rehype-raw";
import { ArticleBody, MarkdownRenderer } from "./ArticleBody";

const HOSTILE = [
  "# Big title",
  "",
  "Hello <script>alert(1)</script> world.",
  "",
  '<img src="x" onerror="alert(2)">',
  "",
  '<a href="https://evil.example" onclick="alert(3)">raw html link</a>',
  "",
  "[bad link](javascript:alert(4)) and [data link](data:text/html,hi) and [vb](vbscript:msgbox)",
  "",
  "![tracking pixel](https://tracker.example/p.gif)",
  "",
  "Read [the report](https://www.bbc.co.uk/news/x) or [our about page](/about) or [mail us](mailto:hi@genznews.in).",
].join("\n");

describe("ArticleBody", () => {
  test("test_protocol_relative_links_are_external_and_relative_or_anchor_links_stay_internal", () => {
    render(<ArticleBody markdown={"See [cdn](//cdn.example/x), [here](/latest), [top](#top) and [rel](notes/a)."} />);
    const cdn = screen.getByRole("link", { name: /cdn/ });
    expect(cdn).toHaveAttribute("href", "//cdn.example/x");
    expect(cdn).toHaveAttribute("target", "_blank");
    expect(cdn).toHaveAttribute("rel", "noopener noreferrer");
    expect(cdn).toHaveTextContent("opens in a new tab");
    for (const name of ["here", "top", "rel"]) {
      const link = screen.getByRole("link", { name });
      expect(link, name).not.toHaveAttribute("target");
      expect(link, name).not.toHaveAttribute("rel");
    }
  });

  test('removes <script>, onerror attributes and javascript: links, adds rel="noopener noreferrer" and target="_blank" to external links only', () => {
    const { container } = render(<ArticleBody markdown={HOSTILE} />);
    const html = container.innerHTML;

    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("[onerror]")).toBeNull();
    expect(container.querySelector("[onclick]")).toBeNull();
    expect(html).not.toMatch(/javascript:/i);
    expect(html).not.toMatch(/vbscript:/i);
    expect(html).not.toMatch(/data:text/i);
    expect(html).not.toContain("tracker.example");
    expect(container.querySelector('a[href^="https://evil.example"]')).toBeNull();

    // h1 is demoted so the page keeps a single h1.
    expect(container.querySelector("h1")).toBeNull();
    expect(screen.getByRole("heading", { level: 2, name: "Big title" })).toBeInTheDocument();

    const external = screen.getByRole("link", { name: /the report/ });
    expect(external).toHaveAttribute("href", "https://www.bbc.co.uk/news/x");
    expect(external).toHaveAttribute("target", "_blank");
    expect(external).toHaveAttribute("rel", "noopener noreferrer");
    expect(external).toHaveTextContent("opens in a new tab");

    const internal = screen.getByRole("link", { name: "our about page" });
    expect(internal).toHaveAttribute("href", "/about");
    expect(internal).not.toHaveAttribute("target");
    expect(internal).not.toHaveAttribute("rel");

    const mail = screen.getByRole("link", { name: "mail us" });
    expect(mail).toHaveAttribute("href", "mailto:hi@genznews.in");
    expect(mail).not.toHaveAttribute("target");

    // Unsafe links survive only as their text.
    expect(container.querySelector("a:not([href])")).toBeNull();
    expect(container).toHaveTextContent("bad link and data link and vb");

    // Every surviving link uses an allowed protocol or is relative.
    for (const a of Array.from(container.querySelectorAll("a"))) {
      const href = a.getAttribute("href") ?? "";
      expect(href === "" || /^(https?:|mailto:|\/|#)/i.test(href), href).toBe(true);
    }
  });

  test("ArticleBody drops the TL;DR block when given a full assembled body (it is rendered separately)", () => {
    const full =
      "**TL;DR**\n\n- Line one.\n- Line two.\n- Line three.\n\nThe real first paragraph.\n\n## Why it matters\n\nBecause.\n\n---\n\n*Sources: bbc.co.uk. Synthesized and curated by GenZNews.*\n";
    const { container } = render(<ArticleBody markdown={full} />);
    expect(container).not.toHaveTextContent("TL;DR");
    expect(container).not.toHaveTextContent("Line one.");
    expect(container).not.toHaveTextContent("Synthesized and curated");
    expect(container.querySelector("hr")).toBeNull();
    expect(container.querySelector("ul")).toBeNull();
    expect(screen.getByText("The real first paragraph.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Why it matters" })).toBeInTheDocument();
  });

  test("the component's own sanitize step holds with react-markdown's defences turned off", () => {
    // Raw HTML parsed into elements, no skipHtml, no URL transform: only the
    // sanitize plugin in ArticleBody's render path stands between input and DOM.
    const { container } = render(
      <MarkdownRenderer body={HOSTILE} skipHtml={false} urlTransform={(u) => u} preRehypePlugins={[rehypeRaw]} />,
    );
    const html = container.innerHTML;
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("[onerror], [onclick]")).toBeNull();
    expect(html).not.toMatch(/javascript:|vbscript:|data:text/i);
    expect(container.querySelector('a[href^="https://evil.example"]')).not.toBeNull();
    expect(screen.getByRole("link", { name: /the report/ })).toHaveAttribute("href", "https://www.bbc.co.uk/news/x");
  });
});
