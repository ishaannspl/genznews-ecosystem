# Runbook

## Setup
```bash
python -m venv venv && source venv/bin/activate     # Windows: venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env     # set GEMINI_API_KEY; optional SUPABASE_URL / SUPABASE_KEY
```
Supabase: run `supabase_setup.sql` once in the SQL editor.

## Env vars
| Var | Default | Purpose |
|---|---|---|
| `GEMINI_API_KEY` | none, required | Gemini auth |
| `GEMINI_MODEL` | `gemini-3.5-flash` | primary model (fallback `gemini-3.5-flash-lite` is hardcoded) |
| `SUPABASE_URL` / `SUPABASE_KEY` | none | cloud sync, falls back to `NEXT_PUBLIC_*` variants |
| `USER_AGENT` | `GenZNewsAI/0.1 ...` | scraper header |
| `REQUEST_TIMEOUT_SECONDS` | 15 | scrape timeout |
| `MIN_ARTICLE_CHARS` / `MAX_ARTICLE_CHARS` | 200 / 30000 | extraction bounds |

## Everyday tasks
| Task | Command |
|---|---|
| Verify keys and DB | `python check_connections.py` |
| One article per niche | `python run_pipeline.py --per-niche 1` |
| Only some niches | `python run_pipeline.py --niches health_wellness education_career` |
| Poll every N minutes | `python run_pipeline.py --interval 30` (1440 = daily) |
| Five named outlets | `python run_specific_indian_batch.py` |
| Single URL via API | `curl -X POST localhost:8000/generate -H 'content-type: application/json' -d '{"url":"https://...","niche":"health_wellness"}'` |
| Unit tests | `python -m pytest tests` |
| Live scraper report | `python live_test.py` |
| Full-chain test | `python test_pipeline.py` (hits Gemini and Supabase) |

## Troubleshooting
| Symptom | Likely cause |
|---|---|
| `GEMINI_API_KEY is not set in .env` | missing `.env` or run from a different directory |
| `[Gemini] Overloaded, retrying` | 503 from Gemini; backoff is automatic, then fallback model |
| `Article extraction produced too little text` | paywall, JS-rendered page, or video page; skip it |
| `HTTP 403` from scraper | site blocks the user agent |
| `Supabase sync skipped` | bad URL/key or table missing; local SQLite row is still saved |
| 409 on `/generate` | URL already in SQLite or Supabase |
| Pipeline says all cached | every feed entry already processed; delete the row or use a different feed |

For anything unexpected, start with the `systematic-debugging` skill rather than guessing.
