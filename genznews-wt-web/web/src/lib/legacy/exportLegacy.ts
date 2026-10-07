import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { redact } from "../dataLog";
import { explainDataError } from "../explainError";
import { REQUEST_TIMEOUT_MS, withTimeout } from "../repositories/supabaseRepository";
import {
  IMPORT_STATUSES,
  LEGACY_COLUMNS,
  buildImportPlan,
  buildMdIndex,
  renderDiagnoseSql,
  renderImportSql,
  renderSetupSql,
  type ImportStatus,
  type LegacyRow,
  type MdFile,
} from "./legacyImport";

/**
 * `npm run export:legacy-sql`: reads the legacy `public.articles` rows (GET only, anon key) and
 * writes SQL the owner pastes into the Supabase SQL editor. Never prints keys, URLs beyond the
 * host name, or article text. Article text is written only to the git-ignored output files.
 */

const PAGE_SIZE = 1000;
const MAX_PAGES = 100;
export const IMPORT_FILE = "legacy-import.sql";
export const SETUP_FILE = "setup-and-import.sql";
export const DIAGNOSE_FILE = "diagnose.sql";

export interface ExportArgs {
  dryRun: boolean;
  status: ImportStatus;
  outDir: string | null;
  help: boolean;
}

export interface ExportDeps {
  env: Record<string, string | undefined>;
  envFileExists: (path: string) => boolean;
  /** Loads a dotenv file into `env` (process.loadEnvFile in the real script). */
  loadEnvFile: (path: string) => void;
  fetch: typeof fetch;
  readOutputFiles: () => MdFile[];
  readMigrations: () => { name: string; sql: string }[];
  mkdir: (path: string) => void;
  writeFile: (path: string, content: string) => void;
  log: (line: string) => void;
  webDir: string;
}

const USAGE = `Usage: npm run export:legacy-sql -- [--dry-run] [--status PUBLISHED|REVIEW_REQUIRED] [--out <dir>]

Reads public.articles (read only) and writes ${IMPORT_FILE}, ${SETUP_FILE} and ${DIAGNOSE_FILE}
to web/supabase/import/ (git-ignored). Paste one into the Supabase SQL editor and Run.`;

class UsageError extends Error {}

export function parseArgs(argv: readonly string[]): ExportArgs {
  const out: ExportArgs = { dryRun: false, status: "PUBLISHED", outDir: null, help: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const eq = arg.indexOf("=");
    const name = arg.startsWith("--") && eq > 0 ? arg.slice(0, eq) : arg;
    const inline = arg.startsWith("--") && eq > 0 ? arg.slice(eq + 1) : undefined;
    const value = (): string => {
      const v = inline ?? argv[++i];
      if (v === undefined || v === "" || (inline === undefined && v.startsWith("--"))) throw new UsageError(`${name} needs a value`);
      return v;
    };
    if (name === "--dry-run" && inline === undefined) out.dryRun = true;
    else if ((name === "--help" || name === "-h") && inline === undefined) out.help = true;
    else if (name === "--status") {
      const v = value();
      if (!(IMPORT_STATUSES as readonly string[]).includes(v)) {
        throw new UsageError(`--status must be one of ${IMPORT_STATUSES.join(", ")} (got '${v.slice(0, 40)}')`);
      }
      out.status = v as ImportStatus;
    } else if (name === "--out") out.outDir = value();
    else throw new UsageError(`Unknown argument '${arg.slice(0, 40)}'`);
  }
  return out;
}

/** Wraps fetch so that anything but GET is refused before it reaches the network. */
export function getOnly(base: typeof fetch): typeof fetch {
  return async (input, init) => {
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    if (method !== "GET") throw new Error(`Refusing ${method.slice(0, 10)}: this export is read only (GET requests only).`);
    return base(input, { ...init, method: "GET" });
  };
}

/** HTTP failure with a status and (when it looks like one) the PostgREST code; never the body text. */
class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly pgCode: string | undefined,
  ) {
    super(`Supabase answered HTTP ${status}${pgCode ? ` (${pgCode})` : ""} for public.articles`);
  }
}

/**
 * The only function that touches the network: every legacy row, 1000 per page ordered by id,
 * through a GET-only fetch with the site's 6 s timeout.
 */
export async function getAll(supabaseUrl: string, anonKey: string, baseFetch: typeof fetch): Promise<LegacyRow[]> {
  const fetchGet = getOnly(withTimeout(baseFetch, REQUEST_TIMEOUT_MS));
  const origin = new URL(supabaseUrl).origin;
  const rows: LegacyRow[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const url = new URL("/rest/v1/articles", origin);
    url.searchParams.set("select", LEGACY_COLUMNS);
    url.searchParams.set("order", "id.asc");
    url.searchParams.set("limit", String(PAGE_SIZE));
    url.searchParams.set("offset", String(page * PAGE_SIZE));
    const res = await fetchGet(url.toString(), {
      method: "GET",
      headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}`, Accept: "application/json" },
    });
    const text = await res.text();
    if (!res.ok) {
      let code: string | undefined;
      try {
        const c = (JSON.parse(text) as { code?: unknown }).code;
        if (typeof c === "string" && /^[A-Z0-9]{1,12}$/.test(c)) code = c;
      } catch {
        // Not JSON: report the status only.
      }
      throw new HttpError(res.status, code);
    }
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error("Supabase answered with a body that is not JSON");
    }
    if (!Array.isArray(data)) throw new Error("Supabase answered with something other than a list of rows");
    rows.push(...(data as LegacyRow[]));
    if (data.length < PAGE_SIZE) return rows;
  }
  throw new Error(`More than ${MAX_PAGES * PAGE_SIZE} rows; refusing to continue`);
}

/** `output/<niche_key>/*.md`, sorted by path. */
export function readOutputFiles(outputDir: string): MdFile[] {
  const files: MdFile[] = [];
  for (const dir of readdirSync(outputDir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    if (!dir.isDirectory()) continue;
    for (const file of readdirSync(join(outputDir, dir.name)).sort()) {
      if (!file.endsWith(".md")) continue;
      files.push({ path: `${dir.name}/${file}`, nicheKey: dir.name, markdown: readFileSync(join(outputDir, dir.name, file), "utf8") });
    }
  }
  return files;
}

/** `NNNN_*.sql` migrations, in file name order. */
export function readMigrations(migrationsDir: string): { name: string; sql: string }[] {
  return readdirSync(migrationsDir)
    .filter((f) => /^\d{4}_[\w-]+\.sql$/.test(f))
    .sort()
    .map((name) => ({ name, sql: readFileSync(join(migrationsDir, name), "utf8") }));
}

function hostName(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "unknown-host";
  }
}

function pad(value: string, width: number): string {
  return value.length >= width ? value : value + " ".repeat(width - value.length);
}

/** Runs the export; returns the process exit code (0 ok, 1 failure, 2 usage or configuration). */
export async function runExport(argv: readonly string[], deps: ExportDeps): Promise<number> {
  const log = (line: string) => deps.log(redact(line));
  let args: ExportArgs;
  try {
    args = parseArgs(argv);
  } catch (e) {
    log(`error: ${e instanceof Error ? e.message : "bad arguments"}`);
    log(USAGE);
    return 2;
  }
  if (args.help) {
    log(USAGE);
    return 0;
  }

  const envPath = join(deps.webDir, ".env.local");
  const missing = () => ["SUPABASE_URL", "SUPABASE_ANON_KEY"].filter((n) => !deps.env[n]?.trim());
  if (missing().length > 0 && deps.envFileExists(envPath)) {
    try {
      deps.loadEnvFile(envPath);
    } catch {
      log("error: could not read web/.env.local");
      return 2;
    }
  }
  if (missing().length > 0) {
    log(`error: missing ${missing().join(" and ")} (set it in the environment or in web/.env.local)`);
    return 2;
  }
  const supabaseUrl = deps.env.SUPABASE_URL!.trim();
  const anonKey = deps.env.SUPABASE_ANON_KEY!.trim();
  if (!/^https?:\/\//i.test(supabaseUrl) || hostName(supabaseUrl) === "unknown-host") {
    log("error: SUPABASE_URL is not an http(s) URL");
    return 2;
  }
  const host = hostName(supabaseUrl);

  const { index, warnings } = buildMdIndex(deps.readOutputFiles());

  log(`legacy export (read only), host: ${host}`);
  let rows: LegacyRow[];
  try {
    rows = await getAll(supabaseUrl, anonKey, deps.fetch);
  } catch (e) {
    if (e instanceof HttpError) {
      const hint =
        e.status === 401
          ? " Check SUPABASE_ANON_KEY is the publishable key of the same project."
          : e.status === 404
            ? " The table public.articles was not found in this project."
            : "";
      log(`error: ${e.message}.${hint}`);
    } else {
      const why = explainDataError(e);
      log(`error: could not read public.articles: ${why.reason}${why.hint ? `. ${why.hint}` : ""}`);
    }
    return 1;
  }

  const plan = buildImportPlan(rows, index, { status: args.status });
  let importSql: string;
  try {
    // Throws if a value is invalid or still holds an em-dash or en-dash; nothing is written then.
    importSql = renderImportSql(plan);
  } catch (e) {
    log(`error: ${e instanceof Error ? e.message : "could not build the SQL"}. Nothing was written.`);
    return 1;
  }
  const setupSql = renderSetupSql(importSql, deps.readMigrations());

  log(`rows read: ${rows.length}`);
  log(`rows exported: ${plan.rows.length} (status ${args.status})`);
  log(`rows skipped: ${plan.skipped.length}`);
  if (plan.skipped.length > 0) {
    log(`  ${pad("id", 6)} ${pad("title", 60)}  ${pad("domain", 28)}  reason`);
    for (const s of plan.skipped) log(`  ${pad(s.id, 6)} ${pad(s.title, 60)}  ${pad(s.domain, 28)}  ${s.reason}`);
  }
  log("per category:");
  for (const key of Object.keys(plan.perCategory).sort()) log(`  ${key}: ${plan.perCategory[key]}`);
  if (plan.notes.length > 0) {
    log("notes on exported rows:");
    for (const n of plan.notes) log(`  ${n}`);
  }
  if (warnings.length > 0) {
    log("output files:");
    for (const w of warnings) log(`  ${w}`);
  }

  if (args.dryRun) {
    log("dry run: nothing written");
    return 0;
  }
  const outDir = args.outDir
    ? isAbsolute(args.outDir)
      ? args.outDir
      : resolve(args.outDir)
    : join(deps.webDir, "supabase", "import");
  const importPath = join(outDir, IMPORT_FILE);
  const setupPath = join(outDir, SETUP_FILE);
  deps.mkdir(outDir);
  deps.writeFile(importPath, importSql);
  deps.writeFile(setupPath, setupSql);
  const diagnosePath = join(outDir, DIAGNOSE_FILE);
  deps.writeFile(diagnosePath, renderDiagnoseSql());
  log(`wrote: ${importPath}`);
  log(`wrote: ${setupPath}`);
  log(`wrote: ${diagnosePath}`);
  log("next: Supabase dashboard, SQL editor, paste the setup file (safe to run again), Run. If the site still says a table is missing, run diagnose.sql.");
  return 0;
}

/** Real dependencies for the CLI. */
export function nodeDeps(webDir: string): ExportDeps {
  return {
    env: process.env,
    envFileExists: (p) => existsSync(p),
    loadEnvFile: (p) => process.loadEnvFile(p),
    fetch: (input, init) => fetch(input, init),
    readOutputFiles: () => readOutputFiles(join(webDir, "..", "output")),
    readMigrations: () => readMigrations(join(webDir, "supabase", "migrations")),
    mkdir: (p) => mkdirSync(p, { recursive: true }),
    writeFile: (p, c) => writeFileSync(p, c, "utf8"),
    log: (l) => console.log(l),
    webDir,
  };
}
