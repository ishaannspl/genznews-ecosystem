import { describe, expect, test } from "vitest";
import nextConfig from "../next.config";

describe("next.config", () => {
  test("test_security_headers_present", async () => {
    const rules = await nextConfig.headers!();
    const rule = rules.find((r) => r.source === "/(.*)");
    expect(rule).toBeDefined();
    const h = Object.fromEntries(rule!.headers.map(({ key, value }) => [key, value]));
    expect(h["X-Content-Type-Options"]).toBe("nosniff");
    expect(h["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
    expect(h["X-Frame-Options"]).toBe("DENY");
    expect(h["Permissions-Policy"]).toBe("camera=(), microphone=(), geolocation=()");
    expect(h["Content-Security-Policy-Report-Only"]).toBe(
      "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' https: data:; " +
        "font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; " +
        "frame-ancestors 'none'",
    );
    // Ignored by browsers in a report-only policy (and logged as a console error), so left out until enforced.
    expect(h["Content-Security-Policy-Report-Only"]).not.toContain("upgrade-insecure-requests");
    // Report-only: nothing is enforced yet, so no enforcing header may be present.
    expect(h["Content-Security-Policy"]).toBeUndefined();
    expect(nextConfig.poweredByHeader).toBe(false);
    expect(nextConfig.reactCompiler).toBe(true);
  });
});
