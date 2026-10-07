# GenZNews Web: Design Direction

Date: 2026-10-05
Status: DRAFT, awaiting user review
Extends: `2026-10-05-genznews-framework-site-design.md` section 6 (Website). That section stays authoritative for routes, SEO and data access; this document adds the visual design.

## Subject, audience, job

- **Subject:** GenZNews, "Truth First. News Always." Short, source-grounded explainers on five niches: health and wellness, education and career, entertainment and pop culture, biogas and clean energy, digital marketing and social media.
- **Audience:** readers aged 18 to 28 in India, on phones first, reading between other things.
- **Job of the page:** let someone get the point of a story in ten seconds, trust where it came from, and go deeper only if they want to.

The pipeline already gives every story a fixed three-line TL;DR. That is this product's most characteristic object, so the design is built around it.

## Design tokens

### Color

| Token | Light | Dark | Role |
|---|---|---|---|
| paper | `#F3F5FB` | `#0E1030` | page background (cool, not cream) |
| ink | `#1C1F52` | `#ECEEFB` | text (deep indigo, not near-black) |
| ink-soft | `#4A4E7A` | `#A8ADD8` | secondary text |
| rule | `#D9DEF0` | `#2A2E66` | hairlines |
| marker | `#FFC531` | `#FFC531` | highlighter under the three-line read (always with ink text on it) |

Category colors encode the niche (a spine on each story, the category label, the placeholder cover). Each has a `base` for fills and a `text` variant verified at 4.5:1 or better on its background.

| Category | slug | base | text (light) | text (dark) |
|---|---|---|---|---|
| Health and wellness | `health-wellness` | `#22A06B` | `#0F6B45` | `#5BD79F` |
| Education and career | `education-career` | `#3B6BFF` | `#1F43C7` | `#8CA8FF` |
| Entertainment and pop culture | `entertainment-pop-culture` | `#E0268A` | `#B0156A` | `#FF7DBE` |
| Biogas and clean energy | `biogas-clean-energy` | `#F26B1D` | `#B04A0A` | `#FF9A5C` |
| Digital marketing and social media | `digital-marketing-social-media` | `#8A4DF0` | `#6527C9` | `#BE9BFF` |

An automated test verifies every text and ink pair meets 4.5:1 in both themes.

### Type

- **Display and UI:** Bricolage Grotesque (variable, weights 500 to 800). Headlines at 700 to 800, tracking -0.02em, `text-wrap: balance`.
- **Reading:** Source Serif 4 (weights 400 and 600). Article body 18px at line-height 1.7; elsewhere 16px at 1.55.
- Scale (fluid with `clamp`): 12, 14, 16, 18, 22, 28, 40, 56, 72.
- Line length: article body 62 to 68 characters. Left-aligned, ragged right, everywhere.
- Fonts load through `next/font/google` (self-hosted at build, no runtime request to Google).

### Shape and space

- 4px base unit. Page gutter 16px on phones, 24px from 768px. Content width 1200px; article column 680px.
- Radius 6px on images only. No rounded boxes around stories.
- No shadows. Separation comes from hairlines (`rule`) and space.

## Layout

Stories are a feed of rows, not a grid of identical cards. Each row has a colored spine (4px, the category base color), a sentence-case category label in the category text color, the headline, and one line of context.

### Phone, home

```
┌──────────────────────────┐
│ GenZNews            ☰  ◐ │  wordmark, menu, theme
├──────────────────────────┤
│ Today in three lines     │
│ ┌──────────────────────┐ │
│ │ cover (hotlinked or  │ │
│ │ category placeholder)│ │
│ └──────────────────────┘ │
│ Headline of lead story   │
│ ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓       │  three-line read: each line
│ ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓         │  has a marker stroke behind it
│ ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓      │
├──────────────────────────┤
│▌Health and wellness      │  spine = category color
│▌Headline two lines max   │
│▌2 hours ago              │
├──────────────────────────┤
│▌Education and career     │
│ ...                      │
└──────────────────────────┘
```

### Desktop, home (1200px)

```
┌───────────────────────────────────────────────────────────┐
│ GenZNews   Latest  Health  Education  Entertainment  ...  🔍 ◐│
├───────────────────────────────┬───────────────────────────┤
│ Today in three lines          │ Latest                    │
│ [cover 16:9]                  │▌Headline            1h    │
│ Lead headline (56px)          │▌Headline            2h    │
│ ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓      │▌Headline            3h    │
│ ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓          │▌Headline            5h    │
│ ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓       │  See all latest           │
├───────────────────────────────┴───────────────────────────┤
│ Health and wellness            (one lane per category,    │
│ row · row · row                 3 rows, category-tinted   │
│                                 spine and heading)        │
└───────────────────────────────────────────────────────────┘
```

Article page: single 680px column, the three-line read at the top, body in the serif, a source block ("Reported by bbc.co.uk, rewritten by GenZNews" with the original link), then related stories as rows.

## Principles

1. **The three-line read is the signature.** It appears large on the lead story and small on every article page. Each line carries a marker stroke (`background: linear-gradient(transparent 62%, var(--marker) 62%)` with `box-decoration-break: clone`).
2. **Color means category.** Nothing else uses the category colors.
3. **Rows, not boxes.** Hairlines and space do the separating.
4. **One motion moment.** On the first home load the three lines of the lead story reveal one after another (90ms apart, once). Everything else is still. `prefers-reduced-motion` shows the final state at once.
5. **Quiet everywhere else.** Sentence case, plain verbs, no decorative icons, no gradients.

## Review against the generic defaults

| Default tell | What this design does instead |
|---|---|
| Cream background, serif display, terracotta accent | Cool paper, grotesque display, indigo ink; the warm color is the highlighter and only appears under text |
| Near-black with acid accent | Dark theme is deep indigo with five category colors, no single acid accent |
| Broadsheet columns, hairlines, zero radius | Spacious feed, big sans headlines, marker strokes, 6px radius on images |
| Identical rounded cards with soft shadows | Feed rows with a category spine; no shadows |
| ALL-CAPS tracked eyebrow labels, middle-dot meta strings, `→` on links, mono data labels | Sentence-case category labels, meta on separate lines, plain link text, no monospace |

What changed after review: the first draft used a serif for headlines (the tool's suggestion, "Newsreader and Roboto") and a red primary. Both are the stock news look, so headlines moved to Bricolage Grotesque, the serif moved to reading text only, and red was dropped for category-coded color.

## Copy rules

- Sentence case. Active voice. Buttons say what happens ("Read the story", "Search", "Load more stories").
- Empty: "No stories here yet. New ones land after each review."
- Error: say what failed and what to do ("We couldn't load stories. Refresh the page, or try again in a minute.").
- Footer line: "Truth First. News Always."
- Source credit on every article: "Reported by {outlet}. Rewritten by GenZNews." with a link to the original.

## Quality floor

Responsive at 375, 768, 1024 and 1440px; visible keyboard focus; skip link; reduced motion respected; 4.5:1 contrast in both themes; touch targets at least 44px; no layout shift from images (reserved aspect-ratio boxes).
