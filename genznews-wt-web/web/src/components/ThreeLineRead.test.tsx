import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { ThreeLineRead } from "./ThreeLineRead";

const LINES = ["First line.", "Second line.", "Third line."];

describe("ThreeLineRead", () => {
  test("renders one list item per line with the marker class and renders nothing for an empty list", () => {
    const { container, rerender } = render(<ThreeLineRead lines={LINES} />);
    const list = screen.getByRole("list");
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(3);
    items.forEach((li, i) => {
      const marker = li.querySelector(".marker");
      expect(marker).not.toBeNull();
      expect(marker).toHaveTextContent(LINES[i]);
    });
    expect(list).not.toHaveAttribute("data-animate");

    rerender(<ThreeLineRead lines={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  test("animate sets the reveal hook and a stagger index per line", () => {
    render(<ThreeLineRead lines={LINES} animate size="lg" />);
    const list = screen.getByRole("list");
    expect(list).toHaveAttribute("data-animate", "true");
    expect(list).toHaveAttribute("data-size", "lg");
    const items = screen.getAllByRole("listitem");
    expect(items.map((li) => li.style.getPropertyValue("--i"))).toEqual(["0", "1", "2"]);
  });

  test("blank lines are skipped", () => {
    render(<ThreeLineRead lines={["One.", "   ", "Two."]} />);
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  test("test_lines_are_plain_text_markup_removed", () => {
    render(
      <ThreeLineRead
        lines={["See [the report](https://x.example) now.", "**Big** _news_ in `C#` and snake_case.", "<em>Third</em> line."]}
      />,
    );
    expect(screen.getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "See the report now.",
      "Big news in C# and snake_case.",
      "Third line.",
    ]);
    expect(screen.queryByRole("link")).toBeNull();
  });

  test("test_label_is_generic_and_two_or_four_lines_stay_as_found", () => {
    const { rerender } = render(<ThreeLineRead lines={["One.", "Two."]} />);
    expect(screen.getByRole("list")).toHaveAttribute("aria-label", "Summary in short lines");
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    rerender(<ThreeLineRead lines={["One.", "Two.", "Three.", "Four."]} />);
    expect(screen.getAllByRole("listitem")).toHaveLength(4);
  });

  test("test_a_line_that_is_only_markup_is_skipped", () => {
    render(<ThreeLineRead lines={["One.", "<br>", "<span></span>"]} />);
    expect(screen.getAllByRole("listitem").map((li) => li.textContent)).toEqual(["One."]);
  });
});
