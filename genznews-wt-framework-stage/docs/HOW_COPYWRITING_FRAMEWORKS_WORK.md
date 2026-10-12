# How Copywriting Frameworks Work in AajKiJanta (Full Guide)

Companion to `docs/COPYWRITING_FRAMEWORKS.md` (the decision table, the source of truth). This guide explains the whole mechanism end to end: what a framework is, how one gets chosen, how it reaches the article, what lands in Supabase, and how to operate and change it.

Framework ideas come from the PDF "10 Legendary Copywriting Frameworks" (Moritz Kaiser).

---

## 1. The idea in one minute

A **copywriting framework** is a proven skeleton for ordering information so a reader keeps reading. Example: PAS says "state the problem, make its weight felt, then give the fix."

AajKiJanta takes a scraped news article and rewrites it a second time. The second rewrite follows one framework, chosen automatically from the type of story. The framework changes the **order and emphasis** of the facts. It never adds facts.

```
Stage 1 (existing)                      Stage 2 (framework stage)
RSS -> scrape -> Gemini Gen Z rewrite   read articles.db -> classify type -> pick framework
        -> articles.db (SQLite)         -> generate with that framework's prompt -> validate
                                        -> SEO + image -> Supabase site_articles -> review -> website
```

## 2. The 10 frameworks

| Key | Name | Steps | Used for |
|---|---|---|---|
| `AIDA` | Attention, Interest, Desire, Action | hook, why it matters, stakes, what to do or watch | Default, ordinary news |
| `PAS` | Problem, Agitate, Solution | problem, consequences, response | Risks, failures, scams, crises |
| `BAB` | Before, After, Bridge | before, after, how it got there | Turnarounds, change stories |
| `FAB` | Features, Advantages, Benefits | what it is, better than before, who gains | Launches, new schemes and rules |
| `PPPP` | Picture, Promise, Prove, Push | scene, promised outcome, evidence, next step | Campaigns, drives, trends with a call to act |
| `SSS` | Star, Story, Solution | who, what happened, how it resolved | Profiles, human interest |
| `OPEN_LOOPS` | Open Loops | open question, deliver in sections, close each loop | Long reads (6000+ chars) |
| `4US` | Useful, Urgent, Unique, Ultra-specific | most useful specific first | Lists, tips, roundups |
| `4WS` | What, What it does, Who, What next | what, effect on you, who, next steps | Explainers, guides |
| `4CS` | Clear, Concise, Compelling, Credible | plain lead, tight facts, one angle, attribution | Short factual items |

## 3. How a framework is chosen (step by step)

For every unprocessed article the runner (`framework_stage/runner.py`) does this:

1. **Read** the article from `articles.db` (read-only).
2. **Dedup** against recent articles (title similarity, simhash). Duplicates are skipped.
3. **Classify content type** (`framework_stage/classify.py`):
   1. Source text length >= 6000 characters: `LONG_FORM`.
   2. Else the first matching `keyword_rules` entry (looks at title plus the first 300 characters).
   3. Else the LLM picks one type, shown the "when to use" guide from the config.
4. **Select framework** (`framework_stage/strategy.py`), first match wins:
   1. Admin `regen_framework` on the row
   2. `niche_overrides` (empty today)
   3. `content_types` mapping
   4. Default `AIDA`
5. **Generate** (`framework_stage/generate.py`): the prompt is `_header.md` (grounding, tone, style, output schema) + `prompts/<framework>.md` (the skeleton) + the source article.
6. **Validate** (`validate.py`): claims must quote the source, no ungrounded numbers or entities, no banned phrases, no em-dashes. A hard fail triggers a retry.
7. **SEO, image, store**: fields are filled and the row is written to Supabase.
8. **Status**: `PUBLISHED` only if auto-publish is on for the niche and confidence >= threshold with no flags; otherwise `REVIEW_REQUIRED`.

### Content type to framework

| content_type | Framework |
|---|---|
| `GENERAL_NEWS` | `AIDA` |
| `PROBLEM_FOCUSED` | `PAS` |
| `TRANSFORMATION` | `BAB` |
| `PRODUCT_LAUNCH` | `FAB` |
| `PERSUASIVE` | `PPPP` |
| `BRAND_STORY` | `SSS` |
| `LONG_FORM` | `OPEN_LOOPS` |
| `LISTICLE` | `4US` |
| `EXPLAINER` | `4WS` |
| `FACT_BRIEF` | `4CS` |

## 4. Where everything lives

| What | Where |
|---|---|
| Decision table (human) | `docs/COPYWRITING_FRAMEWORKS.md` |
| Mapping, keyword rules, type guide (machine) | `framework_stage/config/frameworks.json` |
| Selection logic, valid framework keys | `framework_stage/strategy.py` |
| Type classifier | `framework_stage/classify.py` |
| Content type enum | `framework_stage/models.py` (`ContentType`) |
| Shared prompt rules | `framework_stage/prompts/_header.md` |
| One prompt per framework | `framework_stage/prompts/<key lowercase>.md` |
| Banned phrases | `framework_stage/config/banned_phrases.json` |
| LLM clients (Gemini, OpenAI, fallback) | `framework_stage/llm.py` |
| CLI | `run_framework_stage.py` |
| Supabase tables | `web/supabase/migrations/0001_site_tables.sql`, `0002_copywriting_frameworks.sql` |
| Sync test (config, prompts, doc, SQL) | `tests/framework_stage/test_framework_truth.py` |

## 5. What Supabase stores

Table `site_articles` (one row per article, key `url_hash`):

- `content_type`: one of the 10 types (check constraint).
- `framework`: the key used (foreign key to `copywriting_frameworks`).
- `regen_framework`: set by an admin to force a different framework; the next run regenerates with it, then clears it.
- `body_md` / `generated_body_md`: edited copy and the original generation.
- `status`, `flags`, `confidence`: review state and validator results.

Table `copywriting_frameworks`: the 10 keys with name, steps, best-for text. Publicly readable, written only with the service key. Use it to fill an admin dropdown.

Useful queries:

```sql
-- how many articles per framework
select framework, content_type, count(*) from site_articles group by 1, 2 order by 3 desc;
-- latest articles and what needs review
select framework, status, title, flags from site_articles order by created_at desc limit 20;
-- force a regeneration with another framework
update site_articles set regen_framework = 'PAS', status = 'PROCESSING' where url_hash = '<hash>';
```

## 6. Running it

Setup: `.env` in the repo root (see `.env.example`). Needed: `GEMINI_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`. Optional: `OPENAI_API_KEY`, `OPENAI_MODEL` (fallback), `AUTO_PUBLISH_ENABLED`.

```bash
cd genznews-wt-framework-stage
source .venv/bin/activate
set -a; . ./.env; set +a

python run_pipeline.py --per-niche 3          # stage 1: scrape + first rewrite -> articles.db
python run_framework_stage.py --dry-run --limit 3   # stage 2 without writing to Supabase
python run_framework_stage.py --limit 10      # stage 2 for real
```

Stage 2 prints a JSON summary: `processed`, `failed`, `skipped_duplicate`, `tokens_in/out`, `est_cost_usd`, `llm_unavailable`. Exit codes: 0 ok, 1 runtime error, 2 bad config, 3 another run holds the lock.

Safety settings: `AUTO_PUBLISH_ENABLED=false` sends everything to review. `DAILY_GENERATION_CAP` and `RUN_LIMIT` limit spend.

### LLM provider and fallback

Gemini is primary. If Gemini is out of quota or overloaded (429/503/504), the same call is retried on OpenAI (`OPENAI_MODEL`, default `gpt-4o-mini`). Other errors (bad output) do not trigger the fallback. If both are down, the batch stops without writing failed rows, so those articles are retried next run.

## 7. What a framework changes in the output

Same facts, different order. Example from a real run:

- `4WS` (explainer, "How to Convert JPG to PDF"): sections What, What it does for you, Who, What next (numbered steps).
- `PAS` (education reform story): opens on the pressure problem, then the consequences, then reform responses.
- `OPEN_LOOPS` (long read): 3 to 5 short sections, each ending by setting up the next.

Every article also gets the fixed blocks: TL;DR at the top and the source attribution. Those are not regenerated by the framework step.

## 8. How to change things

| I want to... | Do this |
|---|---|
| Change which type uses which framework | Edit `content_types` in `frameworks.json` and the table in both docs |
| Make a niche always use one framework | Add `niche_overrides: {"health_wellness": "PAS"}` |
| Catch more articles as a type | Add words to `keyword_rules` (order matters, first match wins) |
| Tweak how a framework writes | Edit `prompts/<key>.md` |
| Add a new framework | Add key to `FRAMEWORKS` in `strategy.py`, a prompt file, a row via a new migration, a doc row; then run tests |
| Re-write one article with another framework | Set its `regen_framework`, status `PROCESSING`, run stage 2 |

Always run `python -m pytest tests/framework_stage` afterwards. The sync test fails if the config, prompt files, doc and SQL drift apart.

## 9. Rules that never bend

1. Facts come only from the source article. Frameworks shape structure only.
2. No invented quotes, numbers, people or dates.
3. No em-dashes, no banned AI-cliche phrases (`banned_phrases.json`).
4. "Sell" frameworks (PAS, PPPP, AIDA) are used as reporting structure, with no fake urgency or stakes.
5. Headlines should hit at least two of the 4 U's, only where true.

## 10. Troubleshooting and known issues

| Symptom | Cause / fix |
|---|---|
| `processed: 0`, `llm_unavailable: true` | Gemini quota hit and no OpenAI key. Set `OPENAI_API_KEY` or wait for reset. Articles are retried automatically. |
| `processed` lower than `--limit` | Rest are already in `site_articles` (dedup by `url_hash`). |
| Everything `REVIEW_REQUIRED` | Auto-publish off, or validator flags (`UNGROUNDED_NUMBER`, `UNGROUNDED_ENTITY`, `CLAIM_QUOTE_MISSING`). Review in admin. |
| Supabase insert rejects a framework | Value is not one of the 10 keys (foreign key). |
| `Could not find table public.articles` in stage 1 | Legacy sync from the old schema. Harmless. |
| Exit code 3 | Another run holds `.framework_stage.lock`; wait or remove a stale lock. |

Known quality issues seen so far:
- Fixed: the `4WS` prompt used to print step names as H1 headings ("# What:"). `_header.md` now forbids step names as headings and asks for natural H2 titles. Verify on the next explainer.
- Articles written by the OpenAI fallback may differ slightly in voice from Gemini ones.
- `4US`, `4CS` and `PPPP` have not been seen on a real article yet; verify their output when the first one appears.
- Some PAS titles come out softer than the story warrants; review before approving.
