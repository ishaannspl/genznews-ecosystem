import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

export type QueueStatus = "REVIEW_REQUIRED" | "APPROVED" | "PUBLISHED" | "REJECTED" | "FAILED";

const STATUSES: readonly QueueStatus[] = ["REVIEW_REQUIRED", "APPROVED", "PUBLISHED", "REJECTED", "FAILED"];

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseQueueStatus(value: unknown): QueueStatus {
  return STATUSES.find((s) => s === value) ?? "REVIEW_REQUIRED";
}

export type QueueRow = {
  id: string;
  slug: string | null;
  title: string | null;
  category: string | null;
  status: string;
  confidence: number | null;
  factRisk: string | null;
  flags: string[];
  imageUrl: string | null;
  publishedAt: string | null;
  createdAt: string;
};

export type ReviewArticle = QueueRow & {
  summary: string | null;
  bodyMd: string | null;
  sourceUrl: string | null;
  sourceName: string | null;
};

type DbRow = {
  id: string;
  slug: string | null;
  title: string | null;
  category: string | null;
  status: string;
  confidence: number | null;
  fact_risk: string | null;
  flags: string[] | null;
  image_url: string | null;
  published_at: string | null;
  created_at: string;
};

type DbReviewRow = DbRow & {
  summary: string | null;
  body_md: string | null;
  source_url: string | null;
  source_name: string | null;
};

const LIST_COLUMNS = "id, slug, title, category, status, confidence, fact_risk, flags, image_url, published_at, created_at";
const REVIEW_COLUMNS = `${LIST_COLUMNS}, summary, body_md, source_url, source_name`;

function toQueueRow(r: DbRow): QueueRow {
  return {
    id: r.id,
    slug: r.slug,
    title: r.title,
    category: r.category,
    status: r.status,
    confidence: r.confidence,
    factRisk: r.fact_risk,
    flags: r.flags ?? [],
    imageUrl: r.image_url,
    publishedAt: r.published_at,
    createdAt: r.created_at,
  };
}

export async function listQueue(
  client: SupabaseClient,
  status: QueueStatus,
  page: number,
  pageSize = 20,
): Promise<{ rows: QueueRow[]; total: number }> {
  const p = Number.isFinite(page) && page >= 1 ? Math.floor(page) : 1;
  const from = (p - 1) * pageSize;
  const { data, error, count } = await client
    .from("site_articles")
    .select(LIST_COLUMNS, { count: "exact" })
    .eq("status", status)
    .order("published_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range(from, from + pageSize - 1);
  if (error) throw new Error("Could not load the review queue.");
  if (!data) return { rows: [], total: 0 };
  return { rows: (data as DbRow[]).map(toQueueRow), total: count ?? 0 };
}

export async function getForReview(client: SupabaseClient, id: string): Promise<ReviewArticle | null> {
  if (!UUID_RE.test(id)) return null;
  const { data, error } = await client.from("site_articles").select(REVIEW_COLUMNS).eq("id", id).maybeSingle();
  if (error || !data) return null;
  const r = data as DbReviewRow;
  return { ...toQueueRow(r), summary: r.summary, bodyMd: r.body_md, sourceUrl: r.source_url, sourceName: r.source_name };
}

export async function statusCounts(client: SupabaseClient): Promise<Record<QueueStatus, number>> {
  const entries = await Promise.all(
    STATUSES.map(async (s) => {
      const { count, error } = await client
        .from("site_articles")
        .select("id", { count: "exact", head: true })
        .eq("status", s);
      if (error) throw new Error("Could not load queue counts.");
      return [s, count ?? 0] as const;
    }),
  );
  return Object.fromEntries(entries) as Record<QueueStatus, number>;
}
