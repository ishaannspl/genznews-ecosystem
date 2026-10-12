import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { Pagination } from "./Pagination";

function hrefOf(name: string): URL {
  return new URL(screen.getByRole("link", { name }).getAttribute("href")!, "http://x");
}

describe("Pagination", () => {
  test("renders previous/next links that keep other query params and omits previous on page 1 and next on the last page", () => {
    const params = { q: "flu shots", tag: ["a", "b"], page: "2" };
    const { rerender } = render(
      <Pagination page={2} total={45} pageSize={20} basePath="/search" params={params} />,
    );
    expect(screen.getByRole("navigation", { name: "Pagination" })).toBeInTheDocument();
    expect(screen.getByText("Page 2 of 3")).toBeInTheDocument();

    const older = hrefOf("Older stories");
    expect(older.pathname).toBe("/search");
    expect(older.searchParams.get("q")).toBe("flu shots");
    expect(older.searchParams.getAll("tag")).toEqual(["a", "b"]);
    expect(older.searchParams.get("page")).toBe("3");

    const newer = hrefOf("Newer stories");
    expect(newer.pathname).toBe("/search");
    expect(newer.searchParams.get("q")).toBe("flu shots");
    // Page 1 is the canonical URL, so the page param is dropped.
    expect(newer.searchParams.has("page")).toBe(false);

    rerender(<Pagination page={1} total={45} pageSize={20} basePath="/latest" params={{}} />);
    expect(screen.queryByRole("link", { name: "Newer stories" })).toBeNull();
    expect(hrefOf("Older stories").toString()).toBe("http://x/latest?page=2");

    rerender(<Pagination page={3} total={45} pageSize={20} basePath="/latest" params={{}} />);
    expect(screen.queryByRole("link", { name: "Older stories" })).toBeNull();
    expect(screen.getByRole("link", { name: "Newer stories" })).toHaveAttribute("href", "/latest?page=2");
    expect(screen.getByText("Page 3 of 3")).toBeInTheDocument();
  });

  test("a page past the end links back to the last page, even when there is only one page", () => {
    const { rerender } = render(<Pagination page={9} total={45} pageSize={20} basePath="/latest" params={{}} />);
    expect(screen.getByRole("link", { name: "Newer stories" })).toHaveAttribute("href", "/latest?page=3");
    expect(screen.queryByRole("link", { name: "Older stories" })).toBeNull();
    expect(screen.getByText("Page 3 is the last page")).toBeInTheDocument();

    rerender(<Pagination page={4} total={5} pageSize={20} basePath="/search" params={{ q: "flu" }} />);
    expect(screen.getByRole("link", { name: "Newer stories" })).toHaveAttribute("href", "/search?q=flu");

    rerender(<Pagination page={2} total={0} pageSize={20} basePath="/search" params={{ q: "flu" }} />);
    expect(screen.queryByRole("navigation")).toBeNull();
  });

  test("renders nothing when everything fits on one page", () => {
    const { container } = render(<Pagination page={1} total={5} pageSize={20} basePath="/latest" params={{}} />);
    expect(container).toBeEmptyDOMElement();
  });
});
