export type CategorySlug =
  | "health-wellness"
  | "education-career"
  | "entertainment-pop-culture"
  | "biogas-clean-energy"
  | "digital-marketing-social-media";

export interface Category {
  slug: CategorySlug;
  nicheKey: string;
  name: string;
  shortName: string;
}

export const CATEGORIES: readonly Category[] = [
  { slug: "health-wellness", nicheKey: "health_wellness", name: "Health and wellness", shortName: "Health" },
  { slug: "education-career", nicheKey: "education_career", name: "Education and career", shortName: "Education" },
  {
    slug: "entertainment-pop-culture",
    nicheKey: "entertainment_pop_culture",
    name: "Entertainment and pop culture",
    shortName: "Entertainment",
  },
  { slug: "biogas-clean-energy", nicheKey: "biogas_clean_energy", name: "Biogas and clean energy", shortName: "Clean energy" },
  {
    slug: "digital-marketing-social-media",
    nicheKey: "digital_marketing_social_media",
    name: "Digital marketing and social media",
    shortName: "Marketing",
  },
];

export function categoryBySlug(slug: string): Category | undefined {
  return CATEGORIES.find((c) => c.slug === slug);
}

/** The category for a stored niche key (`health_wellness`). Exact match only. */
export function categoryByNicheKey(key: string): Category | undefined {
  return CATEGORIES.find((c) => c.nicheKey === key);
}

/**
 * For log messages only: the niche key a near miss was probably meant to be (surrounding spaces,
 * letter case or the slug form, e.g. `Health-Wellness` gives `health_wellness`). Never used to
 * map rows: the stored key must match exactly.
 */
export function expectedNicheKey(value: string): string | undefined {
  const norm = value.trim().toLowerCase().replaceAll("-", "_");
  return CATEGORIES.find((c) => c.nicheKey === norm)?.nicheKey;
}
