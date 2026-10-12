import { render, screen, within } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import type { ArticleSummary } from "@/lib/types";
import { StoryRow } from "./StoryRow";
import { CategoryLabel } from "./CategoryLabel";

const story: ArticleSummary = {
  id: "a1",
  slug: "nhs-instant-suspension-medical-record-snoopers",
  title: "NHS Slaps Instant Suspensions on Medical Record Snoopers",
  summary: "Staff who peek at records without a reason now lose access the same day.",
  category: "health-wellness",
  imageUrl: null,
  publishedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
  sourceName: "bbc.co.uk",
};

describe("StoryRow", () => {
  test("links to /article/<slug>, shows the category label in sentence case with its spine class, and a <time datetime>", () => {
    const { container } = render(<StoryRow story={story} />);
    const row = container.querySelector("article")!;
    expect(row).toHaveAttribute("data-category", "health-wellness");

    const links = within(row).getAllByRole("link");
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute("href", "/article/nhs-instant-suspension-medical-record-snoopers");
    expect(links[0]).toHaveAccessibleName(story.title);
    expect(within(row).getByRole("heading", { level: 3 })).toHaveTextContent(story.title);
    // Long unbroken tokens wrap instead of forcing horizontal scroll.
    expect(within(row).getByRole("heading", { level: 3 })).toHaveClass("wrap-anywhere");
    expect(within(row).getByText(story.summary)).toHaveClass("wrap-anywhere");
    expect(within(row).getByText("bbc.co.uk")).toHaveClass("wrap-anywhere");

    expect(within(row).getByText("Health and wellness")).toHaveAttribute("data-category-label", "health-wellness");
    expect(row.querySelector(".spine")).toHaveAttribute("aria-hidden", "true");

    const time = row.querySelector("time")!;
    expect(time).toHaveAttribute("datetime", story.publishedAt);
    expect(time).toHaveTextContent("2 hours ago");
    expect(within(row).getByText("bbc.co.uk")).toBeInTheDocument();
    expect(within(row).getByText(story.summary)).toBeInTheDocument();
  });

  test("compact rows drop the summary and the thumbnail; heading level is configurable", () => {
    const withImage = { ...story, imageUrl: "https://example.com/x.jpg" };
    const { container, rerender } = render(<StoryRow story={withImage} />);
    expect(container.querySelector("img")).not.toBeNull();

    rerender(<StoryRow story={withImage} compact headingLevel="h2" />);
    expect(container.querySelector("img")).toBeNull();
    expect(screen.queryByText(story.summary)).toBeNull();
    expect(container.querySelector("article")).toHaveAttribute("data-compact", "true");
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent(story.title);
  });

  test("showSummary=false hides the summary", () => {
    render(<StoryRow story={story} showSummary={false} />);
    expect(screen.queryByText(story.summary)).toBeNull();
  });
});

describe("StoryRow showCategory", () => {
  test("showCategory=false drops the label inside a lane that is already headed by the category", () => {
    const { container, rerender } = render(<StoryRow story={story} />);
    expect(container.querySelector("[data-category-label]")).not.toBeNull();
    rerender(<StoryRow story={story} showCategory={false} />);
    expect(container.querySelector("[data-category-label]")).toBeNull();
    expect(container.querySelector(".spine")).not.toBeNull();
  });
});

describe("CategoryLabel", () => {
  test("renders the full sentence-case name, or the short name", () => {
    const { rerender } = render(<CategoryLabel category="digital-marketing-social-media" />);
    expect(screen.getByText("Digital marketing and social media")).toHaveAttribute(
      "data-category",
      "digital-marketing-social-media",
    );
    rerender(<CategoryLabel category="digital-marketing-social-media" short />);
    expect(screen.getByText("Marketing")).toBeInTheDocument();
  });
});
