import "server-only";
import { dataLogEnabled, hostOf, logData, logFailure } from "../dataLog";
import { readEnv } from "../env";
import { explainDataError } from "../explainError";
import fixtureData from "../fixtures/articles.json";
import type { ArticleRepository } from "../repository";
import { createFixtureRepository } from "./fixtureRepository";
import { withDataLogging } from "./loggingRepository";
import { checkConnection, createSupabaseClient, createSupabaseRepository, type SupabaseLike } from "./supabaseRepository";

let cached: ArticleRepository | undefined;

// Next dev can evaluate this module more than once per process, so the "banner already
// printed" flag lives on globalThis rather than in module state.
const ANNOUNCED = Symbol.for("genznews.dataSourceAnnounced");
type Flagged = { [ANNOUNCED]?: boolean };

function firstAnnouncement(): boolean {
  const g = globalThis as Flagged;
  if (g[ANNOUNCED]) return false;
  g[ANNOUNCED] = true;
  return true;
}

/**
 * Runs the startup probe and logs the outcome: `connected: N published rows` only when the table
 * answered ok, otherwise `connection check failed` with the reason and hint. Never throws.
 */
export async function runConnectionCheck(client: SupabaseLike): Promise<void> {
  const started = performance.now();
  try {
    const { publishedRows } = await checkConnection(client);
    logData("data", `connected: ${publishedRows} published rows`, { duration: `${Math.round(performance.now() - started)}ms` });
  } catch (error) {
    try {
      const why = explainDataError(error);
      logFailure("data", "connection check failed", { reason: why.reason, hint: why.hint, code: why.code });
    } catch {
      // Logging never breaks a request.
    }
  }
}

/** Fire-and-forget: never awaited by a request, never throws, never leaves a rejection. */
function startConnectionCheck(client: SupabaseLike): void {
  try {
    runConnectionCheck(client).catch(() => {});
  } catch {
    // A synchronous failure while starting the probe must not break the request either.
  }
}

export function getRepository(): ArticleRepository {
  if (cached) return cached;
  let env: ReturnType<typeof readEnv>;
  try {
    env = readEnv();
  } catch (error) {
    logData("data", "data source is not configured", { reason: error instanceof Error ? error.message : "unknown" }, "error");
    throw error;
  }

  if (env.dataSource === "supabase") {
    const host = hostOf(env.supabaseUrl);
    const client = createSupabaseClient(env.supabaseUrl, env.supabaseAnonKey);
    const inner = createSupabaseRepository(client, {
      onDecision: (message, fields) => logData("data", message, fields, "warn"),
    });
    cached = withDataLogging(inner, { source: "supabase", label: `supabase:${host}` });
    if (firstAnnouncement()) {
      logData("data", "source=supabase", {
        host,
        table: "public.site_articles",
        key: "publishable (read only; row level security shows only status=PUBLISHED)",
        fallback: "none",
      });
      if (dataLogEnabled()) startConnectionCheck(client);
    }
    return cached;
  }

  cached = withDataLogging(createFixtureRepository(), { source: "fixtures", label: "fixtures" });
  if (firstAnnouncement()) {
    logData(
      "data",
      `DEMO DATA: serving ${(fixtureData as unknown[]).length} sample articles built from output/*.md, NOT from the database (DATA_SOURCE=fixtures)`,
      undefined,
      "warn",
    );
  }
  return cached;
}

/** Test helper: clears the memoized repository and the once-per-process banner flag. */
export function resetRepositoryForTests(): void {
  cached = undefined;
  delete (globalThis as Flagged)[ANNOUNCED];
}
