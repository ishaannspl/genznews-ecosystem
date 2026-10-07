import { describe, expect, test } from "vitest";
import { parseAssembledBody } from "../articleBody";
import { legacyBodyMd, parseLegacyContent } from "./legacyContent";

// Mirrors the f-string in app/ai_writer.py (full_content) exactly.
const SAMPLE = `**The Hook**
Ever worry your private medical history is one click away from a nosy stranger? The NHS is drawing a hard line.

**TL;DR (Quick Hits)**
- NHS England ordered immediate suspensions for snooping staff.
- The crackdown follows several high-profile scandals.
- At least 214 workers lost their jobs over five years.

**The Breakdown**
NHS England sent new guidance to every trust this week.

Staff suspected of browsing records without a reason are locked out at once.

**Why It Matters**
Your health data is yours. Rules like this decide who gets to see it.

---
*Sources: www.bbc.co.uk. Synthesized and curated by GenZNews.*`;

describe("parseLegacyContent", () => {
  test("splits the pipeline's assembled markdown into its parts", () => {
    const p = parseLegacyContent(SAMPLE);
    expect(p.hook).toBe(
      "Ever worry your private medical history is one click away from a nosy stranger? The NHS is drawing a hard line.",
    );
    expect(p.tldr).toEqual([
      "NHS England ordered immediate suspensions for snooping staff.",
      "The crackdown follows several high-profile scandals.",
      "At least 214 workers lost their jobs over five years.",
    ]);
    expect(p.breakdown).toBe(
      "NHS England sent new guidance to every trust this week.\n\nStaff suspected of browsing records without a reason are locked out at once.",
    );
    expect(p.whyItMatters).toBe("Your health data is yours. Rules like this decide who gets to see it.");
    expect(p.attribution).toBe("Sources: www.bbc.co.uk. Synthesized and curated by GenZNews.");
  });

  test("CRLF line endings parse the same", () => {
    expect(parseLegacyContent(SAMPLE.replace(/\n/g, "\r\n"))).toEqual(parseLegacyContent(SAMPLE));
  });

  test("no TL;DR section gives no bullets and keeps the rest", () => {
    const text = SAMPLE.replace(/\*\*TL;DR \(Quick Hits\)\*\*\n(- .*\n)+\n/, "");
    const p = parseLegacyContent(text);
    expect(p.tldr).toEqual([]);
    expect(p.hook).toContain("Ever worry");
    expect(p.breakdown).toContain("NHS England sent");
  });

  test("2 and 4 bullets are kept as found", () => {
    const two = SAMPLE.replace("- At least 214 workers lost their jobs over five years.\n", "");
    expect(parseLegacyContent(two).tldr).toHaveLength(2);
    const four = SAMPLE.replace("over five years.\n", "over five years.\n- A fourth point.\n");
    expect(parseLegacyContent(four).tldr).toHaveLength(4);
    expect(parseLegacyContent(four).tldr[3]).toBe("A fourth point.");
  });

  test("missing attribution gives null and leaves the last section intact", () => {
    const text = SAMPLE.replace(/\n---\n\*Sources:.*\*$/, "");
    const p = parseLegacyContent(text);
    expect(p.attribution).toBeNull();
    expect(p.whyItMatters).toBe("Your health data is yours. Rules like this decide who gets to see it.");
  });

  test("empty, null-ish and headerless content never throw", () => {
    expect(parseLegacyContent("")).toEqual({ hook: "", tldr: [], breakdown: "", whyItMatters: "", attribution: null });
    expect(parseLegacyContent(null)).toEqual({ hook: "", tldr: [], breakdown: "", whyItMatters: "", attribution: null });
    expect(parseLegacyContent(undefined).tldr).toEqual([]);
    const plain = parseLegacyContent("Just a paragraph.\n\nAnd another.");
    expect(plain.breakdown).toBe("Just a paragraph.\n\nAnd another.");
    expect(plain.hook).toBe("");
  });

  test("an unknown bold line stays in the section text", () => {
    const text = SAMPLE.replace("Staff suspected", "**Fun fact**\nStaff suspected");
    expect(parseLegacyContent(text).breakdown).toContain("**Fun fact**\nStaff suspected");
  });

  test("markdown heading variants (## The Hook) are recognised too", () => {
    const text = SAMPLE.replace("**The Hook**", "## The Hook").replace("**Why It Matters**", "### Why it matters:");
    const p = parseLegacyContent(text);
    expect(p.hook).toContain("Ever worry");
    expect(p.whyItMatters).toContain("Your health data");
  });

  test("a TL;DR written as plain lines becomes one bullet per line", () => {
    const text = SAMPLE.replace(/- NHS England/, "NHS England").replace(/- The crackdown/, "The crackdown").replace(/- At least/, "At least");
    expect(parseLegacyContent(text).tldr).toHaveLength(3);
  });
});

describe("legacyBodyMd", () => {
  test("standard sample: stage format, and parseAssembledBody reads 3 TL;DR lines back", () => {
    const body = legacyBodyMd(parseLegacyContent(SAMPLE));
    expect(body).toBe(
      "**TL;DR**\n\n" +
        "- NHS England ordered immediate suspensions for snooping staff.\n" +
        "- The crackdown follows several high-profile scandals.\n" +
        "- At least 214 workers lost their jobs over five years.\n\n" +
        "NHS England sent new guidance to every trust this week.\n\n" +
        "Staff suspected of browsing records without a reason are locked out at once.\n\n" +
        "## Why it matters\n\n" +
        "Your health data is yours. Rules like this decide who gets to see it.\n\n" +
        "---\n\n" +
        "*Sources: www.bbc.co.uk. Synthesized and curated by GenZNews.*\n",
    );
    const back = parseAssembledBody(body);
    expect(back.tldr).toHaveLength(3);
    expect(back.tldr[0]).toBe("NHS England ordered immediate suspensions for snooping staff.");
    expect(back.attribution).toBe("Sources: www.bbc.co.uk. Synthesized and curated by GenZNews.");
    expect(back.body).toContain("## Why it matters");
    expect(back.body).not.toContain("TL;DR");
  });

  test("no TL;DR: no TL;DR block", () => {
    const body = legacyBodyMd({ hook: "h", tldr: [], breakdown: "B", whyItMatters: "W", attribution: null });
    expect(body).toBe("B\n\n## Why it matters\n\nW\n");
    expect(parseAssembledBody(body)).toEqual({ tldr: [], body: "B\n\n## Why it matters\n\nW", attribution: null });
  });

  test("missing why-it-matters and attribution degrade without empty headings", () => {
    expect(legacyBodyMd({ hook: "", tldr: ["a", "b"], breakdown: "B", whyItMatters: "", attribution: null })).toBe(
      "**TL;DR**\n\n- a\n- b\n\nB\n",
    );
    expect(legacyBodyMd({ hook: "", tldr: [], breakdown: "", whyItMatters: "", attribution: null })).toBe("");
    expect(legacyBodyMd({ hook: "", tldr: [], breakdown: "", whyItMatters: "", attribution: "Src" })).toBe("---\n\n*Src*\n");
  });

  test("CRLF input gives LF-only output", () => {
    expect(legacyBodyMd(parseLegacyContent(SAMPLE.replace(/\n/g, "\r\n")))).not.toContain("\r");
  });
});
