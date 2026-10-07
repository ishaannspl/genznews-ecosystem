# GenZNews engine

Python 3.11+ / FastAPI pipeline: RSS → dedup → scrape (Trafilatura) → Gemini rewrite in Gen Z voice → SQLite + Supabase + Markdown in `output/<niche>/`. Target site: genznews.site (WordPress publishing is a future Phase 4).

Details: `.claude/docs/` (architecture, runbook, editorial rules, known issues, skills).

## Commands (run from this folder)
```bash
pip install -r requirements.txt
python check_connections.py                 # Gemini + Supabase smoke test
python run_pipeline.py --per-niche 1        # one run; add --niches a b, --interval MINUTES
python run_specific_indian_batch.py         # 5 named Indian outlets
uvicorn app.main:app --reload               # API, docs at /docs
python -m pytest tests                      # unit tests (pytest is not installed by default in every env)
```

## Rules for changes
- Keep Pyright clean; type hints on new code, Pydantic models in `app/schemas.py`.
- All AI output must pass `remove_em_dashes()`; never weaken the banned-phrase list or the 3-bullet TL;DR / 155-char meta description rules in `app/ai_writer.py`.
- Never commit `.env`, `articles.db`, `output/*.json`. Use `.env.example` for new settings and read them via `app/config.py`.
- Scraper tests mock `requests.get` and `trafilatura`; do not hit the network in `tests/`. Live checks belong in `live_test.py` / `test_pipeline.py`.
- Schema changes must be made in both `init_sqlite_db()` (`app/database.py`) and `supabase_setup.sql`.
- This folder has its own git repo (`genznews/.git`), separate from the parent NuForm repo.

## Workflow
New feature: `brainstorming` → `writing-plans` → `test-driven-development` → `requesting-code-review`.
Bug: `systematic-debugging` first. Before release: `security-and-hardening`, `shipping-and-launch`.
Skill index: `.claude/docs/skills.md`. Review agents: `architect-review`, `code-reviewer`, `security-auditor`; commands `/full-review`, `/pr-enhance`.
