import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/admin/actions/review", () => ({
  approveArticle: vi.fn(async () => ({ ok: true })),
  rejectArticle: vi.fn(async () => ({ ok: true })),
  saveBody: vi.fn(async () => ({ ok: true })),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { QueueTable } from "./QueueTable";
import type { QueueRow } from "@/lib/admin/queue";

const row = (over: Partial<QueueRow>): QueueRow => ({
  id: "11111111-1111-1111-1111-111111111111",
  slug: "s",
  title: "A story",
  category: "health_wellness",
  status: "REVIEW_REQUIRED",
  confidence: 0.82,
  factRisk: "LOW",
  flags: ["A:1", "B:2"],
  imageUrl: null,
  publishedAt: null,
  createdAt: "2026-10-06T00:00:00Z",
  ...over,
});

describe("QueueTable", () => {
  it("renders one row per story linking to its detail page", () => {
    render(
      <QueueTable
        rows={[row({}), row({ id: "22222222-2222-2222-2222-222222222222", title: "Another" })]}
        now={new Date("2026-10-06T02:00:00Z")}
      />,
    );
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByRole("link", { name: "A story" })).toHaveAttribute(
      "href",
      "/admin/11111111-1111-1111-1111-111111111111",
    );
    expect(screen.getAllByText("2 hours ago")).toHaveLength(2);
    expect(screen.getAllByText(/2 flags/)).toHaveLength(2);
    expect(screen.getAllByText("Health and wellness")).toHaveLength(2);
  });

  it("shows Approve only for REVIEW_REQUIRED and APPROVED", () => {
    const statuses = ["REVIEW_REQUIRED", "APPROVED", "PUBLISHED", "REJECTED", "FAILED"];
    render(
      <QueueTable
        rows={statuses.map((status, i) => row({ id: `3333333${i}-3333-3333-3333-333333333333`, title: status, status }))}
      />,
    );
    expect(screen.getAllByRole("button", { name: /^Approve/ })).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Approve REVIEW_REQUIRED" })).toHaveClass("min-h-11");
    expect(screen.queryByRole("button", { name: "Approve PUBLISHED" })).toBeNull();
  });

  it("shows an empty state when there are no rows", () => {
    render(<QueueTable rows={[]} />);
    expect(screen.getByText("No stories in this queue.")).toBeInTheDocument();
    expect(screen.queryByRole("list")).toBeNull();
  });
});
