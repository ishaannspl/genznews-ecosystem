import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("../actions/auth", () => ({ login: vi.fn(async () => ({})) }));

import { LoginForm } from "./LoginForm";

describe("LoginForm", () => {
  it("renders labelled email and password fields", () => {
    render(<LoginForm next="/admin" />);
    expect(screen.getByLabelText("Email")).toHaveAttribute("type", "email");
    const pw = screen.getByLabelText("Password");
    expect(pw).toHaveAttribute("type", "password");
    expect(pw).toHaveAttribute("autocomplete", "current-password");
    expect(screen.getByRole("button", { name: "Sign in" })).toHaveClass("min-h-11");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("carries next in a hidden field", () => {
    const { container } = render(<LoginForm next="/admin/x" />);
    expect(container.querySelector('input[name="next"]')).toHaveValue("/admin/x");
  });

  it("shows an error in an alert region", () => {
    render(<LoginForm next="/admin" initialError="Email or password is incorrect." />);
    expect(screen.getByRole("alert")).toHaveTextContent("Email or password is incorrect.");
  });
});
