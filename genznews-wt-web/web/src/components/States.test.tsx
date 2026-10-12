import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { EmptyState } from "./EmptyState";
import { ErrorState } from "./ErrorState";

describe("EmptyState and ErrorState", () => {
  test('EmptyState and ErrorState use the exact copy from the design direction and have role="status" and role="alert" respectively', () => {
    render(
      <>
        <EmptyState />
        <ErrorState />
      </>,
    );
    expect(screen.getByRole("status")).toHaveTextContent(/^No stories here yet\. New ones land after each review\.$/);
    expect(screen.getByRole("alert")).toHaveTextContent(
      /^We couldn't load stories\. Refresh the page, or try again in a minute\.$/,
    );
  });

  test("a custom title replaces the empty copy", () => {
    render(<EmptyState title="No stories match that search. Try fewer words." />);
    expect(screen.getByRole("status")).toHaveTextContent("No stories match that search. Try fewer words.");
  });
});
