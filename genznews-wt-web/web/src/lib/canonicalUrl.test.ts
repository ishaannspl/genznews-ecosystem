import { describe, expect, test } from "vitest";
import { canonicalUrl, canonicalUrlHash } from "./canonicalUrl";

// Expected values were computed with the real Python get_canonical_url / compute_url_hash
// from app/database.py (reproduced verbatim in a throwaway script).
describe("canonical url", () => {
  test("test_hash_matches_python_with_tracking_params", () => {
    const u = "https://Example.com/News/Story-1/?utm_source=x&id=5&b=a%20b&fbclid=zz#frag";
    expect(canonicalUrl(u)).toBe("https://example.com/News/Story-1?b=a+b&id=5");
    expect(canonicalUrlHash(u)).toBe("a9383650c8df9bcfacd10fbb72e725805df01d28e9919f6b9d05316973ce530e");
  });
  test("test_hash_matches_python_plain_url", () => {
    const u = "https://www.thehindu.com/sci-tech/health/some-story/article123.ece";
    expect(canonicalUrlHash(u)).toBe("244af38fb2995e9659042639ef177aa83387f265dcc845e46594b4193e99850d");
  });
  test("test_hash_matches_python_quoting_and_sorting", () => {
    const u = "HTTP://Example.COM/a/?z=1&a=2&ref=tw&q=caf%C3%A9~*";
    expect(canonicalUrl(u)).toBe("http://example.com/a?a=2&q=caf%C3%A9~%2A&z=1");
    expect(canonicalUrlHash(u)).toBe("bf6fe911fb72ddd3f6353280354fda8f284aad3de732b11d8169656118c08c82");
  });
  test("tracking variants hash the same", () => {
    expect(canonicalUrlHash("https://a.com/x/?utm_medium=y")).toBe(canonicalUrlHash(" https://A.com/x "));
  });
});
