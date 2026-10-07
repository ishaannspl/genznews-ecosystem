-- GenZNews framework site tables. Idempotency key: url_hash.
-- Safe to run more than once: tables and indexes use if not exists, and each policy is dropped
-- and recreated.

create table if not exists public.site_articles (
  id uuid primary key default gen_random_uuid(),
  url_hash text not null unique,
  content_hash text,
  norm_title text,
  simhash text,
  slug text unique,
  title text,
  summary text,
  body_md text,
  generated_body_md text,
  framework text,
  content_type text,
  category text,
  tags text[] not null default '{}',
  seo_title text,
  seo_description text,
  keywords text[] not null default '{}',
  source_url text,
  source_domain text,
  source_name text,
  also_reported_by jsonb not null default '[]'::jsonb,
  image_url text,
  image_source text,
  cluster_id text,
  confidence real,
  fact_risk text,
  flags text[] not null default '{}',
  status text not null default 'PROCESSING'
    check (status in ('PROCESSING','REVIEW_REQUIRED','APPROVED','PUBLISHED','REJECTED','FAILED','ARCHIVED')),
  regen_framework text,
  byline text not null default 'GenZNews Desk',
  ai_disclosure boolean not null default false,
  reviewed_by text,
  reviewed_at timestamptz,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  job_id uuid,
  search_tsv tsvector generated always as (
    to_tsvector('english', coalesce(title, '') || ' ' || coalesce(summary, '') || ' ' || coalesce(body_md, ''))
  ) stored
);

create index if not exists site_articles_status_published_idx
  on public.site_articles (status, published_at desc);
create index if not exists site_articles_category_idx on public.site_articles (category);
create index if not exists site_articles_cluster_idx on public.site_articles (cluster_id);
create index if not exists site_articles_search_idx on public.site_articles using gin (search_tsv);

create table if not exists public.site_jobs (
  job_id uuid primary key,
  url_hash text,
  started_at timestamptz,
  finished_at timestamptz,
  duration_ms int,
  stages jsonb,
  error text,
  model text,
  tokens_in int,
  tokens_out int,
  est_cost_usd numeric
);

create table if not exists public.admin_emails (
  email text primary key
);

alter table public.site_articles enable row level security;
alter table public.site_jobs enable row level security;
alter table public.admin_emails enable row level security;

-- Public readers see published articles only.
drop policy if exists "public read published" on public.site_articles;
create policy "public read published" on public.site_articles
  for select to anon, authenticated
  using (status = 'PUBLISHED');

-- Admins (JWT email in admin_emails) can read and update everything.
drop policy if exists "admin read all articles" on public.site_articles;
create policy "admin read all articles" on public.site_articles
  for select to authenticated
  using (exists (select 1 from public.admin_emails a where a.email = (auth.jwt() ->> 'email')));

drop policy if exists "admin update articles" on public.site_articles;
create policy "admin update articles" on public.site_articles
  for update to authenticated
  using (exists (select 1 from public.admin_emails a where a.email = (auth.jwt() ->> 'email')))
  with check (exists (select 1 from public.admin_emails a where a.email = (auth.jwt() ->> 'email')));

drop policy if exists "admin read jobs" on public.site_jobs;
create policy "admin read jobs" on public.site_jobs
  for select to authenticated
  using (exists (select 1 from public.admin_emails a where a.email = (auth.jwt() ->> 'email')));

-- admin_emails: RLS on with no anon policy. Authenticated users may only see their own row,
-- which the other policies' subqueries need.
drop policy if exists "admin sees own email" on public.admin_emails;
create policy "admin sees own email" on public.admin_emails
  for select to authenticated
  using (email = (auth.jwt() ->> 'email'));

-- Writes come from the pipeline using the service role, which bypasses RLS.

-- Ask the API (PostgREST) to refresh its table cache so the new tables are visible at once.
notify pgrst, 'reload schema';
