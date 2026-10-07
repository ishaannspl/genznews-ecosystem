import { beforeEach, describe, expect, it, vi } from "vitest";
import { callsOf, fakeSupabase } from "@/lib/admin/fakeSupabase";

const { requireAdmin, revalidatePath } = vi.hoisted(() => ({ requireAdmin: vi.fn(), revalidatePath: vi.fn() }));
vi.mock("@/lib/admin/session", () => ({ requireAdmin }));
vi.mock("next/cache", () => ({ revalidatePath }));

import { approveArticle, rejectArticle, saveBody } from "./review";

const ID = "11111111-1111-4111-8111-111111111111";
const GONE = { ok: false, error: "This story is no longer waiting for review." };
const GENERIC = { ok: false, error: "Something went wrong. Try again." };
const row = { id: ID, slug: "a-story", category: "health_wellness", status: "PUBLISHED" };

function setup(result: Parameters<typeof fakeSupabase>[0]) {
  const f = fakeSupabase(result);
  requireAdmin.mockResolvedValue({ client: f.client, email: "admin@nuformsocial.com" });
  return f;
}
function form(body: unknown): FormData {
  const f = new FormData();
  if (body !== undefined) f.set("body_md", body as string);
  return f;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("approveArticle", () => {
  it("publishes, records the reviewer, keeps published_at, and revalidates", async () => {
    const { client, calls } = setup({ data: [row] });
    expect(client).toBeDefined();
    expect(await approveArticle(ID)).toEqual({ ok: true });
    const patch = callsOf(calls, "update")[0].args[0] as Record<string, unknown>;
    expect(patch).toMatchObject({ status: "PUBLISHED", reviewed_by: "admin@nuformsocial.com" });
    expect(Number.isNaN(Date.parse(patch.reviewed_at as string))).toBe(false);
    expect(patch).not.toHaveProperty("published_at");
    expect(callsOf(calls, "eq")[0].args).toEqual(["id", ID]);
    expect(callsOf(calls, "in")[0].args).toEqual(["status", ["REVIEW_REQUIRED", "APPROVED"]]);
    expect(callsOf(calls, "select")[0].args).toEqual(["id, slug, category"]);
    expect(revalidatePath.mock.calls.map((c) => c[0])).toEqual([
      "/",
      "/latest",
      "/article/a-story",
      "/category/health-wellness",
      "/sitemap.xml",
    ]);
  });

  it("skips slug and unknown category paths", async () => {
    setup({ data: [{ id: ID, slug: null, category: "unknown_key" }] });
    expect(await approveArticle(ID)).toEqual({ ok: true });
    expect(revalidatePath.mock.calls.map((c) => c[0])).toEqual(["/", "/latest", "/sitemap.xml"]);
  });

  it("returns the not-waiting error and does not revalidate on zero rows", async () => {
    setup({ data: [] });
    expect(await approveArticle(ID)).toEqual(GONE);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("returns a generic error for DB errors without leaking the message", async () => {
    setup({ error: { message: "secret table detail" } });
    const res = await approveArticle(ID);
    expect(res).toEqual(GENERIC);
    expect(JSON.stringify(res)).not.toContain("secret");
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("rejects a non-uuid id before any query", async () => {
    const { from } = setup({ data: [row] });
    expect(await approveArticle("1; drop table")).toEqual(GENERIC);
    expect(from).not.toHaveBeenCalled();
  });
});

describe("rejectArticle", () => {
  it("rejects with reviewer fields and no revalidation", async () => {
    const { calls } = setup({ data: [row] });
    expect(await rejectArticle(ID)).toEqual({ ok: true });
    expect(callsOf(calls, "update")[0].args[0]).toMatchObject({ status: "REJECTED", reviewed_by: "admin@nuformsocial.com" });
    expect(callsOf(calls, "in")[0].args).toEqual(["status", ["REVIEW_REQUIRED", "APPROVED"]]);
    expect(revalidatePath).not.toHaveBeenCalled();
  });
  it("returns the not-waiting error on zero rows", async () => {
    setup({ data: [] });
    expect(await rejectArticle(ID)).toEqual(GONE);
  });
  it("returns generic error on DB error and on a bad id", async () => {
    setup({ error: { message: "x" } });
    expect(await rejectArticle(ID)).toEqual(GENERIC);
    const { from } = setup({ data: [row] });
    expect(await rejectArticle("nope")).toEqual(GENERIC);
    expect(from).not.toHaveBeenCalled();
  });
});

describe("saveBody", () => {
  it("replaces em-dashes, only edits settled statuses, and revalidates a published article", async () => {
    const { calls } = setup({ data: [row] });
    expect(await saveBody(ID, form("  one—Two  "))).toEqual({ ok: true });
    expect(callsOf(calls, "update")[0].args[0]).toEqual({ body_md: "one: Two" });
    expect(callsOf(calls, "in")[0].args).toEqual(["status", ["REVIEW_REQUIRED", "APPROVED", "PUBLISHED", "REJECTED"]]);
    expect(callsOf(calls, "select")[0].args).toEqual(["id, slug, category, status"]);
    expect(revalidatePath.mock.calls.map((c) => c[0])).toEqual(["/article/a-story"]);
  });
  it("does not revalidate an unpublished row", async () => {
    setup({ data: [{ ...row, status: "REVIEW_REQUIRED" }] });
    expect(await saveBody(ID, form("text"))).toEqual({ ok: true });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
  it("refuses an empty or non-string body without querying", async () => {
    const { from } = setup({ data: [row] });
    expect(await saveBody(ID, form("   "))).toEqual({ ok: false, error: "Body cannot be empty." });
    expect(await saveBody(ID, form(undefined))).toEqual({ ok: false, error: "Body cannot be empty." });
    expect(from).not.toHaveBeenCalled();
  });
  it("returns not-waiting on zero rows and generic on DB error or bad id", async () => {
    setup({ data: [] });
    expect(await saveBody(ID, form("x"))).toEqual(GONE);
    setup({ error: {} });
    expect(await saveBody(ID, form("x"))).toEqual(GENERIC);
    expect(await saveBody("bad", form("x"))).toEqual(GENERIC);
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe("requireAdmin redirect", () => {
  it("stops every action before touching anything", async () => {
    const f = fakeSupabase({ data: [row] });
    requireAdmin.mockRejectedValue(new Error("REDIRECT:/admin/login"));
    await expect(approveArticle(ID)).rejects.toThrow("REDIRECT");
    await expect(rejectArticle(ID)).rejects.toThrow("REDIRECT");
    await expect(saveBody(ID, form("x"))).rejects.toThrow("REDIRECT");
    expect(f.from).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
