import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { approveArticle, rejectArticle, saveBody, refresh } = vi.hoisted(() => ({
  approveArticle: vi.fn(),
  rejectArticle: vi.fn(),
  saveBody: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock("@/app/admin/actions/review", () => ({ approveArticle, rejectArticle, saveBody }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import { ReviewActions } from "./ReviewActions";

const ID = "11111111-1111-1111-1111-111111111111";

beforeEach(() => {
  vi.clearAllMocks();
  approveArticle.mockResolvedValue({ ok: true });
  rejectArticle.mockResolvedValue({ ok: true });
  saveBody.mockResolvedValue({ ok: true });
});

describe("ReviewActions", () => {
  it("renders the labelled body field and three controls", () => {
    render(<ReviewActions id={ID} bodyMd="Hello" canReview />);
    expect(screen.getByLabelText("Story body")).toHaveValue("Hello");
    expect(screen.getByLabelText("Story body")).toHaveAttribute("name", "body_md");
    for (const name of ["Save edits", "Approve and publish", "Reject"]) {
      expect(screen.getByRole("button", { name })).toHaveClass("min-h-11");
    }
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("hides approve and reject when the story is not awaiting review", () => {
    render(<ReviewActions id={ID} bodyMd="Hello" canReview={false} />);
    expect(screen.getByRole("button", { name: "Save edits" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Approve and publish" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Reject" })).toBeNull();
  });

  it("calls approve with the id and refreshes on success", async () => {
    render(<ReviewActions id={ID} bodyMd="Hello" canReview />);
    await userEvent.click(screen.getByRole("button", { name: "Approve and publish" }));
    await waitFor(() => expect(approveArticle).toHaveBeenCalledWith(ID));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("shows an action error in an alert region", async () => {
    rejectArticle.mockResolvedValue({ ok: false, error: "This story is no longer waiting for review." });
    render(<ReviewActions id={ID} bodyMd="Hello" canReview />);
    await userEvent.click(screen.getByRole("button", { name: "Reject" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("This story is no longer waiting for review.");
    expect(refresh).not.toHaveBeenCalled();
  });

  it("saves the edited body", async () => {
    render(<ReviewActions id={ID} bodyMd="Hello" canReview />);
    const box = screen.getByLabelText("Story body");
    await userEvent.clear(box);
    await userEvent.type(box, "New text");
    await userEvent.click(screen.getByRole("button", { name: "Save edits" }));
    await waitFor(() => expect(saveBody).toHaveBeenCalled());
    const [id, fd] = saveBody.mock.calls[0] as [string, FormData];
    expect(id).toBe(ID);
    expect(fd.get("body_md")).toBe("New text");
  });

  it("keeps typed text when a save fails", async () => {
    saveBody.mockResolvedValue({ ok: false, error: "Body cannot be empty." });
    render(<ReviewActions id={ID} bodyMd="Hello" canReview />);
    const box = screen.getByLabelText("Story body");
    await userEvent.clear(box);
    await userEvent.type(box, "Typed edits");
    await userEvent.click(screen.getByRole("button", { name: "Save edits" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Body cannot be empty.");
    expect(screen.getByLabelText("Story body")).toHaveValue("Typed edits");
  });

  it("confirms a save with Saved and clears it on the next edit", async () => {
    render(<ReviewActions id={ID} bodyMd="Hello" canReview />);
    expect(screen.queryByRole("status")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Save edits" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Saved");
    expect(refresh).toHaveBeenCalled();
    await userEvent.type(screen.getByLabelText("Story body"), "!");
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("disables the other buttons while an action is pending", async () => {
    let release: (v: { ok: true }) => void = () => {};
    saveBody.mockReturnValue(new Promise((r) => (release = r)));
    render(<ReviewActions id={ID} bodyMd="Hello" canReview />);
    await userEvent.click(screen.getByRole("button", { name: "Save edits" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Approve and publish" })).toBeDisabled());
    expect(screen.getByRole("button", { name: "Reject" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Save edits" })).toBeDisabled();
    release({ ok: true });
    await waitFor(() => expect(screen.getByRole("button", { name: "Reject" })).toBeEnabled());
  });

  it("disables Approve and Reject with a hint while edits are unsaved, and clears it after saving", async () => {
    render(<ReviewActions id={ID} bodyMd="Hello" canReview />);
    expect(screen.getByRole("button", { name: "Approve and publish" })).toBeEnabled();
    await userEvent.type(screen.getByLabelText("Story body"), "!");
    expect(screen.getByRole("button", { name: "Approve and publish" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Reject" })).toBeDisabled();
    expect(screen.getByText("Save your edits first")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Save edits" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Approve and publish" })).toBeEnabled());
    expect(screen.getByRole("button", { name: "Reject" })).toBeEnabled();
    expect(screen.queryByText("Save your edits first")).toBeNull();
  });

  it("stays dirty when the save fails", async () => {
    saveBody.mockResolvedValue({ ok: false, error: "nope" });
    render(<ReviewActions id={ID} bodyMd="Hello" canReview />);
    await userEvent.type(screen.getByLabelText("Story body"), "!");
    await userEvent.click(screen.getByRole("button", { name: "Save edits" }));
    await screen.findByRole("alert");
    expect(screen.getByRole("button", { name: "Approve and publish" })).toBeDisabled();
  });
});
