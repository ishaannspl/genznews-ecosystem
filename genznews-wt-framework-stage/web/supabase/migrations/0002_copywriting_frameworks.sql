-- Copywriting frameworks as a reference table, plus constraints on the article columns.
-- Source of truth for the mapping is docs/COPYWRITING_FRAMEWORKS.md and
-- framework_stage/config/frameworks.json. Keys here must match FRAMEWORKS in strategy.py.

create table if not exists public.copywriting_frameworks (
  key text primary key,
  name text not null,
  steps text[] not null,
  best_for text not null,
  sort_order int not null default 0
);

insert into public.copywriting_frameworks (key, name, steps, best_for, sort_order) values
  ('AIDA',       'Attention, Interest, Desire, Action',        array['Attention','Interest','Desire','Action'],                     'Default for ordinary news', 1),
  ('PAS',        'Problem, Agitate, Solution',                 array['Problem','Agitate','Solution'],                               'Risks, failures, scams, crises', 2),
  ('BAB',        'Before, After, Bridge',                      array['Before','After','Bridge'],                                    'Change and turnaround stories', 3),
  ('FAB',        'Features, Advantages, Benefits',             array['Features','Advantages','Benefits'],                           'Launches, new schemes, new rules', 4),
  ('PPPP',       'Picture, Promise, Prove, Push',              array['Picture','Promise','Prove','Push'],                           'Campaigns and drives with a call to act', 5),
  ('SSS',        'Star, Story, Solution',                      array['Star','Story','Solution'],                                    'Profiles and human-interest pieces', 6),
  ('OPEN_LOOPS', 'Open Loops',                                 array['Open','Deliver','Close'],                                     'Long reads', 7),
  ('4US',        'Useful, Urgent, Unique, Ultra-specific',     array['Useful','Urgent','Unique','Ultra-specific'],                  'Lists, tips, roundups', 8),
  ('4WS',        'What, What it does, Who, What next',         array['What','What it does for you','Who','What you need to do next'], 'Explainers and guides', 9),
  ('4CS',        'Clear, Concise, Compelling, Credible',       array['Clear','Concise','Compelling','Credible'],                    'Short factual items', 10)
on conflict (key) do update
  set name = excluded.name, steps = excluded.steps,
      best_for = excluded.best_for, sort_order = excluded.sort_order;

alter table public.copywriting_frameworks enable row level security;
create policy "frameworks readable" on public.copywriting_frameworks
  for select to anon, authenticated using (true);
-- Writes: service role only (bypasses RLS).

-- Remap rows written with the retired keys before adding the foreign keys.
update public.site_articles set framework = 'PPPP'       where framework = '4PS';
update public.site_articles set framework = 'SSS'        where framework = 'STORYBRAND';
update public.site_articles set framework = 'OPEN_LOOPS' where framework = 'QUEST';
update public.site_articles set regen_framework = 'PPPP'       where regen_framework = '4PS';
update public.site_articles set regen_framework = 'SSS'        where regen_framework = 'STORYBRAND';
update public.site_articles set regen_framework = 'OPEN_LOOPS' where regen_framework = 'QUEST';

alter table public.site_articles
  add constraint site_articles_framework_fk
    foreign key (framework) references public.copywriting_frameworks (key),
  add constraint site_articles_regen_framework_fk
    foreign key (regen_framework) references public.copywriting_frameworks (key),
  add constraint site_articles_content_type_check
    check (content_type is null or content_type in (
      'GENERAL_NEWS','PROBLEM_FOCUSED','TRANSFORMATION','PRODUCT_LAUNCH','PERSUASIVE',
      'BRAND_STORY','LONG_FORM','LISTICLE','EXPLAINER','FACT_BRIEF'));

create index if not exists site_articles_framework_idx on public.site_articles (framework);
