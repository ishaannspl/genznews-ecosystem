import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FlagList } from "./FlagList";

describe("FlagList", () => {
  it("renders nothing for an empty list", () => {
    const { container } = render(<FlagList flags={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("groups flags by prefix with a count and the values", () => {
    render(<FlagList flags={["UNGROUNDED_ENTITY:Keep", "UNGROUNDED_ENTITY:Plus", "UNGROUNDED_NUMBER:42"]} />);
    expect(screen.getAllByRole("heading", { level: 3 })).toHaveLength(2);
    expect(screen.getByRole("heading", { name: "UNGROUNDED_ENTITY (2)" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "UNGROUNDED_NUMBER (1)" })).toBeInTheDocument();
    expect(screen.getByText("Keep")).toBeInTheDocument();
    expect(screen.getByText("Plus")).toBeInTheDocument();
    expect(screen.getByText("42")).toBeInTheDocument();
  });

  it("keeps colons inside the value and handles flags without a value", () => {
    render(<FlagList flags={["CLAIM_QUOTE_MISSING:said: hi", "NO_VALUE"]} />);
    expect(screen.getByText("said: hi")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "NO_VALUE (1)" })).toBeInTheDocument();
  });
});
