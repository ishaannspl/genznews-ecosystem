"use server";

import { revalidatePath } from "next/cache";
import { categoryByNicheKey } from "@/lib/categories";
import { removeEmDashes } from "@/lib/removeEmDashes";
import { requireAdmin } from "@/lib/admin/session";
import { UUID_RE } from "@/lib/admin/queue";

export type ActionResult = { ok: true } | { ok: false; error: string };

const GONE: Extract<ActionResult, { ok: false }> = { ok: false, error: "This story is no longer waiting for review." };
const GENERIC: Extract<ActionResult, { ok: false }> = { ok: false, error: "Something went wrong. Try again." };
const WAITING = ["REVIEW_REQUIRED", "APPROVED"];
const EDITABLE = ["REVIEW_REQUIRED", "APPROVED", "PUBLISHED", "REJECTED"];

type Changed = { id: string; slug: string | null; category: string | null; status?: string };

export async function approveArticle(id: string): Promise<ActionResult> {
  const { client, email } = await requireAdmin();
  if (typeof id !== "string" || !UUID_RE.test(id)) return GENERIC;
  const { data, error } = await client
    .from("site_articles")
    .update({ status: "PUBLISHED", reviewed_by: email, reviewed_at: new Date().toISOString() })
    .eq("id", id)
    .in("status", WAITING)
    .select("id, slug, category");
  if (error) return GENERIC;
  const row = (data as Changed[] | null)?.[0];
  if (!row) return GONE;
  revalidatePath("/");
  revalidatePath("/latest");
  if (row.slug) revalidatePath(`/article/${row.slug}`);
  const category = row.category ? categoryByNicheKey(row.category) : undefined;
  if (category) revalidatePath(`/category/${category.slug}`);
  revalidatePath("/sitemap.xml");
  return { ok: true };
}

export async function rejectArticle(id: string): Promise<ActionResult> {
  const { client, email } = await requireAdmin();
  if (typeof id !== "string" || !UUID_RE.test(id)) return GENERIC;
  const { data, error } = await client
    .from("site_articles")
    .update({ status: "REJECTED", reviewed_by: email, reviewed_at: new Date().toISOString() })
    .eq("id", id)
    .in("status", WAITING)
    .select("id, slug, category");
  if (error) return GENERIC;
  if (!(data as Changed[] | null)?.length) return GONE;
  return { ok: true };
}

export type BulkResult = { ok: true; count: number } | { ok: false; error: string };

const MAX_BULK = 100;

async function reviewMany(ids: string[], status: "PUBLISHED" | "REJECTED"): Promise<BulkResult> {
  const { client, email } = await requireAdmin();
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > MAX_BULK) return GENERIC;
  const unique = [...new Set(ids)];
  if (!unique.every((id) => typeof id === "string" && UUID_RE.test(id))) return GENERIC;
  const { data, error } = await client
    .from("site_articles")
    .update({ status, reviewed_by: email, reviewed_at: new Date().toISOString() })
    .in("id", unique)
    .in("status", WAITING)
    .select("id, slug, category");
  if (error) return GENERIC;
  const rows = (data as Changed[] | null) ?? [];
  if (rows.length === 0) return GONE;
  if (status === "PUBLISHED") {
    revalidatePath("/");
    revalidatePath("/latest");
    for (const row of rows) {
      if (row.slug) revalidatePath(`/article/${row.slug}`);
      const category = row.category ? categoryByNicheKey(row.category) : undefined;
      if (category) revalidatePath(`/category/${category.slug}`);
    }
    revalidatePath("/sitemap.xml");
  }
  return { ok: true, count: rows.length };
}

export async function approveArticles(ids: string[]): Promise<BulkResult> {
  return reviewMany(ids, "PUBLISHED");
}

export async function rejectArticles(ids: string[]): Promise<BulkResult> {
  return reviewMany(ids, "REJECTED");
}

export async function saveBody(id: string, formData: FormData): Promise<ActionResult> {
  const { client } = await requireAdmin();
  if (typeof id !== "string" || !UUID_RE.test(id)) return GENERIC;
  const raw = formData.get("body_md");
  const body = typeof raw === "string" ? removeEmDashes(raw.trim()) : "";
  if (!body) return { ok: false, error: "Body cannot be empty." };
  const { data, error } = await client
    .from("site_articles")
    .update({ body_md: body })
    .eq("id", id)
    .in("status", EDITABLE)
    .select("id, slug, category, status");
  if (error) return GENERIC;
  const row = (data as Changed[] | null)?.[0];
  if (!row) return GONE;
  if (row.status === "PUBLISHED" && row.slug) revalidatePath(`/article/${row.slug}`);
  return { ok: true };
}
