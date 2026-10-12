import { render, screen, within } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import type { Article } from "@/lib/types";
import { LeadStory } from "./LeadStory";
import { RelatedStories } from "./RelatedStories";
import { SourceCredit } from "./SourceCredit";

const article: Article = {
  id: "a1",
  slug: "taylor-swift-vmas",
  title: "Taylor Swift Sweeps VMAs 2026",
  summary: "She won big and thanked Dolly.",
  bodyMd:
    "**TL;DR**\n\n- She won Video of the Year.\n- She thanked Dolly Parton.\n- Fans lost it.\n\nBody text.\n\n---\n\n*Sources: x.com. Synthesized and curated by GenZNews.*\n",
  category: "entertainment-pop-culture",
  tags: [],
  sourceName: "timesofindia.indiatimes.com",
  sourceUrl: "https://timesofindia.indiatimes.com/x",
  imageUrl: null,
  publishedAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
  seoTitle: null,
  seoDescription: null,
  framework: null,
};

describe("LeadStory", () => {
  test("headline links to the article, the three-line read animates, and the text link names the headline", () => {
    const { container } = render(<LeadStory article={article} />);
    const heading = screen.getByRole("heading", { level: 2 });
    expect(heading).toHaveClass("wrap-anywhere");
    const headlineLink = within(heading).getByRole("link");
    expect(headlineLink).toHaveAttribute("href", "/article/taylor-swift-vmas");
    expect(headlineLink).toHaveAccessibleName(article.title);

    const read = screen.getByRole("link", { name: `Read the story: ${article.title}` });
    expect(read).toHaveAttribute("href", "/article/taylor-swift-vmas");

    const list = screen.getByRole("list");
    expect(list).toHaveAttribute("data-animate", "true");
    expect(within(list).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "She won Video of the Year.",
      "She thanked Dolly Parton.",
      "Fans lost it.",
    ]);

    expect(screen.getByText("Entertainment and pop culture")).toBeInTheDocument();
    expect(screen.getByText("timesofindia.indiatimes.com")).toBeInTheDocument();
    expect(container.querySelector("time")).toHaveTextContent("5 minutes ago");
    // The lead cover loads eagerly when there is an image.
  });

  test("falls back to the summary when there is no TL;DR, and loads a real cover eagerly", () => {
    render(<LeadStory article={{ ...article, bodyMd: "Just a body.", imageUrl: "https://example.com/c.jpg" }} />);
    expect(screen.queryByRole("list")).toBeNull();
    expect(screen.getByText(article.summary)).toHaveClass("wrap-anywhere");
    const img = document.querySelector("img")!;
    expect(img).toHaveAttribute("loading", "eager");
    expect(img).toHaveAttribute("fetchpriority", "high");
  });
});

describe("SourceCredit", () => {
  test("credits the outlet with a safe new-tab link and GenZNews as the rewriter", () => {
    const { container } = render(
      <SourceCredit sourceName="bbc.co.uk" sourceUrl="https://www.bbc.co.uk/news/1" />,
    );
    expect(container).toHaveTextContent("Reported by bbc.co.uk (opens in a new tab). Rewritten by GenZNews.");
    const link = screen.getByRole("link", { name: /bbc\.co\.uk/ });
    expect(link).toHaveAttribute("href", "https://www.bbc.co.uk/news/1");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  test("test_no_name_and_no_safe_url_reads_the_original_outlet_without_a_link", () => {
    for (const sourceName of ["the original outlet", "", "   "]) {
      const { container, unmount } = render(<SourceCredit sourceName={sourceName} sourceUrl="" />);
      expect(screen.queryByRole("link")).toBeNull();
      expect(container).toHaveTextContent(/^Reported by the original outlet\. Rewritten by GenZNews\.$/);
      unmount();
    }
  });

  test("test_the_original_outlet_still_links_when_the_url_is_safe", () => {
    const { container } = render(<SourceCredit sourceName="" sourceUrl="https://example.com/a" />);
    expect(container).toHaveTextContent("Reported by the original outlet (opens in a new tab). Rewritten by GenZNews.");
    expect(screen.getByRole("link")).toHaveAttribute("href", "https://example.com/a");
  });

  test("a non-http source URL renders the outlet as plain text", () => {
    const { container } = render(<SourceCredit sourceName="bbc.co.uk" sourceUrl="javascript:alert(1)" />);
    expect(screen.queryByRole("link")).toBeNull();
    expect(container).toHaveTextContent("Reported by bbc.co.uk. Rewritten by GenZNews.");
  });
});

describe("RelatedStories", () => {
  test("renders compact rows in a labelled list, and nothing when empty", () => {
    const s = { ...article, id: "b", slug: "other" };
    const { container, rerender } = render(<RelatedStories stories={[s]} />);
    const region = screen.getByRole("region", { name: "Related stories" });
    expect(within(region).getAllByRole("listitem")).toHaveLength(1);
    expect(region.querySelector("article")).toHaveAttribute("data-compact", "true");
    rerender(<RelatedStories stories={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
