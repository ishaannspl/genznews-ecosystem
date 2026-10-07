# Known issues and improvement backlog

Found by reading the code on 2026-10-05. Not yet fixed; verify before acting.

## Correctness
1. **Supabase schema lags SQLite.** `insert_article` sends only 10 columns to Supabase. `niche, slug, hook, tldr, breakdown, why_it_matters, headlines, meta_description, source_attribution` never reach the cloud, and `supabase_setup.sql` has no such columns. Either extend both or document Supabase as a thin copy.
2. **Dedup key mismatch.** SQLite dedups on `url_hash` (canonical URL), Supabase on raw `source_url`. A tracking-param variant of a URL can be inserted twice in Supabase.
3. **`INSERT OR REPLACE`** in SQLite silently overwrites a row (and changes its `id`) if the hash repeats.
4. **Model names are inconsistent**: `ai_writer.py` defaults to `gemini-3.5-flash`, `check_connections.py` to `gemini-3.8-flash`. Pick one source of truth in `config.py`.
5. **`check_connections.py` swallows the first Gemini error** (`except Exception: pass`) before trying the legacy SDK, which is not in `requirements.txt`.
6. **Prompt limits are unvalidated**: 3 TL;DR bullets, meta description under 155 chars, tag count. Add post-parse validation in `generate_genz_article`.
7. **Silent truncation** to 8000 chars in `_build_user_prompt` can drop the end of long stories.
8. **`init_sqlite_db()` runs on import** of `app.database`, so importing it in tests creates `articles.db`.

## Security
9. **SSRF**: `POST /generate` fetches any user-supplied http(s) URL. `_validate_url` does not block localhost, private ranges, or cloud metadata IPs, and `requests` follows redirects.
10. **API has no auth or rate limit**, and CORS is `allow_origins=["*"]`. Anyone who can reach it can spend Gemini quota.
11. **Supabase RLS is disabled** in `supabase_setup.sql`; fine only if the key never leaves the backend. `NEXT_PUBLIC_*` env names suggest a frontend might use it.
12. Error responses return raw exception text (`AI generation failed: {exc}`), which can leak internals.

## Maintainability
13. `pyrightconfig.json` contains Windows-specific `extraPaths`; remove for other machines.
14. `run_pipeline.py` and `run_specific_indian_batch.py` duplicate the process-article logic; extract a shared function.
15. Blocking `requests` / Gemini calls inside sync FastAPI handlers; fine for low volume, a bottleneck otherwise.
16. Tests cover only the scraper. Missing: `get_canonical_url`, `remove_em_dashes`, `_parse_json`, DB functions (use a temp SQLite path), API routes (`httpx`/`TestClient` with mocks).
17. Daemon mode is a bare `sleep` loop with `print` logging; no structured logs, no overlap protection.

Suggested order: 9, 10, 1/2, 16, then the rest. Use `writing-plans` + `test-driven-development` for each.
