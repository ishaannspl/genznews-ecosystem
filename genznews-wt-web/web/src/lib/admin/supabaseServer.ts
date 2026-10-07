import "server-only";
import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { readEnv } from "../env";

/**
 * Cookie-session Supabase client for the admin area. Uses only the public anon key; the
 * signed-in admin's JWT (kept in cookies) is what authorizes reads and writes via RLS.
 */
export async function createAdminClient(): Promise<SupabaseClient> {
  const env = readEnv();
  if (env.dataSource !== "supabase") {
    throw new Error("The admin area needs real data: set DATA_SOURCE=supabase in web/.env.local.");
  }
  const store = await cookies();
  return createServerClient(env.supabaseUrl, env.supabaseAnonKey, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          for (const { name, value, options } of list) store.set(name, value, options);
        } catch {
          // Next throws when cookies are set from a Server Component; the session guard refreshes them instead.
        }
      },
    },
  });
}
