import { render } from "@testing-library/react";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { ERROR_COPY } from "@/components/ErrorState";
import { RepositoryError, type ArticleRepository } from "@/lib/repository";

// A repository whose every read fails the way the Supabase one does when the database is down.
const SECRET = "http://127.0.0.1:9/rest/v1/site_articles?select=secret";
function failing(): never {
  throw new RepositoryError(`Supabase list failed: connect ECONNREFUSED ${SECRET}`);
}
const stub: ArticleRepository = {
  getBySlug: vi.fn(async () => failing()),
  list: vi.fn(async () => failing()),
  search: vi.fn(async () => failing()),
  related: vi.fn(async () => failing()),
  allSlugs: vi.fn(async () => failing()),
};

vi.mock("@/lib/repositories", () => ({ getRepository: () => stub }));
// Server-only navigation helpers are not needed for these paths, but keep notFound observable.
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));

const { default: LatestPage } = await import("./latest/page");
const { default: CategoryPage } = await import("./category/[slug]/page");
const { default: SearchPage } = await import("./search/page");
const { default: ArticlePage } = await import("./article/[slug]/page");
const { default: HomePage } = await import("./page");

function expectInlineError(el: ReactElement) {
  const { container } = render(el);
  const alert = container.querySelector('[role="alert"]');
  expect(alert).not.toBeNull();
  expect(alert).toHaveTextContent(ERROR_COPY);
  const text = container.textContent ?? "";
  expect(text).not.toContain("127.0.0.1");
  expect(text).not.toContain("ECONNREFUSED");
  expect(text).not.toContain("Supabase");
  expect(container.innerHTML).not.toMatch(/at \w+ \(|\.tsx?:\d+/);
  // Exactly one h1 stays on the page.
  expect(container.querySelectorAll("h1")).toHaveLength(1);
}

describe("pages when the repository fails", () => {
  beforeEach(() => vi.clearAllMocks());

  test("/latest renders the error state inline", async () => {
    expectInlineError(await LatestPage({ searchParams: Promise.resolve({ page: "2" }) }));
  });

  test("/category/[slug] renders the error state inline", async () => {
    expectInlineError(
      await CategoryPage({ params: Promise.resolve({ slug: "health-wellness" }), searchParams: Promise.resolve({}) }),
    );
  });

  test("/search with a query renders the error state inline, keeping the form", async () => {
    const el = await SearchPage({ searchParams: Promise.resolve({ q: "a" }) });
    expectInlineError(el);
    const { container } = render(el);
    expect(container.querySelector('input[name="q"]')).toHaveValue("a");
  });

  test("home throws, so ISR keeps the last good home page and never caches an error page", async () => {
    await expect(HomePage()).rejects.toBeInstanceOf(RepositoryError);
  });

  test("other error types still propagate from home", async () => {
    vi.mocked(stub.list).mockImplementation(async () => {
      throw new TypeError("boom");
    });
    await expect(HomePage()).rejects.toBeInstanceOf(TypeError);
    vi.mocked(stub.list).mockImplementation(async () => failing());
  });

  test("/article/[slug] still throws, so ISR keeps the last good page and never caches an error", async () => {
    await expect(ArticlePage({ params: Promise.resolve({ slug: "anything" }) })).rejects.toBeInstanceOf(
      RepositoryError,
    );
  });

  test("other error types are not swallowed", async () => {
    vi.mocked(stub.list).mockImplementationOnce(async () => {
      throw new TypeError("boom");
    });
    await expect(LatestPage({ searchParams: Promise.resolve({}) })).rejects.toBeInstanceOf(TypeError);
  });
});
