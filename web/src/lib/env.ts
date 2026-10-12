import "server-only";

export type WebEnv =
  | { dataSource: "fixtures" }
  | { dataSource: "supabase"; supabaseUrl: string; supabaseAnonKey: string };

function present(v: string | undefined): string | undefined {
  const t = v?.trim();
  return t ? t : undefined;
}

/**
 * Reads the server-side data source configuration. Only the public anon key is ever read here.
 * Error messages name variables but never echo their values.
 */
export function readEnv(source: Record<string, string | undefined> = process.env): WebEnv {
  const raw = present(source.DATA_SOURCE);

  if (raw === undefined) {
    throw new Error(
      "DATA_SOURCE is not set. Set it in web/.env.local: 'supabase' serves real stories; 'fixtures' serves DEMO data and must be chosen explicitly.",
    );
  }
  if (raw === "fixtures") return { dataSource: "fixtures" };
  if (raw !== "supabase") throw new Error("DATA_SOURCE must be 'supabase' (real data) or 'fixtures' (demo data).");

  const url = present(source.SUPABASE_URL);
  if (!url) throw new Error("SUPABASE_URL is required when DATA_SOURCE=supabase.");
  let protocol = "";
  try {
    protocol = new URL(url).protocol;
  } catch {
    protocol = "";
  }
  if (protocol !== "http:" && protocol !== "https:") throw new Error("SUPABASE_URL must be an http(s) URL.");

  const anon = present(source.SUPABASE_ANON_KEY);
  if (!anon) throw new Error("SUPABASE_ANON_KEY is required when DATA_SOURCE=supabase.");

  return { dataSource: "supabase", supabaseUrl: url, supabaseAnonKey: anon };
}
