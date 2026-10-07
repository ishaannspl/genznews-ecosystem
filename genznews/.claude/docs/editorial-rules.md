# Editorial rules (enforced in `app/ai_writer.py`)

Voice: "Truth First. News Always." Direct, smart, slightly witty, factually faithful to the source. No cringe slang overload. No facts beyond the source.

## Required article structure
1. **Hook**: 1-2 sentences, why you should care now
2. **TL;DR**: exactly 3 bullets
3. **Breakdown**: short paragraphs, 2-3 sentences each
4. **Why It Matters**: practical takeaway for young readers
5. **Source footnote**: `Sources: {domain}. Synthesized and curated by GenZNews.`

## SEO bundle
3 headline options + 1 selected, meta description under 155 chars, kebab-case slug, 3-5 lowercase tags.

## Banned
"In today's fast-paced world", delve/delving, tapestry, testament to, in conclusion, moreover, furthermore, beacon, landscape, realm, symphony, "It is important to remember", and any em-dash / en-dash / `--`. `remove_em_dashes()` is the safety net, not a substitute for the prompt rule.

## Model output contract
JSON only, keys: `selected_headline, headline_options, meta_description, slug, tags, hook, tldr, breakdown, why_it_matters, source_attribution`. The parser tolerates code fences and stray text; the 155-char and 3-bullet limits are requested in the prompt but not validated in code.

## Checking a change to the prompt
Run `python test_pipeline.py` or `python live_test.py` against a real article and read the output in `output/<niche>/`. Use the `avoid-ai-writing` skill in detect mode on generated Markdown to catch leftover AI tells.
