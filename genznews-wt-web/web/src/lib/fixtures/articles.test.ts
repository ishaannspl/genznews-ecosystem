import { describe, expect, test } from "vitest";
import articles from "./articles.json";
import { parseAssembledBody } from "../articleBody";
import { CATEGORIES } from "../categories";
import type { Article } from "../types";

const all = articles as Article[];

describe("generated articles.json", () => {
  test("has 15 unique slugs", () => {
    expect(all).toHaveLength(15);
    expect(new Set(all.map((a) => a.slug)).size).toBe(15);
  });

  test("covers all five categories", () => {
    expect(new Set(all.map((a) => a.category))).toEqual(new Set(CATEGORIES.map((c) => c.slug)));
  });

  test("every article has exactly 3 TL;DR lines, an attribution and no image", () => {
    for (const a of all) {
      const p = parseAssembledBody(a.bodyMd);
      expect(p.tldr, a.slug).toHaveLength(3);
      expect(p.attribution, a.slug).toBeTruthy();
      expect(a.imageUrl, a.slug).toBeNull();
    }
  });
});
