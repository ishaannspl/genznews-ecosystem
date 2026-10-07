import { describe, expect, test } from "vitest";
import { CATEGORIES, categoryByNicheKey, categoryBySlug, expectedNicheKey } from "./categories";

describe("categories", () => {
  test("test_five_categories_in_order", () => {
    expect(CATEGORIES.map((c) => c.slug)).toEqual([
      "health-wellness",
      "education-career",
      "entertainment-pop-culture",
      "biogas-clean-energy",
      "digital-marketing-social-media",
    ]);
    expect(CATEGORIES.map((c) => c.name)).toEqual([
      "Health and wellness",
      "Education and career",
      "Entertainment and pop culture",
      "Biogas and clean energy",
      "Digital marketing and social media",
    ]);
  });

  test("test_short_names_for_nav", () => {
    expect(CATEGORIES.map((c) => c.shortName)).toEqual([
      "Health",
      "Education",
      "Entertainment",
      "Clean energy",
      "Marketing",
    ]);
    expect(new Set(CATEGORIES.map((c) => c.shortName)).size).toBe(5);
    for (const c of CATEGORIES) expect(c.shortName.length).toBeGreaterThan(0);
  });

  test("test_slug_and_niche_key_roundtrip", () => {
    for (const c of CATEGORIES) {
      expect(c.nicheKey).toBe(c.slug.replaceAll("-", "_"));
      expect(categoryByNicheKey(c.nicheKey)?.slug).toBe(c.slug);
      expect(categoryBySlug(c.slug)?.nicheKey).toBe(c.nicheKey);
    }
  });

  test("test_unknown_slug_is_undefined", () => {
    expect(categoryBySlug("sports")).toBeUndefined();
    expect(categoryByNicheKey("sports")).toBeUndefined();
  });

  test("test_niche_key_lookup_is_exact", () => {
    for (const variant of [" health_wellness ", "Health_Wellness", "health-wellness", "HEALTH_WELLNESS", "biogas_clean-energy"]) {
      expect(categoryByNicheKey(variant), variant).toBeUndefined();
    }
    for (const bad of ["", "   ", "sports", "health", "health wellness", "health__wellness"]) {
      expect(categoryByNicheKey(bad), bad).toBeUndefined();
    }
  });

  test("test_expected_niche_key_names_the_key_a_variant_was_meant_to_be", () => {
    expect(expectedNicheKey("Health-Wellness")).toBe("health_wellness");
    expect(expectedNicheKey(" biogas_clean-energy ")).toBe("biogas_clean_energy");
    expect(expectedNicheKey("health_wellness")).toBe("health_wellness");
    expect(expectedNicheKey("sports")).toBeUndefined();
    expect(expectedNicheKey("")).toBeUndefined();
  });
});
