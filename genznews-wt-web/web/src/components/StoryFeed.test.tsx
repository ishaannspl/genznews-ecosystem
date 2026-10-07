import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import type { ArticleSummary } from "@/lib/types";
import { StoryFeed } from "./StoryFeed";

const now = new Date("2026-10-01T12:00:00Z");

function story(i: number): ArticleSummary {
  return {
    id: `id-${i}`,
    slug: `story-${i}`,
    title: `Story ${i}`,
    summary: `Summary ${i}`,
    category: "health-wellness",
    imageUrl: null,
    publishedAt: "2026-10-01T10:00:00Z",
    sourceName: "bbc.co.uk",
  };
}

describe("StoryFeed", () => {
  test("renders one row per story as a list, with h2 headlines, and pagination links", () => {
    render(
      <StoryFeed
        stories={[story(1), story(2)]}
        page={1}
        total={30}
        basePath="/latest"
        params={{}}
        now={now}
      />,
    );
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getAllByRole("heading", { level: 2 })).toHaveLength(2);
    expect(screen.getByRole("link", { name: "Older stories" })).toHaveAttribute("href", "/latest?page=2");
  });

  test("starts a new day label wherever the publish date changes", () => {
    const older = { ...story(3), publishedAt: "2026-09-30T08:00:00Z" };
    const { container } = render(
      <StoryFeed stories={[story(1), story(2), older]} page={1} total={3} basePath="/latest" params={{}} now={now} />,
    );
    const days = [...container.querySelectorAll("[data-day]")].map((el) => el.textContent);
    expect(days).toEqual(["1 Oct 2026", "30 Sep 2026"]);
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
  });

  test("an empty page shows the empty state and still links back", () => {
    render(<StoryFeed stories={[]} page={9} total={30} basePath="/latest" params={{}} now={now} />);
    expect(screen.getByRole("status")).toHaveTextContent("No stories here yet.");
    expect(screen.getByRole("link", { name: "Newer stories" })).toHaveAttribute("href", "/latest?page=3");
  });

  test("a custom empty title replaces the copy", () => {
    render(
      <StoryFeed stories={[]} page={1} total={0} basePath="/search" params={{ q: "x" }} emptyTitle="Nothing." now={now} />,
    );
    expect(screen.getByRole("status")).toHaveTextContent(/^Nothing\.$/);
    expect(screen.queryByRole("navigation")).toBeNull();
  });

  test("showCategory=false drops the row labels", () => {
    const { container } = render(
      <StoryFeed stories={[story(1)]} page={1} total={1} basePath="/category/health-wellness" params={{}} showCategory={false} now={now} />,
    );
    expect(container.querySelector("[data-category-label]")).toBeNull();
  });
});
