import type { CategorySlug } from "./categories";

export const COLORS = {
  light: {
    paper: "#F3F5FB",
    ink: "#1C1F52",
    inkSoft: "#4A4E7A",
    rule: "#D9DEF0",
    marker: "#FFC531",
  },
  dark: {
    paper: "#0E1030",
    ink: "#ECEEFB",
    inkSoft: "#A8ADD8",
    rule: "#2A2E66",
    marker: "#FFC531",
  },
} as const;

export const CATEGORY_COLORS: Record<
  CategorySlug,
  { base: string; textLight: string; textDark: string }
> = {
  "health-wellness": { base: "#22A06B", textLight: "#0F6B45", textDark: "#5BD79F" },
  "education-career": { base: "#3B6BFF", textLight: "#1F43C7", textDark: "#8CA8FF" },
  "entertainment-pop-culture": { base: "#E0268A", textLight: "#B0156A", textDark: "#FF7DBE" },
  "biogas-clean-energy": { base: "#F26B1D", textLight: "#B04A0A", textDark: "#FF9A5C" },
  "digital-marketing-social-media": { base: "#8A4DF0", textLight: "#6527C9", textDark: "#BE9BFF" },
};

function channel(v: number): number {
  const s = v / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

function luminance(hex: string): number {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG 2.x contrast ratio between two #rrggbb colors. */
export function contrastRatio(fg: string, bg: string): number {
  const a = luminance(fg);
  const b = luminance(bg);
  const [hi, lo] = a >= b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}
