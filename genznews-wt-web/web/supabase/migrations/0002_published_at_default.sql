-- GenZNews: give every PUBLISHED row a publish time. Apply after 0001_site_tables.sql.
--
-- The framework stage never writes PUBLISHED, so a person publishes a row by flipping its
-- status (for example in the Supabase table editor) and published_at stays NULL. The site
-- orders stories by published_at, so such a row would sort as the oldest story. This
-- trigger stamps the publish time when a row becomes PUBLISHED without one.
--
-- Safe to run more than once: the function is replaced, the trigger is dropped and
-- recreated, and the backfill only touches rows that still have no publish time.

create or replace function public.site_articles_set_published_at() returns trigger
language plpgsql
as $$
begin
  if new.status = 'PUBLISHED' and new.published_at is null then
    new.published_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists site_articles_set_published_at on public.site_articles;
create trigger site_articles_set_published_at
  before insert or update on public.site_articles
  for each row execute function public.site_articles_set_published_at();

-- One-off backfill for rows published before this migration: their creation time is the
-- best publish time we have.
update public.site_articles set published_at = created_at where status = 'PUBLISHED' and published_at is null;

-- Ask the API (PostgREST) to refresh its table cache.
notify pgrst, 'reload schema';
