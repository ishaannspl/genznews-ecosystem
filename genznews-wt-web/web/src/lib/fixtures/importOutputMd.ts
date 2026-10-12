import { categoryByNicheKey } from "../categories";
import type { Article } from "../types";

const TRACKING_PARAM = /^(at_medium|at_campaign|utm_.*)$/i;

function header(lines: string[], label: string): string | null {
  const prefix = `**${label}:**`;
  for (const line of lines) {
    if (line.startsWith(prefix)) return line.slice(prefix.length).trim();
  }
  return null;
}

function sections(lines: string[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  let current: string[] | null = null;
  for (const line of lines) {
    const m = /^##\s+(.+?)\s*$/.exec(line);
    if (m) {
      current = [];
      out.set(m[1].toLowerCase(), current);
    } else if (current) {
      current.push(line);
    }
  }
  return out;
}

function findSection(map: Map<string, string[]>, prefix: string): string[] | null {
  for (const [k, v] of map) if (k.startsWith(prefix)) return v;
  return null;
}

/** Drops trailing blank lines, rules and the italic attribution line. */
function cleanSection(lines: string[]): string {
  const copy = [...lines];
  while (copy.length > 0) {
    const t = copy[copy.length - 1].trim();
    if (t === "" || t === "---" || /^\*(?!\*).+\*$/.test(t)) copy.pop();
    else break;
  }
  return copy.join("\n").trim();
}

/** The URL with tracking parameters (`utm_*`, `at_medium`, `at_campaign`) removed, or null if it does not parse. */
export function cleanUrl(raw: string): URL | null {
  try {
    const url = new URL(raw);
    for (const key of [...url.searchParams.keys()]) {
      if (TRACKING_PARAM.test(key)) url.searchParams.delete(key);
    }
    return url;
  } catch {
    return null;
  }
}

/** The raw source URL from an output file's `**Source URL:**` header (link target or bare URL). */
export function outputMdSourceUrl(markdown: string): string | null {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const sourceLine = header(lines, "Source URL");
  if (!sourceLine) return null;
  const link = /\]\(([^)\s]+)\)/.exec(sourceLine);
  return link ? link[1] : sourceLine;
}

/**
 * Turns one pipeline `output/<niche_key>/*.md` file into an Article.
 * Returns null when the file does not have the expected shape.
 */
export function importOutputMd(markdown: string, nicheKey: string): Article | null {
  const category = categoryByNicheKey(nicheKey);
  if (!category) return null;

  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const h1 = lines.find((l) => /^#\s+\S/.test(l));
  if (!h1) return null;
  const title = h1.replace(/^#\s+/, "").trim();

  const slug = header(lines, "Slug")?.replace(/`/g, "").trim();
  const dateRaw = header(lines, "Date Processed");
  const sourceLine = header(lines, "Source URL");
  if (!slug || !dateRaw || !sourceLine) return null;

  const published = new Date(dateRaw);
  if (Number.isNaN(published.getTime())) return null;

  const link = /\]\(([^)\s]+)\)/.exec(sourceLine);
  const url = cleanUrl(link ? link[1] : sourceLine);
  if (!url) return null;
  const sourceName = url.hostname.replace(/^www\./i, "");
  const sourceUrl = url.toString();

  const secs = sections(lines);
  const hook = findSection(secs, "the hook");
  const tldrSec = findSection(secs, "tl;dr");
  const breakdown = findSection(secs, "the breakdown");
  const why = findSection(secs, "why it matters");
  if (!hook || !tldrSec || !breakdown || !why) return null;

  const summary = cleanSection(hook);
  const bullets = tldrSec
    .map((l) => /^\s*[-*]\s+(.*\S)\s*$/.exec(l)?.[1].trim())
    .filter((b): b is string => Boolean(b));
  const breakdownText = cleanSection(breakdown);
  const whyText = cleanSection(why);
  if (!summary || bullets.length === 0 || !breakdownText || !whyText) return null;

  const attrLine = [...lines].reverse().find((l) => l.trim() !== "");
  const attrMatch = attrLine ? /^\*(?!\*)(.+)\*$/.exec(attrLine.trim()) : null;
  const attribution = attrMatch ? attrMatch[1].trim() : null;

  const body = `${breakdownText}\n\n## Why it matters\n\n${whyText}`;
  let bodyMd = `**TL;DR**\n\n${bullets.map((b) => `- ${b}`).join("\n")}\n\n${body}\n`;
  if (attribution) bodyMd = `${bodyMd}\n---\n\n*${attribution}*\n`;

  const tagsRaw = header(lines, "Tags") ?? "";
  const tags = tagsRaw
    .split(/,\s*/)
    .map((t) => t.replace(/^#/, "").trim())
    .filter(Boolean);

  const optionLine = lines.find((l) => /^-\s*Option 1:/i.test(l));
  const seoTitle = optionLine ? optionLine.replace(/^-\s*Option 1:\s*/i, "").trim() : title;

  const meta = header(lines, "Meta Description")?.replace(/\*/g, "").trim();

  return {
    id: slug,
    slug,
    title,
    summary,
    bodyMd,
    category: category.slug,
    tags,
    sourceName,
    sourceUrl,
    imageUrl: null,
    publishedAt: published.toISOString(),
    seoTitle: seoTitle || title,
    seoDescription: meta || null,
    framework: null,
  };
}
