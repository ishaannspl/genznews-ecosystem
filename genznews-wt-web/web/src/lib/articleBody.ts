export interface ParsedBody {
  tldr: string[];
  body: string;
  attribution: string | null;
}

const RULE = /^\s*---\s*$/;
const ITALIC_LINE = /^\s*\*(?!\*)(.+?)\*\s*$/;
const BULLET = /^\s*[-*]\s+(.*\S)\s*$/;

/**
 * Parses the stage's assembled body format:
 * `**TL;DR**\n\n- a\n- b\n- c\n\n<body>\n\n---\n\n*<attribution>*\n`.
 * Tolerant and line-based; never throws.
 */
export function parseAssembledBody(bodyMd: string): ParsedBody {
  const lines = String(bodyMd ?? "").replace(/\r\n?/g, "\n").split("\n");
  let start = 0;
  const tldr: string[] = [];

  while (start < lines.length && lines[start].trim() === "") start++;
  if (start < lines.length && /^\*\*TL;DR\*\*:?\s*$/i.test(lines[start].trim())) {
    start++;
    while (start < lines.length) {
      const line = lines[start];
      if (line.trim() === "") {
        start++;
        continue;
      }
      const m = BULLET.exec(line);
      if (!m) break;
      tldr.push(m[1].trim());
      start++;
    }
  } else {
    start = 0;
  }

  let end = lines.length;
  while (end > start && lines[end - 1].trim() === "") end--;

  let attribution: string | null = null;
  // Last non-blank line must be an italic line, preceded (ignoring blanks) by a rule.
  const last = end - 1;
  if (last >= start && ITALIC_LINE.test(lines[last])) {
    let r = last - 1;
    while (r >= start && lines[r].trim() === "") r--;
    if (r >= start && RULE.test(lines[r])) {
      attribution = ITALIC_LINE.exec(lines[last])![1].trim();
      end = r;
    }
  }

  const body = lines.slice(start, end).join("\n").trim();
  return { tldr, body, attribution };
}
