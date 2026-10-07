import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { SearchForm } from "./SearchForm";

describe("SearchForm", () => {
  test("SearchForm is a GET form to /search with a labelled input named q", () => {
    render(<SearchForm defaultValue="monsoon" />);
    const form = screen.getByRole("search");
    expect(form.tagName).toBe("FORM");
    expect(form).toHaveAttribute("method", "get");
    expect(form).toHaveAttribute("action", "/search");

    const input = screen.getByLabelText("Search stories");
    expect(input).toHaveAttribute("name", "q");
    expect(input).toHaveAttribute("type", "search");
    expect(input).toHaveAttribute("maxlength", "100");
    expect(input).toHaveValue("monsoon");
    expect(screen.getByRole("button", { name: "Search" })).toHaveAttribute("type", "submit");
  });
});
