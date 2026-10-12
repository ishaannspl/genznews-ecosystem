# Architecture

## Flow
```
sources.json (5 niches, 17 RSS feeds)
  → feedparser entries
  → article_exists(url)        SHA-256 of canonical URL (utm_/fbclid/gclid etc. stripped), checks SQLite then Supabase
  → scrape_article(url)        requests + trafilatura(favor_precision), min 200 / max 30000 chars
  → generate_genz_article()    Gemini JSON → GenZArticle (em-dash sanitised)
  → insert_article()           SQLite (INSERT OR REPLACE) + Supabase (best effort)
  → save_markdown_article()    output/<niche>/<slug>.md   (run_pipeline.py only)
```
`POST /generate` runs the same chain for a single URL (no markdown file, `niche` optional).

## Modules
| File | Responsibility |
|---|---|
| `app/config.py` | `Settings` dataclass: `USER_AGENT`, `REQUEST_TIMEOUT_SECONDS` (15), `MIN_ARTICLE_CHARS` (200), `MAX_ARTICLE_CHARS` (30000). Validates positive ints. |
| `app/scraper.py` | `scrape_article(url)` → dict. Errors: `ScraperError` ← `InvalidURLError`, `ArticleExtractionError`. Rejects non-http(s) and URLs with credentials. |
| `app/ai_writer.py` | `_SYSTEM_PROMPT` (persona + banned words), `_call_gemini` (4 attempts, backoff 4s→8s→16s on 503/UNAVAILABLE), model fallback `gemini-3.5-flash-lite`, `_parse_json`, `remove_em_dashes`. Source text truncated to 8000 chars in the prompt. |
| `app/database.py` | URL canonicalisation + hash, SQLite schema (auto-created on import), Supabase client (optional), `article_exists`, `insert_article`, `get_article_by_id`, `get_recent_articles`. |
| `app/schemas.py` | `GenerateRequest`, `ScrapedData`, `GenZArticle`, `ArticleOut`. |
| `app/main.py` | FastAPI app v0.2.0. |
| `run_pipeline.py` | Batch runner + daemon mode (`--interval`), writes `output/latest_batch.json`. |
| `run_specific_indian_batch.py` | Same idea for TOI, The Hindu, Dainik Jagran, Indian Express, Hindustan Times. |

## API
| Method | Path | Notes |
|---|---|---|
| GET | `/health` | `{"status":"ok","version":"0.2.0"}` |
| POST | `/generate` | body `{url, niche?}`. 409 duplicate, 422 scrape failure, 502 AI failure, 503 DB failure |
| GET | `/articles?limit&niche` | summary rows, limit capped at 100 |
| GET | `/articles/{id}` | full structured article, 404 if missing |

## Data model (SQLite `articles`)
`id, url_hash (UNIQUE), source_url, domain, niche, original_title, original_author, published_at, original_content, genz_title, headlines_json, meta_description, slug, genz_tags_json, hook, tldr_json, breakdown, why_it_matters, source_attribution, genz_content, status, created_at`.

Supabase `articles` (see `supabase_setup.sql`) is a narrower table: `source_url UNIQUE, domain, original_*, genz_title, genz_content, genz_tags TEXT[], status, created_at`.

## Niches (keys in `sources.json`)
`health_wellness` (3 feeds), `education_career` (3), `entertainment_pop_culture` (4), `biogas_clean_energy` (3), `digital_marketing_social_media` (4).

## External dependencies
Gemini via `google-genai`; Supabase via `supabase`; no queue, no scheduler besides the `--interval` sleep loop.

See `known-issues.md` for gaps found while reading the code.
