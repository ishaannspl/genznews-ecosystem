# Admin Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An email-and-password `/admin` area where an allowlisted admin reviews stories held in `REVIEW_REQUIRED`, approves or rejects them, edits the body, and approved stories appear on the public site immediately.

**Architecture:** Supabase Auth (email + password) with session cookies via `@supabase/ssr`. All authorization stays in Postgres: the existing RLS policies only let a user whose JWT email is in `admin_emails` read non-published rows or update them, so the admin pages use the **anon key plus the user's session**, never the service key. Pages and server actions re-check the session on every request (`requireAdmin`); `proxy.ts` only refreshes cookies and redirects unauthenticated visitors early. Mutations are server actions (Next's built-in Origin check covers CSRF) that call `revalidatePath` after a publish.

**Tech Stack:** Next.js 16.3.8 (App Router, `proxy.ts`, server actions), React 19, `@supabase/supabase-js` ^2.117 plus new `@supabase/ssr`, vitest + Testing Library, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-05-genznews-framework-site-design.md` sections 5 (access control), 7 (review queue) and 9 (security). Deviation: the spec shows source text beside the generated text, but source text lives only in the pipeline's SQLite, not in `site_articles`. The detail view therefore shows the generated body, the flags, and a link to `source_url`.

## Global Constraints

- Next.js 16 differs from older versions: read the matching guide in `web/node_modules/next/dist/docs/` before using `proxy.ts`, `cookies()`, server actions or `revalidatePath` (`web/AGENTS.md`).
- The Supabase **service key never enters `web/`**; admin code uses `SUPABASE_URL` and `SUPABASE_ANON_KEY` only (`readEnv` in `src/lib/env.ts`).
- Passwords are never stored, logged or echoed by this app. The admin user is created in the Supabase dashboard; the allowlist row is inserted by SQL.
- Editorial rule: no em-dashes or en-dashes in saved content. Edited bodies go through `removeEmDashes` (`src/lib/removeEmDashes.ts`).
- Status values come from the DB check constraint: `PROCESSING, REVIEW_REQUIRED, APPROVED, PUBLISHED, REJECTED, FAILED, ARCHIVED`.
- `/admin/` is already disallowed in `src/app/robots.ts`; admin pages also set `robots: noindex`.
- Tests never hit the network or a real Supabase project. Match existing test style (`vitest`, `*.test.ts(x)` beside the source).
- Keep `npm run typecheck`, `npx eslint src`, and `npx vitest run` green. `exportLegacy.test.ts` counts files under `../output` and is unrelated to this work.

## Review Focus

- Signed-in user whose email is **not** in `admin_emails`: must be treated as logged out, never shown the queue (test in Task 2).
- Tampered or expired session cookie: `getUser()` fails, redirect to login (Task 2).
- Wrong password: generic "Email or password is incorrect" message, same text for unknown email, no hint which was wrong (Task 3).
- Approving a row that is already `PUBLISHED`, `REJECTED` or missing: no change, clear message, no crash (Task 4).
- An edited body containing an em-dash or an empty body: dash is replaced, empty is refused (Task 4).
- Unsafe `next` redirect after login (`//evil.com`, `https://...`): must fall back to `/admin` (Task 3).

---

### Task 1: Dependency, Supabase server client, and setup SQL

**Files:**
- Modify: `web/package.json` (add `@supabase/ssr`)
- Create: `web/src/lib/admin/supabaseServer.ts`
- Create: `web/supabase/import/add-admin.sql`
- Test: `web/src/lib/admin/supabaseServer.test.ts`

**Interfaces:**
- Produces: `createAdminClient(): Promise<SupabaseClient>`, a server-only client built from `readEnv()` (throws if `dataSource !== "supabase"`), using `createServerClient` with the `cookies()` store (`getAll`/`setAll`). `setAll` must swallow the error Next throws when called from a Server Component.

- [ ] **Step 1: Install** `cd web && npm install @supabase/ssr`. Expected: added to `dependencies`, lockfile updated.
- [ ] **Step 2: Write failing test** `supabaseServer.test.ts`: mock `next/headers` (`cookies` resolving to a fake store) and `@supabase/ssr`; assert `createAdminClient()` calls `createServerClient(url, anonKey, {cookies})` with the env values, and throws a message naming `DATA_SOURCE` when it is `fixtures`. Run `npx vitest run src/lib/admin/supabaseServer.test.ts`, expect FAIL (module missing).
- [ ] **Step 3: Implement** `createAdminClient` as specified above in `supabaseServer.ts` (`import "server-only"`).
- [ ] **Step 4: Write `add-admin.sql`**: `insert into public.admin_emails (email) values ('ujjwal@nuformsocial.com') on conflict do nothing;` with a comment explaining the user itself is created in Supabase Dashboard → Authentication → Users → Add user (tick "Auto confirm user"), where the admin chooses the password.
- [ ] **Step 5: Verify** the test passes, then `npm run typecheck`. Commit: `feat(web): supabase server client for the admin area`.

### Task 2: Session guard (`requireAdmin`) and `proxy.ts`

**Files:**
- Create: `web/src/lib/admin/session.ts`
- Create: `web/src/proxy.ts`
- Test: `web/src/lib/admin/session.test.ts`, `web/src/proxy.test.ts`

**Interfaces:**
- Consumes: `createAdminClient` (Task 1).
- Produces: `getAdmin(client): Promise<{ email: string } | null>` (pure, takes a client so it is testable) and `requireAdmin(): Promise<{ client: SupabaseClient; email: string }>` which redirects to `/admin/login` via `redirect()` when `getAdmin` returns null.
- `getAdmin` rules: `client.auth.getUser()` must return a user with an email (this validates the token with the auth server; never trust `getSession()`), then `client.from("admin_emails").select("email").eq("email", user.email).maybeSingle()` must return a row.
- `proxy.ts` exports `proxy(request)` and `config.matcher = ["/admin/:path*"]`: refresh the Supabase session cookies (the standard `@supabase/ssr` proxy pattern from its docs), and redirect to `/admin/login` when there is no user and the path is not `/admin/login`.

- [ ] **Step 1: Failing tests** in `session.test.ts` with a fake client: (a) no user → `null`; (b) user whose email is absent from `admin_emails` → `null` (Review Focus: not allowlisted); (c) `getUser` returning an error (expired or tampered token) → `null`; (d) allowlisted → `{ email }`. In `proxy.test.ts`: unauthenticated `/admin` redirects to `/admin/login`; `/admin/login` passes through.
- [ ] **Step 2: Run** both files, expect FAIL.
- [ ] **Step 3: Implement** `getAdmin`, `requireAdmin` and `proxy` as specified.
- [ ] **Step 4: Run** tests, expect PASS; run typecheck and eslint. Commit: `feat(web): admin session guard and proxy`.

### Task 3: Login and logout

**Files:**
- Create: `web/src/app/admin/login/page.tsx`, `web/src/app/admin/login/LoginForm.tsx` (client, `useActionState`)
- Create: `web/src/app/admin/actions/auth.ts` (`"use server"`)
- Create: `web/src/app/admin/layout.tsx` (admin shell: title, "Sign out" form, `robots: { index: false, follow: false }`)
- Create: `web/src/lib/admin/safeNext.ts`
- Test: `web/src/lib/admin/safeNext.test.ts`, `web/src/app/admin/actions/auth.test.ts`, `web/src/app/admin/login/LoginForm.test.tsx`

**Interfaces:**
- Produces: `safeNext(value: unknown): string` returns `value` only when it starts with `/admin` and not `//` or a scheme, else `"/admin"`.
- Produces: `login(prev: LoginState, formData: FormData): Promise<LoginState>` where `LoginState = { error?: string }`. Calls `signInWithPassword({ email, password })`; on any auth error returns `{ error: "Email or password is incorrect." }` (same text for every failure); on success verifies `getAdmin`, signs out and returns the same generic error if the user is not allowlisted, otherwise `redirect(safeNext(next))`.
- Produces: `logout(): Promise<void>` calls `auth.signOut()` then `redirect("/admin/login")`.

- [ ] **Step 1: Failing tests:** `safeNext("//evil.com")`, `("https://evil.com")`, `("/other")`, `(undefined)` all give `/admin`; `("/admin/abc")` is kept. `login` with a rejecting `signInWithPassword` returns the generic error and never includes the password or the Supabase message; `login` with a valid but non-allowlisted user calls `signOut` and returns the generic error. `LoginForm` renders email and password fields with labels and shows the error in an `alert` region.
- [ ] **Step 2: Run,** expect FAIL.
- [ ] **Step 3: Implement** the pieces above. The form uses `type="password"`, `autoComplete="current-password"`, a visible label per field, and the existing site styles (`section-label`, `text-link`) so it matches the public site.
- [ ] **Step 4: Run** tests, typecheck, eslint, expect PASS. Commit: `feat(web): admin login and logout`.

### Task 4: Review data layer and actions

**Files:**
- Create: `web/src/lib/admin/queue.ts`
- Create: `web/src/app/admin/actions/review.ts` (`"use server"`)
- Test: `web/src/lib/admin/queue.test.ts`, `web/src/app/admin/actions/review.test.ts`

**Interfaces:**
- Produces in `queue.ts`:
  - `type QueueStatus = "REVIEW_REQUIRED" | "APPROVED" | "PUBLISHED" | "REJECTED" | "FAILED"`; `parseQueueStatus(value: unknown): QueueStatus` (default `REVIEW_REQUIRED`).
  - `type QueueRow = { id: string; slug: string | null; title: string | null; category: string | null; status: string; confidence: number | null; factRisk: string | null; flags: string[]; imageUrl: string | null; publishedAt: string | null; createdAt: string }`.
  - `listQueue(client, status: QueueStatus, page: number, pageSize = 20): Promise<{ rows: QueueRow[]; total: number }>` ordered `published_at desc nulls last, created_at desc`, with an exact count.
  - `type ReviewArticle = QueueRow & { summary: string | null; bodyMd: string | null; sourceUrl: string | null; sourceName: string | null }`; `getForReview(client, id: string): Promise<ReviewArticle | null>`.
  - `statusCounts(client): Promise<Record<QueueStatus, number>>`.
- Produces in `review.ts` (each calls `requireAdmin()` first, then updates with `.eq("id", id).in("status", allowedFrom)` and checks that exactly one row changed):
  - `approveArticle(id: string): Promise<ActionResult>`: from `REVIEW_REQUIRED|APPROVED` to `PUBLISHED`, sets `reviewed_by = email`, `reviewed_at = now`, keeps existing `published_at` (DB trigger fills it when null). Then `revalidatePath` for `/`, `/latest`, `/article/<slug>`, `/category/<category>`, `/sitemap.xml`.
  - `rejectArticle(id: string): Promise<ActionResult>`: from `REVIEW_REQUIRED|APPROVED` to `REJECTED` with reviewer fields.
  - `saveBody(id: string, formData: FormData): Promise<ActionResult>`: trims `body_md`, refuses empty (`error: "Body cannot be empty."`), runs `removeEmDashes`, updates any row whose status is not `FAILED` (an admin may also correct a published story); revalidates the article path when the row is `PUBLISHED`.
  - `type ActionResult = { ok: true } | { ok: false; error: string }`. A row not in an allowed status returns `{ ok: false, error: "This story is no longer waiting for review." }`.

- [ ] **Step 1: Failing tests** with a recording fake client: `parseQueueStatus("nope")` is `REVIEW_REQUIRED`; `listQueue` applies the status filter and ordering and maps snake_case to the `QueueRow` shape; `approveArticle` on a changed row sets `status`, `reviewed_by` and revalidates the five paths (mock `next/cache`); on zero changed rows (already published, rejected or missing) returns the not-waiting error and does not revalidate; `rejectArticle` mirrors it; `saveBody` replaces an em-dash and refuses an empty body; every action returns without touching the client when `requireAdmin` redirects (mock it to throw).
- [ ] **Step 2: Run,** expect FAIL.
- [ ] **Step 3: Implement** the interfaces above. Use `.update(...).select("id, slug, category")` to learn how many rows changed.
- [ ] **Step 4: Run** tests, typecheck, eslint, expect PASS. Commit: `feat(web): admin review queries and actions`.

### Task 5: Queue and detail pages

**Files:**
- Create: `web/src/app/admin/page.tsx` (queue)
- Create: `web/src/app/admin/[id]/page.tsx` (detail)
- Create: `web/src/components/admin/QueueTable.tsx`, `ReviewActions.tsx`, `FlagList.tsx`
- Test: `web/src/components/admin/QueueTable.test.tsx`, `ReviewActions.test.tsx`, `FlagList.test.tsx`

**Interfaces:**
- Consumes: `requireAdmin`, `listQueue`, `statusCounts`, `getForReview`, `parseQueueStatus`, `approveArticle`, `rejectArticle`, `saveBody`.
- Produces: `/admin?status=&page=` shows status tabs with counts, then rows with title (link to `/admin/<id>`), category, confidence, fact risk, flag count, relative date and a one-click **Approve** button (form posting `approveArticle`). `/admin/[id]` shows title, summary, cover, the generated body in a `<textarea name="body_md">` with **Save edits**, the flags grouped by prefix (`UNGROUNDED_ENTITY`, `CLAIM_QUOTE_MISSING`, `UNGROUNDED_NUMBER`) in `FlagList`, a link to `source_url`, and **Approve and publish** / **Reject** buttons. Both pages call `requireAdmin()` at the top and are `export const dynamic = "force-dynamic"`. Use `notFound()` for an unknown id.
- `FlagList` props: `flags: string[]`; renders nothing for an empty list.

- [ ] **Step 1: Failing tests:** `QueueTable` renders one row per story with an Approve button only for `REVIEW_REQUIRED` and `APPROVED`, and an empty state message otherwise; `FlagList` groups `UNGROUNDED_ENTITY:Keep` and `UNGROUNDED_ENTITY:Plus` under one heading and shows a count; `ReviewActions` renders the three controls with accessible names and shows an action error in an `alert` region.
- [ ] **Step 2: Run,** expect FAIL.
- [ ] **Step 3: Implement** the components and pages. Reuse `StoryCover`, `formatRelative`, and the site's `divide-rule` list styling. Keep touch targets at least 44px (`min-h-11`, as `StoryRow` does).
- [ ] **Step 4: Run** tests, typecheck, eslint, expect PASS. Commit: `feat(web): admin queue and review pages`.

### Task 6: End-to-end check, docs, and rollout

**Files:**
- Create: `web/e2e/admin.spec.ts`
- Modify: `web/README.md` (add an "Admin panel" section replacing the "publish in the SQL editor" step 3 as the recommended path)

**Interfaces:**
- Consumes: everything above. The e2e run uses `DATA_SOURCE=fixtures`-style isolation, so it only covers what needs no database: unauthenticated `/admin` and `/admin/<id>` redirect to `/admin/login`; the login form shows a generic error for bad credentials (use a closed local Supabase URL as the existing real-data-failure project does); `/admin/*` responses carry `noindex`; `robots.txt` disallows `/admin/`.

- [ ] **Step 1: Write the Playwright spec** for the four checks above, following `e2e/real-data-failure.spec.ts` for server setup. Run `npm run test:e2e -- admin.spec.ts`, expect PASS.
- [ ] **Step 2: README:** document (1) run `supabase/import/add-admin.sql`; (2) in Supabase → Authentication → Users → Add user with `ujjwal@nuformsocial.com`, choose a password, tick Auto confirm; (3) open `/admin`, sign in, approve; (4) deployed sites need `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `NEXT_PUBLIC_SITE_URL` only (no service key). Mention adding another admin means another Auth user plus another `admin_emails` row.
- [ ] **Step 3: Full check:** `npm run typecheck && npx eslint src && npx vitest run`, expect green apart from the unrelated `exportLegacy` file count.
- [ ] **Step 4: Manual check with the real project** (the admin does this): run `add-admin.sql`, create the user, sign in at http://localhost:3100/admin, approve one story, confirm it appears on `/` and `/latest` within seconds, then sign out and confirm `/admin` redirects.
- [ ] **Step 5: Commit:** `docs(web): admin panel setup and e2e`.

---

## Out of scope (YAGNI)

Regeneration requests, unpublish/archive, bulk approve, multiple roles, password reset UI (use Supabase's reset email), and showing the original source text. Each is a small follow-up on top of this plan.
