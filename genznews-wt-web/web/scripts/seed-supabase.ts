/**
 * Dev-only: upserts the fixture articles into public.site_articles as PUBLISHED rows.
 *
 *   SUPABASE_URL=... SUPABASE_SERVICE_KEY=... npm run seed:supabase -- --yes
 *
 * The privileged key is read from the environment at run time and never printed.
 * It is not used anywhere under src/.
 */
import { createClient } from "@supabase/supabase-js";
import data from "../src/lib/fixtures/articles.json";
import type { Article } from "../src/lib/types";
import { redact } from "../src/lib/dataLog";
import { articleToRow } from "../src/lib/repositories/supabaseRepository";

async function main(): Promise<void> {
  if (!process.argv.includes("--yes")) {
    console.error("Refusing to run without --yes. This writes fixture rows to the database named by SUPABASE_URL.");
    process.exit(1);
  }
  for (const name of ["SUPABASE_URL", "SUPABASE_SERVICE_KEY"]) {
    if (!process.env[name]?.trim()) {
      console.error(`Missing required environment variable ${name}.`);
      process.exit(1);
    }
  }
  const client = createClient(process.env.SUPABASE_URL!.trim(), process.env.SUPABASE_SERVICE_KEY!.trim(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Two fixtures can share a source URL; one upsert batch cannot touch the same url_hash twice.
  const byHash = new Map<string, Record<string, unknown>>();
  for (const a of data as Article[]) {
    const r = articleToRow(a);
    byHash.set(r.url_hash as string, r);
  }
  const rows = [...byHash.values()];
  const { error } = await client.from("site_articles").upsert(rows, { onConflict: "url_hash" });
  if (error) {
    // Server messages can echo request details; anything that looks like a key is masked.
    console.error(`Seeding failed: ${redact(error.message)}`);
    process.exit(1);
  }
  console.log(`Upserted ${rows.length} fixture articles as PUBLISHED.`);
}

main().catch((e: unknown) => {
  console.error(`Seeding failed: ${e instanceof Error ? redact(e.message) : "unknown error"}`);
  process.exit(1);
});
