import { describe, expect, test } from "vitest";
import { importOutputMd } from "./importOutputMd";
import { parseAssembledBody } from "../articleBody";

const sample = `# NHS Slaps Instant Suspensions on Medical Record Snoopers

**Niche:** Health Wellness  
**Slug:** \`nhs-instant-suspension-medical-record-snoopers\`  
**Meta Description:** *NHS staff caught snooping on confidential patient files will face immediate suspension.*  
**Tags:** #health, #privacy, #nhs, #data-security, #uk-news  
**Source URL:** [www.bbc.co.uk](https://www.bbc.co.uk/news/articles/cjr4v9g14vygo?at_medium=RSS&at_campaign=rss&utm_source=x&id=7)  
**Date Processed:** 2026-09-25T12:55:24.376620+00:00  

---

## Alternative Headline Options (A/B Testing)

- Option 1: NHS Slaps Instant Suspensions on Medical Record Snoopers
- Option 2: Nosy NHS Staff Face Immediate Suspension for Data Snooping
- Option 3: Zero Tolerance: NHS Cracks Down on Unauthorized Patient File Access

---

## The Hook

Ever worry your most private medical history is just sitting there? The NHS is drawing a hard line.

## TL;DR (Quick Hits)

- NHS England ordered immediate suspensions.
- The crackdown follows multiple scandals.
- At least 214 workers lost their jobs.

## The Breakdown

Medical records contain intimate details.

Under the new mandate, suspects get locked out.

## Why It Matters

Digital privacy is non-negotiable.

---

*Sources: bbc.co.uk. Synthesized and curated by GenZNews.*
`;

describe("importOutputMd", () => {
  test("test_maps_title_slug_tags_source_and_date", () => {
    const a = importOutputMd(sample, "health_wellness");
    expect(a).not.toBeNull();
    expect(a!.title).toBe("NHS Slaps Instant Suspensions on Medical Record Snoopers");
    expect(a!.slug).toBe("nhs-instant-suspension-medical-record-snoopers");
    expect(a!.id).toBe(a!.slug);
    expect(a!.tags).toEqual(["health", "privacy", "nhs", "data-security", "uk-news"]);
    expect(a!.sourceName).toBe("bbc.co.uk");
    expect(a!.publishedAt).toBe("2026-09-25T12:55:24.376Z");
    expect(a!.summary).toMatch(/^Ever worry your most private/);
    expect(a!.seoTitle).toBe("NHS Slaps Instant Suspensions on Medical Record Snoopers");
    expect(a!.seoDescription).toBe(
      "NHS staff caught snooping on confidential patient files will face immediate suspension.",
    );
    expect(a!.framework).toBeNull();
  });

  test("tracking params are stripped from sourceUrl but other params stay", () => {
    const a = importOutputMd(sample, "health_wellness")!;
    expect(a.sourceUrl).toBe("https://www.bbc.co.uk/news/articles/cjr4v9g14vygo?id=7");
    const b = importOutputMd(
      sample.replace("?at_medium=RSS&at_campaign=rss&utm_source=x&id=7", "?at_medium=RSS&at_campaign=rss"),
      "health_wellness",
    )!;
    expect(b.sourceUrl).toBe("https://www.bbc.co.uk/news/articles/cjr4v9g14vygo");
  });

  test("test_category_comes_from_directory_niche_key", () => {
    expect(importOutputMd(sample, "health_wellness")!.category).toBe("health-wellness");
    expect(importOutputMd(sample, "education_career")!.category).toBe("education-career");
    expect(importOutputMd(sample, "not_a_niche")).toBeNull();
  });

  test("test_body_is_assembled_in_stage_format_and_round_trips_through_parseAssembledBody", () => {
    const a = importOutputMd(sample, "health_wellness")!;
    expect(a.bodyMd.startsWith("**TL;DR**\n\n- NHS England ordered immediate suspensions.\n")).toBe(true);
    expect(a.bodyMd.endsWith("\n\n---\n\n*Sources: bbc.co.uk. Synthesized and curated by GenZNews.*\n")).toBe(true);
    const p = parseAssembledBody(a.bodyMd);
    expect(p.tldr).toHaveLength(3);
    expect(p.attribution).toBe("Sources: bbc.co.uk. Synthesized and curated by GenZNews.");
    expect(p.body).toBe(
      "Medical records contain intimate details.\n\nUnder the new mandate, suspects get locked out.\n\n## Why it matters\n\nDigital privacy is non-negotiable.",
    );
  });

  test("test_image_url_is_null", () => {
    expect(importOutputMd(sample, "health_wellness")!.imageUrl).toBeNull();
  });

  test("a malformed md with no H1 returns null", () => {
    expect(importOutputMd(sample.replace(/^# .*\n/, ""), "health_wellness")).toBeNull();
    expect(importOutputMd("", "health_wellness")).toBeNull();
  });

  test("CRLF input imports the same article", () => {
    const a = importOutputMd(sample.replace(/\n/g, "\r\n"), "health_wellness");
    expect(a).toEqual(importOutputMd(sample, "health_wellness"));
  });
});
