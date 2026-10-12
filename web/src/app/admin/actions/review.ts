"use server";

import { revalidatePath } from "next/cache";
import { categoryByNicheKey } from "@/lib/categories";
import { removeEmDashes } from "@/lib/removeEmDashes";
import { requireAdmin } from "@/lib/admin/session";
import { UUID_RE } from "@/lib/admin/queue";

export type ActionResult = { ok: true } | { ok: false; error: string };

const GONE: ActionResult = { ok: false, error: "This story is no longer waiting for review." };
const GENERIC: ActionResult = { ok: false, error: "Something went wrong. Try again." };
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
