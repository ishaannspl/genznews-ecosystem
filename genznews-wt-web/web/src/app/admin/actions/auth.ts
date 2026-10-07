"use server";

import { redirect } from "next/navigation";
import { getAdmin } from "@/lib/admin/session";
import { safeNext } from "@/lib/admin/safeNext";
import { createAdminClient } from "@/lib/admin/supabaseServer";

export type LoginState = { error?: string };

const GENERIC: LoginState = { error: "Email or password is incorrect." };

export async function login(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = formData.get("email");
  const password = formData.get("password");
  if (typeof email !== "string" || typeof password !== "string" || !email || !password) return GENERIC;

  // Every failure, including an unlisted user, gets the same message. No error text is logged or returned.
  try {
    const client = await createAdminClient();
    const { error } = await client.auth.signInWithPassword({ email, password });
    if (error) return GENERIC;
    if (!(await getAdmin(client))) {
      await client.auth.signOut();
      return GENERIC;
    }
  } catch {
    return GENERIC;
  }
  redirect(safeNext(formData.get("next")));
}

export async function logout(): Promise<void> {
  try {
    const client = await createAdminClient();
    await client.auth.signOut();
  } catch {
    // Nothing to clear if there is no session or client.
  }
  redirect("/admin/login");
}
