import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import { createAdminClient } from "./supabaseServer";

/**
 * Resolves the signed-in admin, or null. getUser() validates the token with the auth server
 * (getSession() would trust the cookie). Any auth error or thrown error counts as "not signed in".
 * Allowlist membership is checked through RLS: a user can read only their own admin_emails row.
 */
export async function getAdmin(client: SupabaseClient): Promise<{ email: string } | null> {
  try {
    const { data, error } = await client.auth.getUser();
    const email = data?.user?.email;
    if (error || !email) return null;
    const { data: row } = await client.from("admin_emails").select("email").eq("email", email).maybeSingle();
    return row ? { email } : null;
  } catch {
    return null;
  }
}

export async function requireAdmin(): Promise<{ client: SupabaseClient; email: string }> {
  let client: SupabaseClient;
  let admin: { email: string } | null;
  try {
    client = await createAdminClient();
    admin = await getAdmin(client);
  } catch {
    redirect("/admin/login");
  }
  if (!admin) redirect("/admin/login");
  return { client, email: admin.email };
}
