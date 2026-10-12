# Framework Stage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A new CLI stage that reads articles the existing pipeline already stored in `articles.db`, rewrites each one with a configurable copywriting framework, validates it, and stores it in new Supabase tables as `REVIEW_REQUIRED`.

**Architecture:** A new package `framework_stage/` made of small stage modules (dedup, classify, framework strategy, generate, validate, seo, image, store) wired by `runner.py`. The LLM and the store are Protocols, so tests use fakes and nothing touches the network. The existing pipeline files are never edited.

**Tech Stack:** Python 3.11+, Pydantic v2, `google-genai` (Gemini JSON schema mode), `supabase-py`, `requests`, pytest, Pyright.

**Spec:** `docs/superpowers/specs/2026-10-05-genznews-framework-site-design.md` (sections 2 to 5, 8, 9). The website and review queue (spec sections 6 and 7) get their own plan.

## Global Constraints

- Do not modify `app/*`, `run_pipeline.py`, `run_specific_indian_batch.py`, `sources.json` or `supabase_setup.sql`. Read-only reuse by import is allowed (`app.ai_writer.remove_em_dashes`).
- `articles.db` is opened read-only (`file:<path>?mode=ro`). Never import `app.database` (it creates the DB on import).
- Frameworks (7 keys): `AIDA, PAS, BAB, 4PS, FAB, STORYBRAND, QUEST`. Content types: `GENERAL_NEWS, PROBLEM_FOCUSED, TRANSFORMATION, PERSUASIVE, PRODUCT_LAUNCH, BRAND_STORY, LONG_FORM`. Default framework `AIDA`.
- Statuses: `PROCESSING, REVIEW_REQUIRED, APPROVED, PUBLISHED, REJECTED, FAILED, ARCHIVED`. Everything passing validation is `REVIEW_REQUIRED` unless `AUTO_PUBLISH_ENABLED=true` (default false).
- Editorial rules: no em-dashes (`—`, `–`, `--`) in stored text; the banned-phrase list must match the one in `app/ai_writer.py`; TL;DR is exactly 3 bullets; `seo_description` is at most 155 characters.
- Idempotency key is `url_hash`. A second run creates nothing, and never overwrites an existing row's `status`, `body_md` or `slug`.
- New settings are read via `framework_stage/settings.py` and documented in `.env.example`. Never commit `.env` or `articles.db`.
- Tests never touch the network or a real model. Pyright must report 0 errors on `framework_stage/`.
- Run everything from `genznews/` with `.venv/bin/python`. Each commit message ends with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

## Spec amendments this plan makes

- `site_articles` also stores `content_hash text`, `norm_title text`, `simhash text` (hex) for dedup, and `source_name text`.
- `frameworks.json` gains `keyword_rules` (pre-filter for classification) and `long_form_min_chars` (6000).
- The `seo_description` limit is enforced by truncating at a word boundary in the SEO step, not by a validation failure.
- Apply these to the spec in Task 1.

## Review Focus

- Source text that is empty, whitespace, or under `MIN_SOURCE_CHARS` (400): stored as `FAILED` with `INSUFFICIENT_SOURCE`, with no LLM call (Task 11).
- LLM returns invalid or empty JSON: one retry, then `FAILED`, and the rest of the batch continues (Tasks 6, 11).
- Two articles produce the same slug: the second gets a numeric suffix, never an overwrite (Task 5).
- Same story from two outlets: generated once, the other outlet linked in `also_reported_by` (Tasks 4, 11).
- Supabase write fails on one article, or a second run starts while one is running: the batch continues, and the lock refuses overlap (Task 11).
- `og:image` pointing at localhost, a private IP, or a redirect to one: rejected, `image_url` is null (Task 10).

---

### Task 1: Scaffold, settings, config files

**Files:**
- Create: `framework_stage/__init__.py`, `framework_stage/settings.py`, `framework_stage/config/frameworks.json`, `framework_stage/config/banned_phrases.json`, `tests/framework_stage/__init__.py`, `tests/framework_stage/test_settings.py`, `tests/framework_stage/test_banned_phrases.py`
- Modify: `.env.example` (append new settings), `docs/superpowers/specs/2026-10-05-genznews-framework-site-design.md` (apply the amendments above)

**Interfaces:**
- Produces: `Settings` (frozen dataclass) and `get_settings() -> Settings` with fields `db_path: Path, supabase_url: str, supabase_service_key: str, framework_model: str, classifier_model: str, daily_generation_cap: int (50), run_limit: int (20), min_source_chars: int (400), auto_publish_enabled: bool (False), auto_publish_min_confidence: float (0.9), auto_publish_niches: frozenset[str], image_policy: Literal["hotlink","placeholder"], title_jaccard_min: float (0.5), simhash_max_distance: int (6), dedup_window_hours: int (72), cost_per_mtok_in: float, cost_per_mtok_out: float, lock_path: Path`.
- Produces: `framework_stage/config/frameworks.json` with keys `default, content_types, niche_overrides, keyword_rules, long_form_min_chars`; `banned_phrases.json` as a list of strings.

- [ ] **Step 1:** Create the venv and install: `python3 -m venv .venv && .venv/bin/pip install -r requirements.txt pyright`. Expected: `.venv/bin/python -m pytest --version` prints a version.
- [ ] **Step 2: Write failing tests.** `test_settings.py`: `test_defaults` (`get_settings()` with a clean env returns `daily_generation_cap == 50`, `auto_publish_enabled is False`, `image_policy == "hotlink"`), `test_invalid_cap_raises` (`DAILY_GENERATION_CAP=0` raises `ValueError`). `test_banned_phrases.py`: `test_list_matches_ai_writer_prompt` (every phrase in `banned_phrases.json` appears in `app.ai_writer._SYSTEM_PROMPT`, case-insensitive), and `test_includes_delve_and_moreover`.
- [ ] **Step 3:** Run them; expect FAIL (module missing).
- [ ] **Step 4:** Implement `settings.py` following the `app/config.py` pattern (`_positive_int` style validation, `load_dotenv()`), and write the two JSON files. `banned_phrases.json` lists the phrases from the prompt: "in today's fast-paced world", delve, delving, tapestry, "testament to", "in conclusion", moreover, furthermore, beacon, landscape, realm, symphony, "it is important to remember". `keyword_rules` seeds `PRODUCT_LAUNCH` (launches, unveils, introduces) and `TRANSFORMATION` (before and after, transformed, turned around).
- [ ] **Step 5:** Append the new settings to `.env.example`; apply the spec amendments.
- [ ] **Step 6:** Run `.venv/bin/python -m pytest tests/framework_stage -v`; expect PASS. Commit: `feat(stage): scaffold framework_stage settings and config`.

### Task 2: Models and framework strategy

**Files:**
- Create: `framework_stage/models.py`, `framework_stage/strategy.py`, `tests/framework_stage/test_strategy.py`

**Interfaces:**
- Produces in `models.py`: `ArticleStatus(StrEnum)`, `ContentType(StrEnum)`, `SourceArticle(BaseModel)` (`url_hash, source_url, domain, niche: str|None, original_title: str|None, original_author: str|None, published_at: str|None, original_content: str, genz_title: str|None, hook: str|None, tldr: list[str], source_attribution: str|None`), `Claim(text, source_quote)`, `GeneratedArticle(title, slug, summary, body_md, framework, content_type, category, tags, seo_title, seo_description, keywords, claims: list[Claim])`, `ValidationResult(passed: bool, hard_fail: bool, confidence: float, fact_risk: Literal["LOW","MEDIUM","HIGH"], flags: list[str])`, `Fingerprint(content_hash: str, norm_title: str, simhash: int)`, `KnownArticle(url_hash: str, cluster_id: str, fingerprint: Fingerprint)`, `SiteArticleRecord` (all `site_articles` columns from the spec plus the amendment columns), `JobRecord` (`job_id, url_hash, started_at, finished_at, duration_ms, stages: dict[str,str], error: str|None, model, tokens_in, tokens_out, est_cost_usd`).
- Produces in `strategy.py`: `load_strategy(path: Path | None = None) -> FrameworkStrategy`; `FrameworkStrategy.select(content_type: str, niche: str | None = None, override: str | None = None) -> str`.

- [ ] **Step 1: Write failing tests.** `test_general_news_maps_to_aida`, `test_problem_focused_maps_to_pas`, `test_niche_override_beats_content_type` (config with `niche_overrides: {"health_wellness": "PAS"}` returns `PAS` for `GENERAL_NEWS`), `test_explicit_override_beats_niche_override`, `test_unknown_content_type_falls_back_to_default_and_warns` (uses `caplog`), `test_override_with_unknown_framework_raises_ValueError`, `test_all_seven_frameworks_have_a_prompt_file` (marked to pass after Task 7; xfail until then, see Task 7 step 1).
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement the models and `FrameworkStrategy`. Precedence: `override` > `niche_overrides[niche]` > `content_types[content_type]` > `default`. Validate every framework name against the 7 keys.
- [ ] **Step 4:** Run tests and Pyright; expect PASS and 0 errors. Commit: `feat(stage): models and framework strategy`.

### Task 3: Read-only source reader

**Files:**
- Create: `framework_stage/source_reader.py`, `tests/framework_stage/test_source_reader.py`

**Interfaces:**
- Consumes: `SourceArticle`.
- Produces: `read_unprocessed(db_path: Path, processed_hashes: set[str], limit: int) -> list[SourceArticle]`; `read_by_hash(db_path: Path, url_hash: str) -> SourceArticle | None`.

- [ ] **Step 1: Write failing tests** using a temp SQLite file built with the exact `articles` schema from `app/database.py`: `test_returns_only_unprocessed_newest_first`, `test_limit_is_respected`, `test_tldr_json_is_decoded_to_list`, `test_missing_db_file_raises_FileNotFoundError_and_does_not_create_it`, `test_connection_is_read_only` (an `INSERT` through the reader's connection raises `sqlite3.OperationalError`).
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement with `sqlite3.connect(f"file:{path}?mode=ro", uri=True)`; map `tldr_json` through `json.loads`; skip rows whose `original_content` is NULL by returning them with empty text (the runner rejects them).
- [ ] **Step 4:** Run tests and Pyright; expect PASS. Commit: `feat(stage): read-only source reader`.

### Task 4: Normalization and dedup

**Files:**
- Create: `framework_stage/normalize.py`, `framework_stage/dedup.py`, `tests/framework_stage/test_dedup.py`

**Interfaces:**
- Consumes: `SourceArticle`, `Fingerprint`, `KnownArticle`, `Settings` thresholds.
- Produces: `normalize_title(title: str) -> str` (lowercase, punctuation stripped, stopwords removed, tokens sorted-stable); `content_hash(text: str) -> str` (SHA-256 of whitespace-normalized lowercase text); `simhash64(text: str) -> int`; `hamming(a: int, b: int) -> int`; `fingerprint(article: SourceArticle) -> Fingerprint`; `DedupResult(kind: Literal["UNIQUE","EXACT","SAME_STORY"], cluster_id: str, primary_url_hash: str | None)`; `find_duplicate(article: SourceArticle, known: list[KnownArticle], *, title_jaccard_min: float, simhash_max_distance: int) -> DedupResult`.

- [ ] **Step 1: Write failing tests.** `test_same_url_hash_is_exact`, `test_same_content_different_url_is_exact`, `test_same_event_different_headlines_is_same_story` ("Govt launches new EV subsidy scheme" vs "New EV subsidy scheme launched by govt"), `test_unrelated_articles_are_unique`, `test_same_story_returns_existing_cluster_id`, `test_unique_gets_new_cluster_id_equal_to_its_url_hash`, `test_simhash_identical_text_distance_zero`, `test_normalize_title_ignores_case_and_punctuation`.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement. Same story means title token Jaccard at or above `title_jaccard_min` or content SimHash distance at or below `simhash_max_distance`. SimHash is built from word 3-shingles hashed with `hashlib.md5`, 64 bits.
- [ ] **Step 4:** Run tests and Pyright; expect PASS. Commit: `feat(stage): normalization and near-duplicate detection`.

### Task 5: SEO helpers

**Files:**
- Create: `framework_stage/seo.py`, `tests/framework_stage/test_seo.py`

**Interfaces:**
- Produces: `slugify(text: str) -> str`; `unique_slug(base: str, exists: Callable[[str], bool]) -> str`; `truncate_at_word(text: str, limit: int) -> str`; `build_seo(generated: GeneratedArticle, slug_exists: Callable[[str], bool]) -> GeneratedArticle` (returns a copy with `slug` unique, `seo_description` at most 155 chars, `seo_title` at most 60 chars, no em-dashes).

- [ ] **Step 1: Write failing tests.** `test_slugify_lowercases_and_hyphenates`, `test_slugify_strips_em_dashes_and_accents`, `test_unique_slug_appends_suffix_on_collision` (`base`, `base-2`, `base-3`), `test_truncate_at_word_never_exceeds_limit_or_cuts_a_word`, `test_description_is_at_most_155_chars`, `test_slug_never_empty` (title of only symbols yields `article`).
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement; reuse `app.ai_writer.remove_em_dashes` for text clean-up.
- [ ] **Step 4:** Run tests and Pyright; expect PASS. Commit: `feat(stage): slug and SEO helpers`.

### Task 6: LLM client and classifier

**Files:**
- Create: `framework_stage/llm.py`, `framework_stage/classify.py`, `tests/framework_stage/fakes.py`, `tests/framework_stage/test_classify.py`, `tests/framework_stage/test_llm.py`

**Interfaces:**
- Produces in `llm.py`: `LLMError(Exception)`; `LLMResult[T]` (`value: T, tokens_in: int, tokens_out: int`); `LLMClient` Protocol with `generate_structured(self, *, prompt: str, schema: type[T], model: str) -> LLMResult[T]`; `GeminiClient(api_key: str)` implementing it with `response_mime_type="application/json"` and `response_schema=schema`, retrying transient 503/UNAVAILABLE up to 2 times with backoff, and raising `LLMError` on invalid JSON after one re-ask.
- Produces in `fakes.py`: `FakeLLM(responses: list[object | Exception])` recording `calls`.
- Produces in `classify.py`: `ClassificationOut(BaseModel)` (`content_type: ContentType`); `classify_content_type(article: SourceArticle, llm: LLMClient, *, model: str, rules: dict[str, list[str]], long_form_min_chars: int) -> tuple[ContentType, int, int]` (type, tokens_in, tokens_out).

- [ ] **Step 1: Write failing tests.** `test_classify.py`: `test_long_text_is_long_form_without_llm_call` (`FakeLLM.calls == []`), `test_keyword_rule_matches_product_launch_without_llm_call`, `test_falls_through_to_llm_for_ambiguous_article`, `test_llm_invalid_content_type_raises_LLMError`. `test_llm.py` (with a stubbed `genai` client): `test_retries_503_then_succeeds`, `test_gives_up_after_two_retries_with_LLMError`, `test_non_json_response_reasked_once_then_LLMError`.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement. Order in `classify_content_type`: length rule, keyword rules (title and first 300 chars), then LLM call on title and first 1500 chars. Backoff sleeps go through an injectable `sleep` parameter so tests run instantly.
- [ ] **Step 4:** Run tests and Pyright; expect PASS. Commit: `feat(stage): LLM client and content-type classifier`.

### Task 7: Prompts and generator

**Files:**
- Create: `framework_stage/prompts/_header.md`, `framework_stage/prompts/{aida,pas,bab,4ps,fab,storybrand,quest}.md`, `framework_stage/generate.py`, `tests/framework_stage/test_generate.py`

**Interfaces:**
- Consumes: `LLMClient`, `SourceArticle`, `GeneratedArticle`, `banned_phrases.json`.
- Produces: `build_prompt(article: SourceArticle, framework: str, content_type: str) -> str`; `generate_article(article: SourceArticle, framework: str, content_type: str, llm: LLMClient, *, model: str) -> tuple[GeneratedArticle, int, int]`; `assemble_body(tldr: list[str], body_md: str, attribution: str) -> str` (TL;DR block, then framework body, then attribution footer).

- [ ] **Step 1: Write failing tests.** `test_every_framework_has_a_prompt_file` (also remove the xfail on the Task 2 test), `test_prompt_contains_source_text_and_framework_name`, `test_prompt_contains_every_banned_phrase_and_no_em_dash_rule`, `test_prompt_forbids_invented_facts_and_requires_source_quotes_for_claims`, `test_prompt_source_text_is_not_truncated_below_max_article_chars` (a 12,000-char source appears in full; this fixes known issue #7 for the new stage), `test_generate_returns_framework_and_content_type_set_by_caller` (the model cannot change them), `test_assemble_body_order_and_exactly_three_tldr_bullets`.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Write the shared header (grounding rules, banned list injected from JSON, output schema, "write only the body; do not repeat the TL;DR or the attribution") and one short template per framework describing its sections for news (for example AIDA: Attention, Interest, Desire, Action framed as why-it-matters). Implement `build_prompt` by concatenating header, template and the source block. After generation, force `framework` and `content_type` to the values passed in.
- [ ] **Step 4:** Run tests and Pyright; expect PASS. Commit: `feat(stage): framework prompts and article generator`.

### Task 8: Validation

**Files:**
- Create: `framework_stage/validate.py`, `tests/framework_stage/test_validate.py`

**Interfaces:**
- Consumes: `GeneratedArticle`, `ValidationResult`, `banned_phrases.json`.
- Produces: `ungrounded_facts(body: str, source: str) -> list[str]` (entries like `UNGROUNDED_NUMBER:45`, `UNGROUNDED_ENTITY:Zorblax`); `validate_article(generated: GeneratedArticle, source_text: str, tldr: list[str]) -> ValidationResult`.

- [ ] **Step 1: Write failing tests.** `test_em_dash_in_body_is_hard_fail`, `test_banned_phrase_is_hard_fail` ("Let us delve into it"), `test_tldr_not_three_is_hard_fail`, `test_number_not_in_source_is_flagged_medium_risk` (body says 45%, source lacks 45), `test_unknown_capitalized_entity_is_flagged`, `test_entity_at_sentence_start_is_not_flagged_when_common_word`, `test_claim_quote_missing_from_source_is_high_risk`, `test_three_or_more_ungrounded_items_is_high_risk`, `test_clean_grounded_article_passes_low_risk_high_confidence`, `test_confidence_drops_per_flag_and_never_below_zero`.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement per spec 4.5 items 1, 2, 3 (TL;DR count only), 4, 5. Normalize case and whitespace before substring checks. Risk: HIGH if 3 or more ungrounded items or any missing claim quote; MEDIUM if 1 or 2; else LOW. Confidence is `max(0, 1 - 0.15 * len(flags))`. `hard_fail` is true for em-dash, banned phrase, or TL;DR count.
- [ ] **Step 4:** Run tests and Pyright; expect PASS. Commit: `feat(stage): grounding and editorial validation`.

### Task 9: Store and Supabase migration

**Files:**
- Create: `framework_stage/store.py`, `web/supabase/migrations/0001_site_tables.sql`, `tests/framework_stage/test_store.py`

**Interfaces:**
- Consumes: `SiteArticleRecord`, `JobRecord`, `KnownArticle`.
- Produces: `SiteStore` Protocol with `processed_hashes() -> set[str]`, `recent_fingerprints(hours: int) -> list[KnownArticle]`, `slug_exists(slug: str) -> bool`, `generations_today() -> int`, `pending_regenerations() -> list[tuple[str, str]]` (url_hash, forced framework), `insert_article(record: SiteArticleRecord) -> None`, `update_generated(url_hash: str, record: SiteArticleRecord) -> None` (regeneration: replaces generated fields, keeps `body_md` only if the status is not `PROCESSING`), `add_also_reported_by(primary_url_hash: str, source: dict[str, str]) -> None`, `record_job(job: JobRecord) -> None`; `InMemoryStore` (for tests) and `SupabaseStore(client)`.

- [ ] **Step 1: Write failing tests** against `InMemoryStore`, plus a contract test suite parameterized over both implementations (`SupabaseStore` driven by a fake client): `test_insert_then_processed_hashes_contains_it`, `test_insert_twice_does_not_overwrite_status_or_body`, `test_slug_exists`, `test_generations_today_counts_only_today`, `test_pending_regenerations_lists_processing_rows_with_forced_framework`, `test_also_reported_by_appends_without_duplicates`.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement both stores. `SupabaseStore.insert_article` uses insert with `url_hash` unique and treats a conflict as "already exists" (no error). Write the migration with `site_articles`, `site_jobs`, indexes on `status, published_at, category, cluster_id`, a generated `tsvector` column on title, summary and body, RLS enabled, a public `SELECT` policy where `status = 'PUBLISHED'`, and an admin policy keyed to an `admin_emails` allowlist table.
- [ ] **Step 4:** Run tests and Pyright; expect PASS. Commit: `feat(stage): site store and Supabase migration`.

### Task 10: Safe og:image fetch

**Files:**
- Create: `framework_stage/images.py`, `tests/framework_stage/test_images.py`

**Interfaces:**
- Produces: `is_public_http_url(url: str, resolver: Callable[..., Any] = socket.getaddrinfo) -> bool`; `fetch_og_image(url: str, *, get: Callable[..., Any] = requests.get, resolver: Callable[..., Any] = socket.getaddrinfo) -> str | None`.

- [ ] **Step 1: Write failing tests.** `test_rejects_localhost_and_private_ranges` (127.0.0.1, 10.x, 192.168.x, 169.254.169.254, `::1`), `test_rejects_non_http_schemes`, `test_hostname_resolving_to_private_ip_is_rejected`, `test_redirect_to_private_ip_is_not_followed`, `test_redirect_limit_is_three`, `test_reads_at_most_512kb_and_5s_timeout` (assert the `get` kwargs), `test_extracts_og_image_and_resolves_relative_url`, `test_returns_none_when_no_og_image_or_on_any_request_error`, `test_non_http_image_url_returns_none`.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement with `allow_redirects=False` and a manual redirect loop that re-checks each hop; stream the response and stop at 512 KB; parse `<meta property="og:image">` with `html.parser` (no regex on HTML).
- [ ] **Step 4:** Run tests and Pyright; expect PASS. Commit: `feat(stage): SSRF-safe og:image fetch`.

### Task 11: Runner, CLI, lock, logging

**Files:**
- Create: `framework_stage/runner.py`, `framework_stage/lock.py`, `framework_stage/jsonlog.py`, `run_framework_stage.py`, `tests/framework_stage/test_runner.py`, `tests/framework_stage/test_lock.py`
- Modify: `.claude/CLAUDE.md` (add the new CLI to the Commands block)

**Interfaces:**
- Consumes: everything above.
- Produces: `RunSummary(processed: int, skipped_duplicate: int, failed: int, regenerated: int, tokens_in: int, tokens_out: int, est_cost_usd: float)`; `run_stage(*, source_db: Path, store: SiteStore, llm: LLMClient, settings: Settings, strategy: FrameworkStrategy, fetch_image: Callable[[str], str | None], now: Callable[[], datetime]) -> RunSummary`; `file_lock(path: Path)` context manager raising `LockHeldError`; JSON-line log formatter.

Per article the stages run in this order and each outcome is written to `JobRecord.stages`: `dedup, classify, framework, generate, validate, seo, image, store`. The status is `FAILED` on a hard validation failure (after one regeneration), `INSUFFICIENT_SOURCE`, or any `LLMError`; otherwise `REVIEW_REQUIRED`, or `APPROVED` only when auto-publish is enabled, the niche is allowed and confidence meets the threshold (a later publish step, in the website plan, moves `APPROVED` to `PUBLISHED`).

- [ ] **Step 1: Write failing tests** (fake LLM, `InMemoryStore`, temp `articles.db`): `test_new_article_is_stored_as_review_required_with_framework_and_job`, `test_second_run_creates_nothing`, `test_published_article_is_not_overwritten_on_rerun`, `test_thin_source_is_failed_insufficient_source_with_zero_llm_calls`, `test_malformed_llm_output_retries_once_then_failed_and_batch_continues`, `test_same_story_generates_once_and_links_other_outlet`, `test_exact_duplicate_makes_no_llm_call`, `test_store_error_on_one_article_does_not_stop_batch`, `test_daily_cap_stops_generation_and_reports_it`, `test_run_limit_caps_articles_per_run`, `test_regeneration_request_uses_forced_framework_and_clears_flag`, `test_auto_publish_off_by_default_even_at_confidence_one`, `test_auto_publish_requires_enabled_niche_and_threshold`, `test_hard_validation_failure_regenerates_once_then_failed`, `test_est_cost_uses_settings_prices`, `test_image_failure_still_stores_article_with_null_image`. `test_lock.py`: `test_second_acquire_raises_LockHeldError`, `test_stale_lock_from_dead_pid_is_reclaimed`, `test_lock_released_after_exception`.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement `run_stage`: wrap each article in its own try/except, emit one JSON log line per stage (`job_id, url_hash, stage, duration_ms, status`), and aggregate tokens and cost. The lock is a pid file with `O_EXCL` creation and stale-pid detection (no new dependency).
- [ ] **Step 4:** Implement `run_framework_stage.py`: parse `--limit`, `--dry-run` (runs everything except the store writes), wire `GeminiClient`, `SupabaseStore` from settings, hold the lock, print the summary, and exit non-zero if the lock is held or credentials are missing.
- [ ] **Step 5:** Run the full suite `.venv/bin/python -m pytest tests -v` and `.venv/bin/pyright framework_stage`; expect all PASS (existing scraper tests included) and 0 errors. Confirm `git status --short app run_pipeline.py run_specific_indian_batch.py sources.json supabase_setup.sql` prints nothing.
- [ ] **Step 6:** Update the Commands block in `.claude/CLAUDE.md`. Commit: `feat(stage): runner, CLI, lock and structured logging`.

---

## Self-review notes

- Spec coverage: sections 2 (untouched pipeline, Task 11 step 5), 4.1 to 4.9 (Tasks 2 to 11), 5 (Task 9), 8 (Task 11), 9 (Tasks 9 and 10). Sections 6 and 7 (site, admin) are the next plan. The local `articles.db` is absent on this machine, so tests build a fixture DB and a first real run needs the pipeline to have run once.
- `ValidationResult`, `Fingerprint`, `KnownArticle` and `LLMResult` signatures are used identically in Tasks 4, 6, 8, 9 and 11.
