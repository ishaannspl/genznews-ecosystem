/**
 * Reads the legacy pipeline's `genz_content` (the assembled markdown built in app/ai_writer.py):
 *
 *   **The Hook**\n<hook>\n\n**TL;DR (Quick Hits)**\n- a\n- b\n- c\n\n**The Breakdown**\n<text>\n\n
 *   **Why It Matters**\n<text>\n\n---\n*<attribution>*
 *
 * and rewrites it in the framework stage's body format (framework_stage/generate.py assemble_body),
 * which `parseAssembledBody` reads. Tolerant and line-based; never throws.
 */

export interface LegacyContent {
  hook: string;
  tldr: string[];
  breakdown: string;
  whyItMatters: string;
  attribution: string | null;
}

type SectionKey = "hook" | "tldr" | "breakdown" | "why";

const HEADER = /^\s*(?:\*\*(.+?)\*\*|#{1,6}\s+(.+?))\s*:?\s*$/;
const BULLET = /^\s*[-*•]\s+(.*\S)\s*$/;
const ITALIC_LINE = /^\s*\*(?!\*)(.+?)\*\s*$/;
const RULE = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/;

function sectionOf(line: string): SectionKey | null {
  const m = HEADER.exec(line);
  if (!m) return null;
  const name = (m[1] ?? m[2] ?? "").trim().replace(/:$/, "").trim().toLowerCase();
  if (/^(the\s+)?hook\b/.test(name)) return "hook";
  if (/^tl;?\s*dr\b/.test(name)) return "tldr";
  if (/^(the\s+)?breakdown\b/.test(name)) return "breakdown";
  if (/^why\s+it\s+matters\b/.test(name)) return "why";
  return null;
}

/** Joins section lines, dropping leading/trailing blank lines and trailing horizontal rules. */
function text(lines: string[]): string {
  const copy = [...lines];
  while (copy.length > 0 && (copy[copy.length - 1].trim() === "" || RULE.test(copy[copy.length - 1]))) copy.pop();
  return copy.join("\n").trim();
}

export function parseLegacyContent(content: string | null | undefined): LegacyContent {
  const lines = String(content ?? "").replace(/\r\n?/g, "\n").split("\n");

  // Attribution: the last non-blank line is italic and (ignoring blanks) preceded by a rule.
  let attribution: string | null = null;
  let end = lines.length;
  while (end > 0 && lines[end - 1].trim() === "") end--;
  if (end > 0 && ITALIC_LINE.test(lines[end - 1])) {
    let r = end - 2;
    while (r >= 0 && lines[r].trim() === "") r--;
    if (r >= 0 && RULE.test(lines[r])) {
      attribution = ITALIC_LINE.exec(lines[end - 1])![1].trim() || null;
      end = r;
    }
  }

  const buckets: Record<SectionKey | "pre", string[]> = { pre: [], hook: [], tldr: [], breakdown: [], why: [] };
  let current: SectionKey | "pre" = "pre";
  let sawHeader = false;
  for (const line of lines.slice(0, end)) {
    const key = sectionOf(line);
    if (key) {
      current = key;
      sawHeader = true;
    } else {
      buckets[current].push(line);
    }
  }

  // Text before any known header (or content with no headers at all) is kept as body text.
  const pre = text(buckets.pre);
  const breakdown = [pre, text(buckets.breakdown)].filter(Boolean).join("\n\n");

  const bulletLines = buckets.tldr.map((l) => BULLET.exec(l)?.[1].trim()).filter((b): b is string => Boolean(b));
  const tldr =
    bulletLines.length > 0
      ? bulletLines
      : buckets.tldr.map((l) => l.trim()).filter((l) => l !== "" && !RULE.test(l));

  return {
    hook: sawHeader ? text(buckets.hook) : "",
    tldr,
    breakdown,
    whyItMatters: text(buckets.why),
    attribution,
  };
}

/**
 * The stage's assembled body: `**TL;DR**\n\n- a\n- b\n- c\n\n<breakdown>\n\n## Why it matters\n\n<why>\n\n---\n\n*<attribution>*\n`.
 * Missing parts are left out (no empty TL;DR block, no empty heading).
 */
export function legacyBodyMd(c: LegacyContent): string {
  const blocks: string[] = [];
  const bullets = c.tldr.map((b) => b.replace(/\s+/g, " ").trim()).filter(Boolean);
  if (bullets.length > 0) blocks.push(`**TL;DR**\n\n${bullets.map((b) => `- ${b}`).join("\n")}`);
  if (c.breakdown.trim()) blocks.push(c.breakdown.trim());
  if (c.whyItMatters.trim()) blocks.push(`## Why it matters\n\n${c.whyItMatters.trim()}`);
  const attribution = c.attribution?.replace(/\s+/g, " ").trim();
  if (attribution) blocks.push(`---\n\n*${attribution}*`);
  return blocks.length > 0 ? `${blocks.join("\n\n")}\n`.replace(/\r/g, "") : "";
}
