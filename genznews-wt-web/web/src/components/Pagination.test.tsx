import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { Pagination } from "./Pagination";

function hrefOf(name: string): URL {
  return new URL(screen.getByRole("link", { name }).getAttribute("href")!, "http://x");
}

function labels(): string[] {
  return [...screen.getByRole("navigation", { name: "Pagination" }).firstElementChild!.children].map(
    (el) => el.textContent ?? "",
  );
}

describe("Pagination", () => {
  test("numbered links keep other query params; page 1 drops the page param; current page is not a link", () => {
    const params = { q: "flu shots", tag: ["a", "b"], page: "2" };
    render(<Pagination page={2} total={45} pageSize={20} basePath="/search" params={params} />);
    expect(labels()).toEqual(["Prev", "1", "2", "3", "Next"]);
    expect(screen.getByText("2")).toHaveAttribute("aria-current", "page");
    expect(screen.queryByRole("link", { name: "Page 2" })).toBeNull();

    const three = hrefOf("Page 3");
    expect(three.pathname).toBe("/search");
    expect(three.searchParams.get("q")).toBe("flu shots");
    expect(three.searchParams.getAll("tag")).toEqual(["a", "b"]);
    expect(three.searchParams.get("page")).toBe("3");
    expect(hrefOf("Next").searchParams.get("page")).toBe("3");
    expect(hrefOf("Page 1").searchParams.has("page")).toBe(false);
    expect(hrefOf("Prev").searchParams.has("page")).toBe(false);
  });

  test("no Prev on page 1 and no Next on the last page", () => {
    const { rerender } = render(<Pagination page={1} total={45} pageSize={20} basePath="/latest" params={{}} />);
    expect(screen.queryByRole("link", { name: "Prev" })).toBeNull();
    expect(screen.getByRole("link", { name: "Next" })).toHaveAttribute("href", "/latest?page=2");
    rerender(<Pagination page={3} total={45} pageSize={20} basePath="/latest" params={{}} />);
    expect(screen.queryByRole("link", { name: "Next" })).toBeNull();
    expect(screen.getByRole("link", { name: "Prev" })).toHaveAttribute("href", "/latest?page=2");
  });

  test("long ranges collapse with ellipses", () => {
    const { rerender } = render(<Pagination page={1} total={240} pageSize={20} basePath="/latest" params={{}} />);
    expect(labels()).toEqual(["1", "2", "3", "4", "5", "…", "12", "Next"]);
    rerender(<Pagination page={7} total={240} pageSize={20} basePath="/latest" params={{}} />);
    expect(labels()).toEqual(["Prev", "1", "…", "6", "7", "8", "…", "12", "Next"]);
    rerender(<Pagination page={12} total={240} pageSize={20} basePath="/latest" params={{}} />);
    expect(labels()).toEqual(["Prev", "1", "…", "8", "9", "10", "11", "12"]);
  });

  test("a page past the end highlights nothing, links back, and says so", () => {
    const { rerender } = render(<Pagination page={9} total={45} pageSize={20} basePath="/latest" params={{}} />);
    expect(screen.getByRole("link", { name: "Page 3" })).toHaveAttribute("href", "/latest?page=3");
    expect(screen.getByText("Page 3 is the last page")).toBeInTheDocument();
    expect(document.querySelector("[aria-current]")).toBeNull();

    rerender(<Pagination page={4} total={5} pageSize={20} basePath="/search" params={{ q: "flu" }} />);
    expect(screen.getByRole("link", { name: "Page 1" })).toHaveAttribute("href", "/search?q=flu");

    rerender(<Pagination page={2} total={0} pageSize={20} basePath="/search" params={{ q: "flu" }} />);
    expect(screen.queryByRole("navigation")).toBeNull();
  });

  test("renders nothing when everything fits on one page", () => {
    const { container } = render(<Pagination page={1} total={5} pageSize={20} basePath="/latest" params={{}} />);
    expect(container).toBeEmptyDOMElement();
  });
});
