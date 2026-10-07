import { describe, expect, it } from "vitest";
import { callsOf, fakeSupabase } from "./fakeSupabase";
import { getForReview, listQueue, parseQueueStatus, statusCounts } from "./queue";

const ROW = {
  id: "11111111-1111-4111-8111-111111111111",
  slug: "a-story",
  title: "A story",
  category: "health_wellness",
  status: "REVIEW_REQUIRED",
  confidence: 0.8,
  fact_risk: "low",
  flags: ["x"],
  image_url: "https://img/x.png",
  published_at: null,
  created_at: "2026-10-01T00:00:00Z",
};

describe("parseQueueStatus", () => {
  it("defaults to REVIEW_REQUIRED for unknown values", () => {
    expect(parseQueueStatus("nope")).toBe("REVIEW_REQUIRED");
    expect(parseQueueStatus(undefined)).toBe("REVIEW_REQUIRED");
    expect(parseQueueStatus(["FAILED"])).toBe("REVIEW_REQUIRED");
  });
  it("accepts known statuses", () => {
    expect(parseQueueStatus("PUBLISHED")).toBe("PUBLISHED");
    expect(parseQueueStatus("FAILED")).toBe("FAILED");
  });
});

describe("listQueue", () => {
  it("filters, orders, pages and maps rows", async () => {
    const { client, calls, from } = fakeSupabase({ data: [ROW], count: 41 });
    const out = await listQueue(client, "REVIEW_REQUIRED", 2);
    expect(from).toHaveBeenCalledWith("site_articles");
    expect(callsOf(calls, "select")[0].args[1]).toEqual({ count: "exact" });
    expect(callsOf(calls, "eq")[0].args).toEqual(["status", "REVIEW_REQUIRED"]);
    expect(callsOf(calls, "order").map((c) => c.args)).toEqual([
      ["published_at", { ascending: false, nullsFirst: false }],
      ["created_at", { ascending: false }],
      ["id", { ascending: false }],
    ]);
    expect(callsOf(calls, "range")[0].args).toEqual([20, 39]);
    expect(out.total).toBe(41);
    expect(out.rows[0]).toEqual({
      id: ROW.id,
      slug: "a-story",
      title: "A story",
      category: "health_wellness",
      status: "REVIEW_REQUIRED",
      confidence: 0.8,
      factRisk: "low",
      flags: ["x"],
      imageUrl: "https://img/x.png",
      publishedAt: null,
      createdAt: "2026-10-01T00:00:00Z",
    });
  });

  it("throws a generic error on a Supabase error without echoing its message", async () => {
    const { client } = fakeSupabase({ error: { message: "secret detail" } });
    await expect(listQueue(client, "FAILED", 1)).rejects.toThrow("Could not load the review queue.");
  });

  it("returns an empty page when data is missing", async () => {
    const { client } = fakeSupabase({});
    expect(await listQueue(client, "FAILED", 1)).toEqual({ rows: [], total: 0 });
  });

  it("treats null flags as an empty list and clamps page to 1", async () => {
    const { client, calls } = fakeSupabase({ data: [{ ...ROW, flags: null }], count: 1 });
    const out = await listQueue(client, "APPROVED", 0);
    expect(out.rows[0].flags).toEqual([]);
    expect(callsOf(calls, "range")[0].args).toEqual([0, 19]);
  });
});

describe("getForReview", () => {
  it("maps the extra fields", async () => {
    const { client, calls } = fakeSupabase({
      data: { ...ROW, summary: "s", body_md: "b", source_url: "u", source_name: "n" },
    });
    const out = await getForReview(client, ROW.id);
    expect(callsOf(calls, "eq")[0].args).toEqual(["id", ROW.id]);
    expect(out).toMatchObject({ id: ROW.id, summary: "s", bodyMd: "b", sourceUrl: "u", sourceName: "n" });
  });
  it("returns null when missing, on error, or for a non-uuid id", async () => {
    expect(await getForReview(fakeSupabase({ data: null }).client, ROW.id)).toBeNull();
    expect(await getForReview(fakeSupabase({ error: {} }).client, ROW.id)).toBeNull();
    const f = fakeSupabase({ data: ROW });
    expect(await getForReview(f.client, "not-a-uuid")).toBeNull();
    expect(f.from).not.toHaveBeenCalled();
  });
});

describe("statusCounts", () => {
  it("counts every status with head queries", async () => {
    const { client, calls } = fakeSupabase({ count: 3 });
    const out = await statusCounts(client);
    expect(out).toEqual({ REVIEW_REQUIRED: 3, APPROVED: 3, PUBLISHED: 3, REJECTED: 3, FAILED: 3 });
    expect(callsOf(calls, "select")[0].args[1]).toEqual({ count: "exact", head: true });
    expect(callsOf(calls, "eq")).toHaveLength(5);
  });
  it("throws on a Supabase error", async () => {
    await expect(statusCounts(fakeSupabase({ error: { message: "secret" } }).client)).rejects.toThrow(
      "Could not load queue counts.",
    );
  });
  it("uses 0 when a count is unavailable", async () => {
    const out = await statusCounts(fakeSupabase({}).client);
    expect(out.PUBLISHED).toBe(0);
  });
});
