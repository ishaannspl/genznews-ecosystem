import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { StoryCover } from "./StoryCover";

describe("StoryCover", () => {
  test("shows a category placeholder when src is null and swaps to it on image error, with a fixed aspect-ratio box", () => {
    const { container, unmount } = render(<StoryCover src={null} alt="" category="health-wellness" />);
    let box = container.firstElementChild as HTMLElement;
    expect(box).toHaveAttribute("data-category", "health-wellness");
    expect(box).toHaveAttribute("data-ratio", "16/9");
    expect(box.style.aspectRatio).toBe("16 / 9");
    let placeholder = container.querySelector("[data-placeholder]");
    expect(placeholder).toHaveAttribute("aria-hidden", "true");
    expect(placeholder).toHaveTextContent("Health");
    expect(container.querySelector("img")).toBeNull();
    unmount();

    const r = render(
      <StoryCover src="https://example.com/a.jpg" alt="Crowd at a rally" category="education-career" ratio="4/3" />,
    );
    box = r.container.firstElementChild as HTMLElement;
    expect(box.style.aspectRatio).toBe("4 / 3");
    const img = screen.getByRole("img", { name: "Crowd at a rally" });
    expect(img).toHaveAttribute("loading", "lazy");
    expect(img).toHaveAttribute("decoding", "async");
    expect(img).toHaveAttribute("referrerpolicy", "no-referrer");
    expect(r.container.querySelector("[data-placeholder]")).toBeNull();

    fireEvent.error(img);
    expect(r.container.querySelector("img")).toBeNull();
    placeholder = r.container.querySelector("[data-placeholder]");
    expect(placeholder).toHaveAttribute("aria-hidden", "true");
    expect(placeholder).toHaveTextContent("Education");
  });

  test("priority loads eagerly with high fetch priority", () => {
    render(<StoryCover src="https://example.com/a.jpg" alt="" category="biogas-clean-energy" priority />);
    const img = document.querySelector("img")!;
    expect(img).toHaveAttribute("loading", "eager");
    expect(img).toHaveAttribute("fetchpriority", "high");
  });

  test.each([
    "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=",
    "javascript:alert(1)",
    "//evil.example/a.jpg",
    "/api/revalidate",
    "images/a.jpg",
    "",
    "  https://example.com/a.jpg",
    "mailto:a@example.com",
  ])("test_unsafe_src_renders_the_placeholder: %s", (src) => {
    const { container } = render(<StoryCover src={src} alt="x" category="health-wellness" />);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("[data-placeholder]")).toHaveTextContent("Health");
  });
});
