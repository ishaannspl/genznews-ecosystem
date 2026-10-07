/**
 * Exports the legacy public.articles rows as SQL for public.site_articles (read only).
 *
 *   npm run export:legacy-sql [-- --dry-run] [-- --status REVIEW_REQUIRED] [-- --out <dir>]
 *
 * Reads SUPABASE_URL and SUPABASE_ANON_KEY from the environment, or from web/.env.local.
 * Only GET requests are made. Output goes to web/supabase/import/ (git-ignored).
 */
import { fileURLToPath } from "node:url";
import { nodeDeps, runExport } from "../src/lib/legacy/exportLegacy";

const webDir = fileURLToPath(new URL("..", import.meta.url));

runExport(process.argv.slice(2), nodeDeps(webDir)).then(
  (code) => {
    process.exitCode = code;
  },
  () => {
    console.error("export failed unexpectedly");
    process.exitCode = 1;
  },
);
