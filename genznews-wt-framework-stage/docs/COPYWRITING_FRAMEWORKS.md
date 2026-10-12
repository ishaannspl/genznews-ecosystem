# Copywriting Frameworks: Source of Truth

Which framework AajKiJanta uses for which kind of article, and why.
Frameworks come from the PDF "10 Legendary Copywriting Frameworks" (Moritz Kaiser).

**Machine-readable twin:** `framework_stage/config/frameworks.json`. If this doc and the JSON ever disagree, fix the JSON to match this doc. A test (`tests/framework_stage/test_framework_truth.py`) keeps the JSON, the prompt files and the Supabase `copywriting_frameworks` table keys in sync.

## 1. Non-negotiable rule for a news site

A framework shapes the **structure** of the body. It never adds facts. Grounding rules, banned phrases, no em-dashes and the TL;DR/attribution blocks stay exactly as in `prompts/_header.md`. The "sell" frameworks (PAS, PPPP, AIDA) must be applied as a reporting structure, never as sales copy: no fake urgency, no invented stakes, no promises the source does not make.

## 2. The 10 frameworks (key, steps, what it is good at)

| # | Key | Name | Steps | Best at |
|---|-----|------|-------|---------|
| 1 | `AIDA` | Attention, Interest, Desire, Action | hook, why it matters, what is at stake or on offer, what to do or watch | Default for ordinary news. "Old but gold, never fails." |
| 2 | `PAS` | Problem, Agitate, Solution | the problem, its consequences, the fix or response | Stories about a risk, failure, scam, shortage or crisis |
| 3 | `BAB` | Before, After, Bridge | situation before, situation after, how it got there | Change stories: reforms, comebacks, success journeys |
| 4 | `FAB` | Features, Advantages, Benefits | what it is, how it beats the old way, who gains | Launches, new schemes, new products, new rules |
| 5 | `PPPP` | Picture, Promise, Prove, Push | vivid scene, the outcome promised, evidence, next step | Campaigns, drives, schemes and trends with a clear action for the reader |
| 6 | `SSS` | Star, Story, Solution | the person or brand, what happened to them, how it resolved | Profiles, founder stories, human-interest pieces |
| 7 | `OPEN_LOOPS` | Open Loops | open a question, deliver in sections, close each loop | Long reads where we must keep people reading |
| 8 | `4US` | Useful, Urgent, Unique, Ultra-specific | lead with the single most useful specific; use as many U's as are true | Lists, tips, roundups, "top N" pieces; also the headline check for every article |
| 9 | `4WS` | What, What it does, Who, What next | what it is, what it does for you, who is behind it, what to do next | Explainers, how-tos, eligibility and scheme guides |
| 10 | `4CS` | Clear, Concise, Compelling, Credible | plain lead, tight facts, one strong angle, attribution on every claim | Short factual items: announcements, results, data points, briefs |

Not used from the previous setup: `4PS` (renamed to `PPPP`, the PDF's version), `STORYBRAND` (replaced by `SSS`), `QUEST` (replaced by `OPEN_LOOPS` for long reads). The PDF does not cover StoryBrand or QUEST.

## 3. Decision table: article type to framework

The classifier assigns exactly one `content_type`. The strategy maps it to one framework. Order of precedence when picking:

1. Admin `regen_framework` on the article
2. `niche_overrides` (empty by default)
3. `content_type` mapping below
4. Default (`AIDA`)

| content_type | Use it when the story is... | Framework |
|---|---|---|
| `GENERAL_NEWS` | a standard report with no stronger signal | `AIDA` |
| `PROBLEM_FOCUSED` | about a problem, risk, failure, scam, shortage, backlash | `PAS` |
| `TRANSFORMATION` | about a change over time, a turnaround, before vs after | `BAB` |
| `PRODUCT_LAUNCH` | a launch, release, new feature, new scheme or policy | `FAB` |
| `PERSUASIVE` | a campaign, drive, sign-up or trend with evidence and a call to act | `PPPP` |
| `BRAND_STORY` | a profile of a person, founder, creator or brand | `SSS` |
| `LONG_FORM` | source text of 6000+ characters (decided by length, before any keyword) | `OPEN_LOOPS` |
| `LISTICLE` | a list, tips, ranking or roundup | `4US` |
| `EXPLAINER` | a how-to, "what you need to know", eligibility or scheme guide | `4WS` |
| `FACT_BRIEF` | a short factual item: announcement, result, single data point | `4CS` |

### Classifier order
1. Source length >= `long_form_min_chars` (6000): `LONG_FORM`.
2. First matching rule in `keyword_rules` (title plus first 300 chars).
3. Otherwise the LLM picks one `content_type` using the "when" guide in `content_type_guide`.

## 4. Typical fit by niche (guidance, not enforced)

Niches are in `sources.json`. These are the types we expect most; the classifier still decides per article. Add a `niche_overrides` entry only if a niche should always use one framework.

| Niche | Usually | Often |
|---|---|---|
| `health_wellness` | `PROBLEM_FOCUSED` (PAS), `EXPLAINER` (4WS) | `LISTICLE` (4US), `TRANSFORMATION` (BAB) |
| `education_career` | `EXPLAINER` (4WS), `GENERAL_NEWS` (AIDA) | `FACT_BRIEF` (4CS) for results and notices, `PERSUASIVE` (PPPP) for drives |
| `entertainment_pop_culture` | `GENERAL_NEWS` (AIDA), `BRAND_STORY` (SSS) | `PRODUCT_LAUNCH` (FAB) for releases, `LISTICLE` (4US) |
| `biogas_clean_energy` | `PRODUCT_LAUNCH` (FAB), `TRANSFORMATION` (BAB) | `PERSUASIVE` (PPPP), `FACT_BRIEF` (4CS) |
| `digital_marketing_social_media` | `LISTICLE` (4US), `PRODUCT_LAUNCH` (FAB) | `EXPLAINER` (4WS), `BRAND_STORY` (SSS) |

## 5. Headline rule (applies to every article)

Whatever the body framework, the title and `seo_title` should pass the 4 U's check: at least two of Useful, Urgent, Unique, Ultra-specific, and only if true to the source. Do not force all four.

## 6. How to change this

1. Edit the table in section 3 and the JSON together.
2. Adding a framework: add the key to `FRAMEWORKS` in `strategy.py`, a prompt file `prompts/<key lowercase>.md`, a row in `copywriting_frameworks` (new Supabase migration), and a row in section 2.
3. Run `pytest tests/framework_stage`.
