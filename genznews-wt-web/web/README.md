# GenZNews web

## What this is

The GenZNews reading site. It is a Next.js App Router app (React 19, Tailwind 4) that shows published stories only: a home page, a latest feed, five category pages, search, article pages and an about page. It reads from the Supabase table `public.site_articles` with the public (anon) key, so row level security limits it to rows with `status = 'PUBLISHED'`. The stories are written by the framework stage (Python, in `../framework_stage/`), which stores each one as `REVIEW_REQUIRED` (or `APPROVED` if auto-publish is switched on; it never writes `PUBLISHED`); a person publishes them. See "How stories reach the site".

## Quick start with real data

```bash
cd web
npm ci
cp .env.example .env.local
# edit .env.local: set SUPABASE_URL and SUPABASE_ANON_KEY (the publishable key)
# Apply the migrations (see "Database setup") before `npm run dev`.
npm run dev -- -p 3100
```

Apply the migrations (`0001` and `0002`, see "Database setup") before `npm run dev`. Port 3000 may already be taken (Docker often uses it), so these docs use 3100. Open http://localhost:3100.

Values go in `.env.local`, which git ignores. Example shapes:

```
DATA_SOURCE=supabase
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_ANON_KEY=sb_publishable_xxx
```

### What the console shows

Logging is on in development (`DATA_LOG`, below). On the first request you see:

```
[genznews] 10:21:04 data  source=supabase  host=<project-ref>.supabase.co table=public.site_articles key="publishable (read only; row level security shows only status=PUBLISHED)" fallback=none
[genznews] 10:21:05 data  connected: 12 published rows  duration=180ms
```

- The first line is the source banner. Check the host name is your project and `fallback=none` is present. There is no fallback to demo data.
- The second line is the connection check. It runs once in the background and never blocks a page. It reports `connected` only when `public.site_articles` answered with a row count; a missing table, a rejected key or any other error prints `connection check failed` with a reason and a fix.
- Each data call prints one line (what was asked, how many rows, how long). Each page prints a decision line under its own scope (`home`, `latest`, `category`, `article`, `search`) saying what it rendered and why.
- A transient failure prints `retrying once after transient error`; repeated identical failures within 5 seconds are summarised in one line.
- Keys, tokens and query strings are redacted. URLs are reduced to a host name. Article bodies are never logged.

### How errors read

The reason and the fix come from `src/lib/explainError.ts`.

| Console reason | Cause | Fix |
| --- | --- | --- |
| Host name not found (DNS lookup failed) | `SUPABASE_URL` points at a project that does not exist | Copy the Project URL from Supabase, Project Settings, API, into `SUPABASE_URL` |
| Table public.site_articles not found | Migrations not applied | Run `supabase/migrations/0001_site_tables.sql`, then `0002_published_at_default.sql`, in the Supabase SQL editor (or paste the generated `supabase/import/setup-and-import.sql`, see "Importing the legacy articles") |
| The key was rejected (401) | Wrong or mismatched key | Use the publishable (anon) key of the same project as `SUPABASE_URL` |
| Not allowed to read this table (403) | Row level security policies missing | Re-check the policies in `0001_site_tables.sql` |
| Connection timed out | Wrong URL or project paused | Check `SUPABASE_URL` and that the project is not paused |
| Connection refused / reset | Server not reachable | Check the URL and your network |

On the page, listing routes (`/latest`, category pages, search) show a plain error message ("We couldn't load stories...") while the console gives the real reason. The home page behaves differently, see "Rendering and caching".

## DATA_SOURCE rules

`DATA_SOURCE` is required in every environment. There is no default. If it is missing or invalid the app throws and the console says why.

- `supabase`: real data. Also requires `SUPABASE_URL` (http or https) and `SUPABASE_ANON_KEY`.
- `fixtures`: DEMO data built from `../output/*.md` (stored in `src/lib/fixtures/articles.json`). Explicit opt-in only, for local demos and UI tests. The console prints a `DEMO DATA` warning. It is never mixed with real data and never a fallback: if Supabase fails, the site shows an error, not demo stories.

## Environment variables

| Name | Required | Example | What it does | Secret |
| --- | --- | --- | --- | --- |
| `DATA_SOURCE` | Yes, always | `supabase` | `supabase` for real data, `fixtures` for DEMO data | No |
| `SUPABASE_URL` | When `DATA_SOURCE=supabase` | `https://<project-ref>.supabase.co` | Supabase project URL | No |
| `SUPABASE_ANON_KEY` | When `DATA_SOURCE=supabase` | `sb_publishable_xxx` | Publishable key, read only through RLS | No (public by design) |
| `NEXT_PUBLIC_SITE_URL` | Recommended | `https://news.example.com` | Base URL for canonical links, Open Graph and the sitemap. Defaults to `http://localhost:3000` if unset or invalid | No |
| `REVALIDATE_SECRET` | To use `/api/revalidate` | a long random string | Shared secret for the revalidation endpoint. If unset, the endpoint answers 401 | Yes |
| `DATA_LOG` | No | `1` | `1/true/on` or `0/false/off`. Empty: on in development, off in production | No |
| `NEXT_DIST_DIR` | No | `.next-e2e` | Build output folder. Used by the end-to-end tests so they never touch `.next` | No |

`NEXT_PUBLIC_SITE_URL` is inlined at build time. Set it before `npm run build`; changing it later needs a rebuild.

The Supabase service-role key never belongs in this app. The site only ever uses the publishable key. The seed script (below) reads a service key from the shell environment only.

## Database setup

Apply the migrations in order, in the Supabase SQL editor:

1. `supabase/migrations/0001_site_tables.sql`. Safe to run again (each policy is dropped and recreated).
2. `supabase/migrations/0002_published_at_default.sql`, after `0001`. Safe to run again.

Both end with `notify pgrst, 'reload schema';`, which refreshes the API's table cache so new tables are visible at once.

`0001` creates:

- `public.site_articles`: the stories (status, slug, body, SEO fields, source credit, review fields, a generated full text search column and indexes).
- `public.site_jobs`: one row per framework-stage run per story (timings, model, tokens).
- `public.admin_emails`: an allowlist of admin emails, matched against the signed-in user's JWT email.

Row level security is on for all three tables. Anonymous and signed-in users can read `site_articles` rows where `status = 'PUBLISHED'` only. Emails listed in `admin_emails` can also read and update every article and read jobs. Writes from the pipeline use the service role, which bypasses RLS.

To add an admin, run `insert into public.admin_emails (email) values ('you@example.com');`. The admin review UI does not exist yet (see "Known limits"), so this table is groundwork.

### Migration 0002: a publish time for every published row

The framework stage never sets `published_at`, and it never writes `PUBLISHED`. When a person publishes a row by changing `status` (for example in the Supabase table editor), `published_at` used to stay empty, and the site sorted that story after every dated one: never the lead, last page of `/latest`, and a wrong `datePublished`.

`0002` adds a `before insert or update` trigger on `public.site_articles` (function `public.site_articles_set_published_at()`) that sets `published_at = now()` whenever a row is `PUBLISHED` and has no `published_at`. A value you set yourself is kept. It also backfills once: rows already `PUBLISHED` without a publish time get their `created_at`. The site still falls back to `created_at` for a missing `published_at`, as a second line of defence.

### Hardening suggestion (not implemented)

Row level security limits the anon key to `PUBLISHED` rows, but within those rows every column is readable, including review fields the site never shows (`flags`, `confidence`, `fact_risk`, `generated_body_md` and others). Restricting the anon role to the columns the site selects (revoke the table-wide `select`, then `grant select (id, slug, title, ...) on public.site_articles to anon`) would close that. It is not in the migrations yet; test it against the site's queries before applying it.

## Importing the legacy articles

The old pipeline stored its stories in `public.articles` (14 rows when this was written). The site reads `public.site_articles`, so those stories do not show until they are copied across. The old table has no category and no slug, so the export recovers both from the pipeline's local output files `../output/<niche_key>/*.md`: a legacy row is matched to a file by its source URL (the same canonical URL hash the pipeline uses), and takes that file's niche key as its category and the file's slug. Nothing is guessed: a row with no matching file is left out and listed in the summary with the reason. When two files share a source URL, the one whose title equals the row's title is used.

```bash
cd web
npm run export:legacy-sql                                # write the SQL files
npm run export:legacy-sql -- --dry-run                   # summary only, writes nothing
npm run export:legacy-sql -- --status REVIEW_REQUIRED    # import for review instead of PUBLISHED
```

- It reads `SUPABASE_URL` and `SUPABASE_ANON_KEY` from the environment, or from `.env.local`. It only makes GET requests and prints the host name, never a key.
- It writes three files to `supabase/import/` (git-ignored, because they contain the article text; `--out <dir>` picks another folder):
  - `setup-and-import.sql`: migrations `0001` and `0002` followed by the import, for a project where the site tables do not exist yet.
  - `legacy-import.sql`: the import only, for a project where the migrations already ran.
  - `diagnose.sql`: refreshes the API's table cache and shows which site tables exist and how many legacy rows there are.
- The summary shows rows read, exported and skipped (with reasons), the count per category and the file paths.

To apply: Supabase dashboard, SQL editor, New query, paste `setup-and-import.sql`, Run. Everything in it is safe to run again, so after a failed or partial run just paste it again. If the site still reports a missing table, run `diagnose.sql`.

Older stories still contain em-dashes and en-dashes from before the pipeline's sanitizer existed, so the export cleans the title, summary, body (line by line), tags and SEO fields with the same rules as `remove_em_dashes` in `../app/ai_writer.py`, and it stops without writing anything if a dash would still be written.

Rows are imported as `PUBLISHED` (unless `--status REVIEW_REQUIRED`) with `published_at` and `created_at` set to when the old pipeline processed the story, and the flag `LEGACY_IMPORT`. The import runs in one transaction and every insert is `on conflict do nothing`, so running it again is safe: rows that already exist (same `url_hash` or `slug`) are left untouched. The last statement shows how many imported rows exist per status. The output is deterministic, so regenerating it gives the same file.

Next step: reload the site. The console should show `connected: 14 published rows` (or your count), and the stories appear on the home page within 5 minutes, or at once after a revalidate (see "How stories reach the site").

### Security: lock the legacy table after importing

`public.articles` was created with row level security disabled (`../supabase_setup.sql`). Anyone with the publishable key can read it, including the full source text in `original_content`, and can most likely write to it too. The publishable key is public by design: it is meant for browsers, and env names such as `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` ship it to every visitor. After the import, consider running this in the SQL editor, deliberately and by hand (it is not part of any generated file):

```sql
alter table public.articles enable row level security;
```

With no policies this locks the public key out of `public.articles` completely. The old pipeline's best-effort Supabase sync will stop writing to it, which is fine: the new framework stage writes `site_articles` with the service-role key, which bypasses row level security.

## How stories reach the site

1. The framework stage (`../framework_stage/`, plan in [`../docs/superpowers/plans/2026-10-05-framework-stage.md`](../docs/superpowers/plans/2026-10-05-framework-stage.md), design in [`../docs/superpowers/specs/2026-10-05-genznews-framework-site-design.md`](../docs/superpowers/specs/2026-10-05-genznews-framework-site-design.md)) reads scraped articles, rewrites them, scores them, and stores each one as `REVIEW_REQUIRED` (or `APPROVED` if auto-publish is switched on; it never writes `PUBLISHED`); a person publishes them. It runs on a worker host with the service-role key (see "Running the framework stage").
2. The site shows only `PUBLISHED` rows, so nothing appears until someone publishes it.
3. Recommended: review and approve in the admin panel (see "Admin panel"). Fallback: publish in the Supabase SQL editor. Review first:

```sql
select slug, title, confidence, fact_risk, flags
from public.site_articles
where status in ('REVIEW_REQUIRED','APPROVED')
order by created_at desc;
```

Then publish one story:

```sql
update public.site_articles
set status = 'PUBLISHED', published_at = now(), reviewed_by = '<your email>', reviewed_at = now()
where slug = '<slug>' and status in ('REVIEW_REQUIRED','APPROVED');
```

Setting `published_at` here is optional once migration `0002` is applied: the trigger fills it in.

Rows whose `category` is not one of the five categories are skipped everywhere: lists, search, related stories, article pages (404) and the sitemap. Each skip is logged as a `skipped N of M rows` line with the reason. The match is exact: store the niche key exactly as one of `health_wellness`, `education_career`, `entertainment_pop_culture`, `biogas_clean_energy`, `digital_marketing_social_media` (lower case, underscores, no spaces). A near miss such as `Health-Wellness` is skipped too, and the log line names the key it should be: `unknown category 'Health-Wellness' (expected 'health_wellness')`.

4. Refresh the cache now, or wait up to 5 minutes:

```bash
curl -X POST http://localhost:3100/api/revalidate \
  -H 'x-revalidate-secret: <secret>' \
  -H 'content-type: application/json' \
  -d '{"slug":"<slug>"}'
```

`{"slug":"x"}` refreshes `/article/x`, `/` and `/latest`. You can instead send `{"paths":[...]}` (up to 20) using only these paths: `/`, `/latest`, `/about`, `/sitemap.xml`, `/category/<one of the five category slugs>`, `/article/<slug>`. Anything else returns 400; a missing or wrong secret returns 401; only POST is accepted.

## Admin panel

The admin panel at `/admin` lists stories waiting for review, shows each one with its scores and flags, and approves them. Approved stories show on the site within seconds.

Setup, once per project:

1. Create the Auth user first. In the Supabase Dashboard go to Authentication, Users, Add user. Use the email `ujjwal@nuformsocial.com`, choose a password yourself and tick Auto confirm user. Never put the password in the repo or in chat. Do this before step 2: access is granted by the email in the sign-in token, so if the allowlist row exists before the real Auth user does, someone else could sign up with that email first.
2. Then run `supabase/import/add-admin.sql` in the Supabase SQL editor. That folder is git-ignored, so the file exists only on the machine that generated it. The one statement it holds is:

```sql
insert into public.admin_emails (email) values ('ujjwal@nuformsocial.com') on conflict do nothing;
```

3. Open `/admin` (for example http://localhost:3100/admin), sign in, open a story, review it and approve it. Approved stories show on the site within seconds.
4. A deployed site needs only `SUPABASE_URL`, `SUPABASE_ANON_KEY` and `NEXT_PUBLIC_SITE_URL`. Never set the service-role key on the web app.
5. Harden sign-up: in the Dashboard go to Authentication, Sign In / Providers and turn OFF "Allow new users to sign up". Keep "Confirm email" and "Secure email change" ON.
6. To add another admin, repeat the same order: create the Auth user first (step 1), then insert the row into `public.admin_emails` (step 2) with the same email.

Known limits:

- The original source text is not shown, only a link to the source.
- Regeneration requests, unpublish and bulk approve are not built.

## Running the framework stage

The stage is Python and lives at the repository root of the `feat/framework-stage` branch (`run_framework_stage.py` and `framework_stage/`), not under `web/`. Run it from the repository root:

```bash
python run_framework_stage.py [--limit N] [--dry-run]
```

- It reads new rows from the pipeline's local SQLite database `articles.db` (path from `STAGE_DB_PATH`, default `articles.db` at the repository root) and writes the rewritten stories to Supabase (`site_articles`, `site_jobs`).
- Required environment: `GEMINI_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`. The last one is the service-role key: keep it on the worker host only, never in `web/`.
- Exit codes: `0` success, `2` a required variable is missing or the configuration is invalid, `3` another run holds the lock, `1` `articles.db` is missing.
- Use `--dry-run` first. It still calls Gemini (so it costs tokens), but skips every store write and prints how many writes it skipped.
- `--limit N` caps the new articles in this run.

## Demo seed script

```bash
SUPABASE_URL=https://<project-ref>.supabase.co SUPABASE_SERVICE_KEY=<service key> npm run seed:supabase -- --yes
```

This upserts the DEMO fixture articles into `site_articles` as `PUBLISHED`. Use it only on a throwaway development project. NEVER run it against a database whose content should be real: it publishes demo stories there. Because it upserts on `url_hash`, it can also overwrite the status and body of real rows that share a source URL with a demo article, including un-publishing or re-publishing a review decision. Pass the service key on the command line environment only, never in a file the site reads. Without `--yes` it refuses to run.

## Rendering and caching

| Route | Mode |
| --- | --- |
| `/`, `/about`, `/article/[slug]` | ISR, `revalidate = 300` (5 minutes). Articles published after a build render on first request and then join the cache |
| `/latest`, `/category/[slug]`, `/search` | Rendered per request (they read search params), every visit queries the database |
| `/sitemap.xml` | Cached, `revalidate = 3600` |

Consequences:

- The home page throws on a repository error instead of rendering an error state, so an outage is never cached as the home page. During a regeneration failure Next keeps serving the last good home page and retries on a later request. A home page that was never generated shows the app error page ("We couldn't load stories..." with a Try again button).
- `next build` prerenders `/`, so a build while the database is unreachable FAILS at `/`. That is intended: a failed build is better than deploying a cached error home page. See "Troubleshooting".
- When the database is down, `/latest`, category pages and search show the error state inline (HTTP 200) and the console explains why. An article page that was never generated returns Next's plain 500 (a caught error would otherwise be cached for 5 minutes). Already generated pages keep serving from cache, and a failed regeneration keeps the last good page.
- A transient error (HTTP 502, 503, 504 or 520, a timeout, a reset socket) gets one retry after 300 ms. DNS failures, refused connections, 4xx and database error codes are not retried. Every request has a 6 second timeout.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Development server (add `-- -p 3100`) |
| `npm run build` | Production build |
| `npm run start` | Serve the production build (add `-- -p 3100`) |
| `npm run lint` | ESLint |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Unit and component tests (Vitest) |
| `npm run test:e2e` | End-to-end tests (Playwright) |
| `npm run fixtures` | Rebuild `src/lib/fixtures/articles.json` from `../output/*.md` |
| `npm run seed:supabase -- --yes` | Seed DEMO rows (see above) |
| `npm run export:legacy-sql` | Write SQL that imports the legacy `public.articles` rows (see "Importing the legacy articles") |

### Testing

`npm test` runs the unit tests. `npm run test:e2e` starts two servers, each with its own build folder so your `.next` and dev server are never touched, and neither reuses an existing server. If Playwright's browser is missing, run `npx playwright install chromium` first.

- Port 3110: `DATA_SOURCE=fixtures`. DEMO data, used only so the UI is tested against stable content. It covers pages, SEO and API checks, accessibility checks with axe, and responsive checks.
- Port 3111: `DATA_SOURCE=supabase` pointed at a closed local port, run with `next dev` (folder `.next-e2e-real`), because a production build would fail at `/` by design. A guard spec proves every route shows the error state, never a demo article (checked in the HTML, the RSC payload of `/` and the rendered page), and that the server log names the cause and hides the key. Dev compiles each route on first request, so the spec warms its routes first.

## Security notes

- Headers on every route: `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options: DENY`, `Permissions-Policy` denying camera, microphone and geolocation. `X-Powered-By` is off.
- `Content-Security-Policy-Report-Only` on every route (`default-src 'self'`, scripts and styles from self plus inline, images from self, any https host and data URLs, `object-src 'none'`, `frame-ancestors 'none'` and more; see `next.config.ts`). It is report-only: the browser logs violations and blocks nothing, so it cannot break the site. Next's own inline bootstrap scripts and the inline theme script need `'unsafe-inline'`; an enforced policy with per-request nonces is deferred. `upgrade-insecure-requests` is left out for now (browsers ignore it in a report-only policy and log an error on every page); add it back when the policy is enforced.
- `src/lib/env.ts` and `src/lib/repositories/index.ts` import `server-only`, so importing them from a client component fails the build.
- Article Markdown is rendered through `rehype-sanitize`.
- Images are hotlinked from the source with `referrerPolicy="no-referrer"` and a placeholder if one fails. Only absolute `http(s)` image URLs are ever rendered (`src/lib/url.ts`); anything else (`data:`, `javascript:`, relative or `//host` values) shows the placeholder.
- `/api/revalidate` compares the secret in constant time, answers 401 when the secret is unset or wrong, and only revalidates the allowed paths.
- The console never prints keys. Values are redacted and URLs shortened to a host name.
- The legacy table `public.articles` has row level security off, so the publishable key can read (and likely write) it. See "Security: lock the legacy table after importing".

## Deploy notes

- Vercel or any Node 20+ host: run `npm ci`, `npm run build`, `npm run start`.
- Set `DATA_SOURCE=supabase`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `REVALIDATE_SECRET` and `NEXT_PUBLIC_SITE_URL` before the build. Production requires `DATA_SOURCE` explicitly.
- Build against the real database (see "Rendering and caching").
- The worker host that runs the framework stage holds the service-role key. The site never does.
- The sitemap lists at most the API max rows (1000 by default) until the slug query is paginated.

## Known limits and next steps

- The admin review UI (queue, approve, reject, sign-in with Supabase Auth) is a separate plan. Publishing is manual SQL for now.
- `/trending` is deferred (no analytics source).
- CSP enforcement (nonces) is deferred; the policy is report-only for now.
- Anon column grants are not restricted yet (see "Hardening suggestion").
- Sitemap pagination.
- Image rights: hotlinking source images is an owner decision and carries risk.
- Articles carry no AI-disclosure note. That is an owner decision; the `ai_disclosure` column exists.

## Troubleshooting

- **`npm run build` fails while prerendering `/`.** The database was unreachable during the build. The home page throws on a data error on purpose, so a build never bakes an error page into `/`. The build log shows `Error occurred prerendering page "/"`; with `DATA_LOG=1` a `[genznews] home  render failed` line gives the reason. Check `SUPABASE_URL`, the key and your network, then build again. For a local demo build only, use `DATA_SOURCE=fixtures`.
- **A published story sorts as the oldest one.** Its `published_at` is empty. Apply migration `0002` (it backfills and fills new ones).
- **A published story is missing everywhere and gives 404.** Its `category` is not exactly one of the five niche keys (case, spaces and hyphens count). The console shows `skipped N of M rows` with `unknown category '<value>'`.
