# GenZNews: Framework Stage + Website (Design Spec)

Date: 2026-10-05
Status: DRAFT, awaiting user review

## 1. Goal

Put the existing GenZNews articles on a public website, after passing them through a copywriting-framework step. The existing scrape-and-rewrite pipeline stays as it is.

Success criteria:
- `app/*`, `run_pipeline.py`, `run_specific_indian_batch.py`, `sources.json` and `supabase_setup.sql` are unmodified.
- Every article that reaches the site was written with a framework chosen by a configurable strategy.
- Nothing publishes without human approval at launch.
- Running the new stage twice never creates a duplicate article.

## 2. Key constraint: do not change the pipeline

The new work is purely additive. It reads what the pipeline already produces and writes to new tables only.

```text
EXISTING (untouched)                           NEW
feeds → scrape → Gemini rewrite → articles.db ──► Framework Stage (new CLI, new package)
                                   (SQLite)             │ writes new Supabase tables only
                                                         ▼
                                              Supabase: site_articles, site_jobs
                                                         ▼
                                              Next.js site (web/) + /admin review queue
```

Consequences:
- The Supabase `articles` table from `supabase_setup.sql` is **not used** by the site. It is narrow and has a different dedup key (known issues #1, #2).
- The framework stage reads `articles.db` through a **read-only** SQLite connection. It does not import `app.database` (which creates the DB on import).
- It reuses `remove_em_dashes` from `app/ai_writer.py` by import. Nothing in `app/` is edited.
- Both the pipeline and the new stage run on the same worker host, so the stage can see `articles.db`.

## 3. Decisions (from discovery)

| Topic | Decision |
|---|---|
| Publish policy | Full Gen Z rewrite with source link and attribution. Per-source restriction switch in config. |
| Stack | Next.js (App Router, ISR) + Supabase, in `genznews/web/` |
| Structure | Fixed TL;DR + attribution blocks; the framework shapes the body |
| Frameworks | 7 distinct (AIDA, PAS, BAB, 4Ps, FAB, StoryBrand, QUEST). Config supports adding the 2 duplicates' replacements any time. |
| Publishing | All articles `REVIEW_REQUIRED` at launch. `AUTO_PUBLISH` exists but is off by config. |
| Scope | Reading site + minimal review queue |
| Images | Reuse source images (hotlink), with a placeholder fallback |
| Byline | "GenZNews Desk", no AI note (disclosure field kept in schema) |
| Dedup | Hash + title/content fingerprint, no embeddings |
| Worker | Small VPS/container with a scheduler |
| Volume | About 20 to 50 articles/day, daily generation cap, cost logged per job |

Changed by the "don't change the pipeline" instruction:
- **Q3 (Supabase as primary DB):** reduced. SQLite stays the pipeline's store. Supabase holds only the new site tables.
- **Q13 (migration):** no migration step. The stage processes every existing `articles.db` row it hasn't seen.
- **Q14 (M0 security hardening of `/generate`):** removed from this scope because it edits `app/main.py` and `app/scraper.py`. Still recommended as a separate change. See open items.

## 4. Framework Stage

New package `framework_stage/` at the `genznews/` root, with CLI `run_framework_stage.py`.

### 4.1 Stages (each a module with `run(job) -> result`)

```text
select      pick articles.db rows with no site_articles row (by url_hash), newest first, capped per run
normalize   clean text, normalized title, content hash
dedup       exact (url_hash, content hash) + near-duplicate (title shingles Jaccard, content SimHash)
classify    content type (cheap LLM call, structured output, with keyword rules as a pre-filter)
framework   pure function: content_type → framework via config
generate    one LLM call, schema-constrained JSON, grounded in source text
validate    deterministic checks, then risk scoring
seo         slug (unique), seo title, meta description, keywords, JSON-LD fields
store       upsert into site_articles with status
```

Stages can be changed independently. Each takes and returns a Pydantic model, and the order is a list in config.

### 4.2 Input per article

From `articles.db`: `url_hash, source_url, domain, niche, original_title, original_author, published_at, original_content`, and the existing generated fields (`genz_title, hook, tldr_json, breakdown, why_it_matters, source_attribution`).

The framework rewrite is built from `original_content` (the grounding source). The existing TL;DR and attribution are reused as the fixed blocks, so those are not regenerated.

### 4.3 Framework strategy (config, not code)

`framework_stage/config/frameworks.json`:

```json
{
  "default": "AIDA",
  "content_types": {
    "GENERAL_NEWS": "AIDA",
    "PROBLEM_FOCUSED": "PAS",
    "TRANSFORMATION": "BAB",
    "PERSUASIVE": "4PS",
    "PRODUCT_LAUNCH": "FAB",
    "BRAND_STORY": "STORYBRAND",
    "LONG_FORM": "QUEST"
  },
  "niche_overrides": {},
  "keyword_rules": {
    "PRODUCT_LAUNCH": ["launches", "unveils", "introduces"],
    "TRANSFORMATION": ["before and after", "transformed", "turned around"]
  },
  "long_form_min_chars": 6000
}
```

`keyword_rules` maps a content type to trigger keywords for the cheap pre-classifier. `long_form_min_chars` is the source length at which an article is treated as `LONG_FORM`.

- One prompt template per framework in `framework_stage/prompts/<framework>.md`, with the same shared header (grounding rules, banned phrases, output schema).
- `niche_overrides` lets a niche force a framework without code changes.
- The admin can set `regen_framework` on an article to force a different one.
- Unknown content type falls back to `default` and logs a warning.

### 4.4 Output schema (structured)

```json
{
  "title": "", "slug": "", "summary": "", "body_md": "",
  "framework": "", "content_type": "", "category": "",
  "tags": [], "seo_title": "", "seo_description": "", "keywords": [],
  "claims": [{"text": "", "source_quote": ""}]
}
```

Generation uses Gemini JSON mode with a response schema. There is no regex parsing of free text.

### 4.5 Grounding and validation

Deterministic checks run first, to avoid paying for an LLM check when a cheap rule rejects the article:

1. No em-dashes (apply `remove_em_dashes`, then assert none remain).
2. Banned-phrase list from the existing editorial rules (copied into `framework_stage/config/banned_phrases.json` with a test that it matches the prompt in `ai_writer.py`).
3. `seo_description` is truncated at a word boundary to at most 155 characters in the SEO step (it does not fail validation); TL;DR is exactly 3 bullets (reused block).
4. Every number, date and capitalized entity in `body_md` must appear in the source text. Misses are listed in `flags` and lower `confidence`.
5. Each entry in `claims` must have a `source_quote` that exists in the source.
6. Source too short (under `MIN_SOURCE_CHARS`) means no generation; the row is stored as `FAILED` with reason `INSUFFICIENT_SOURCE`.

Output: `confidence` (0 to 1), `fact_risk` (`LOW|MEDIUM|HIGH`), `flags` (list). A failed hard check (banned phrase or em-dash that survives one retry) sets `FAILED`.

### 4.6 Status routing

All passing articles go to `REVIEW_REQUIRED`. `AUTO_PUBLISH` is enabled only by `AUTO_PUBLISH_ENABLED=true` plus per-niche thresholds, and defaults to off.

### 4.7 Dedup and same-story handling

- Exact: `url_hash`, content hash.
- Near/same story: normalized-title shingle Jaccard and content SimHash within a time window. Matches share a `cluster_id`.
- Only the primary of a cluster is generated (saves cost). Other sources are stored as `also_reported_by` links on the primary.
- Embeddings are out of scope until measurement shows misses.

### 4.8 Cost controls

- Duplicates and thin sources are rejected before any LLM call.
- Per-run cap and `DAILY_GENERATION_CAP`.
- The classify step uses the smallest model; generate uses the configured Flash model.
- Tokens and estimated cost are written to `site_jobs`.
- Retry: up to 2 retries with backoff on transient errors only; no retry on validation failures beyond one regeneration.

### 4.9 Images

The pipeline does not extract images. The stage fetches only the `og:image` meta tag from `source_url` with an SSRF-safe fetch (http/https only, no private IP ranges, redirect limit, short timeout, size cap), and stores `image_url` plus `image_source`. The site shows a placeholder if the image is missing or fails to load. A config flag `IMAGE_POLICY=hotlink|placeholder` can switch to placeholders without a rebuild.

## 5. Data model (Supabase, new tables only)

```text
site_articles
  id uuid pk, url_hash text unique         -- idempotency key, links back to articles.db
  content_hash text, norm_title text, simhash text  -- simhash stored as hex text; used for dedup
  slug text unique, title, summary, body_md, generated_body_md
  framework, content_type, category (niche key), tags text[]
  seo_title, seo_description, keywords text[]
  source_url, source_domain, source_name, also_reported_by jsonb
  image_url, image_source
  cluster_id text
  confidence real, fact_risk text, flags jsonb
  status text   -- PROCESSING | REVIEW_REQUIRED | APPROVED | PUBLISHED | REJECTED | FAILED | ARCHIVED
  regen_framework text null
  byline text default 'GenZNews Desk', ai_disclosure boolean default false
  reviewed_by, reviewed_at, published_at, created_at, updated_at
  job_id uuid

site_jobs
  id uuid pk, url_hash, started_at, finished_at, duration_ms
  stages jsonb    -- {"dedup":"ok","classify":"ok","generate":"ok","validate":"fail",...}
  error text, model text, tokens_in int, tokens_out int, est_cost_usd numeric
```

No `reviews`, `tags`, `frameworks` or `categories` tables for now. `body_md` is the edited copy and `generated_body_md` keeps the original. Categories come from the 5 niche keys.

Schema SQL lives in `web/supabase/migrations/` (new files). `supabase_setup.sql` is not touched.

### Access control (RLS)

- Public (anon key): `SELECT` on `site_articles` where `status = 'PUBLISHED'` only.
- Admin: Supabase Auth user in an allowlist; may read all rows and update status, `body_md`, `regen_framework`.
- Worker: service-role key, kept only on the worker host and never in the web app.

## 6. Website (`web/`)

Next.js App Router, TypeScript, ISR with on-demand revalidation when an article is published.

Routes: `/`, `/latest`, `/category/[slug]`, `/article/[slug]`, `/search`, `/about`, `/sitemap.xml`, `/robots.txt`, `/admin` (protected).
`/trending` is deferred because there is no analytics source yet.

Home sections: hero story, latest, category rows. Editor's picks and newsletter are deferred.

Components (one implementation each): `ArticleCard`, `FeaturedArticle`, `CategoryCard`, `ArticleHeader`, `ArticleContent`, `RelatedArticles`, `SearchBar`, `Navigation`, `Footer`, `Pagination`, `LoadingState`, `EmptyState`, `ErrorState`.

Search uses Postgres full-text search (`tsvector` on title, summary, body).

Article body is rendered from Markdown with a sanitizing renderer (no raw HTML).

### SEO
Per article: `generateMetadata` (title, description, canonical), OpenGraph and Twitter tags, `NewsArticle` JSON-LD, `BreadcrumbList` JSON-LD, related articles for internal links, semantic HTML, clean `/article/<slug>` URLs, and a sitemap from published rows. The source link is shown with `rel="noopener noreferrer"`.

### UI direction
Use `frontend-design` and `ui-ux-pro-max` for the visual system, and `vercel-react-best-practices` for performance. Mobile-first, accessible (WCAG AA contrast, keyboard navigation, reduced motion). Animations stay minimal.

## 7. Review queue (`/admin`)

- List by status, with confidence, fact risk and flags.
- Detail view: source text beside generated text, with flagged items highlighted.
- Actions: edit body, approve, reject, publish, change framework and request regeneration.
- Regeneration only sets `regen_framework` and `status = PROCESSING`; the worker picks it up on its next run. There are no long-running requests in the web app.

## 8. Observability

- Every run and article gets a `job_id`; logs are JSON lines with `job_id`, `url_hash`, `stage`, `duration_ms`, `status`.
- `site_jobs.stages` shows per-stage success or failure.
- The CLI prints a summary: processed, skipped (duplicate), failed, tokens, estimated cost.
- A lock file prevents overlapping runs.

## 9. Security

- Service-role key and `GEMINI_API_KEY` live only in the worker's `.env`. The web app gets the anon key only.
- Admin routes check the Supabase session and the allowlist on the server.
- Markdown sanitized; no `dangerouslySetInnerHTML` on unsanitized input.
- The image fetch is SSRF-safe (see 4.9).
- Admin write endpoints use CSRF-safe server actions or same-site cookies.
- Never commit `.env`, `articles.db`.

## 10. Testing

Unit: framework selection (config and fallback), slug generation and uniqueness, dedup (exact, near, cluster), validation (grounding, banned phrases, em-dashes), normalization, status routing.

Integration: `articles.db` fixture to stage to Supabase (local or mocked client), idempotency (second run creates nothing), LLM client mocked with recorded structured outputs.

E2E (Playwright): a seeded `REVIEW_REQUIRED` article is approved in `/admin`, published, then appears on `/`, its article page and the sitemap, with correct metadata.

No test hits the network or a real model.

## 11. Milestones

1. **F0, foundation:** package skeleton, config files, Supabase migrations, RLS, lock file, JSON logging. Tests for config loading.
2. **F1, stage core:** select, normalize, classify, framework selection, generate (mocked LLM first), store. Idempotency test.
3. **F2, validation and dedup:** grounding checks, scoring, near-duplicate clustering, cost caps.
4. **F3, SEO and images:** slug, metadata, og:image fetch.
5. **F4, website:** pages, components, SEO metadata, sitemap, search.
6. **F5, review queue:** auth, list, diff view, edit, approve, regenerate.
7. **F6, deploy and verify:** worker scheduling (pipeline, then stage), site on Vercel, E2E, security and launch checklists.

Each milestone ends with tests, Pyright (0 errors) and lint passing, then a review pass.

## 12. Accepted risks

- Hotlinked source images may break or draw copyright complaints. Mitigation: placeholder fallback and `IMAGE_POLICY`.
- No AI disclosure may conflict with some ad or platform rules. Mitigation: `ai_disclosure` field, toggle without rebuild.
- Republishing rewritten third-party news carries editorial and legal exposure. Mitigation: human review at launch, attribution on every article, per-source restriction switch.
- Pipeline weaknesses stay in place for now (known issues #1 to #17), including SSRF and the open `/generate` endpoint.

## 13. Open items for the reviewer

1. **Security hardening (old Q14):** it edits `app/`, so it is out of this scope. Do you want it as a separate, later change?
2. **Framework list:** you mentioned 9 frameworks again; this spec uses 7 distinct ones. The config accepts the remaining two whenever you pick them.
3. **Hosting accounts:** which Supabase project and Vercel account will be used?
4. **Admin users:** who goes on the admin allowlist?
