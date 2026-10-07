import type { NextConfig } from "next";

/**
 * Content-Security-Policy in REPORT-ONLY mode: browsers report violations to the console
 * but block nothing, so this cannot break the site. Enforcement with per-request nonces is
 * deferred. Next's own inline bootstrap scripts and the inline theme script in the root
 * layout need 'unsafe-inline' for scripts until nonces are in place. Covers are hotlinked
 * from many news hosts, hence img-src https:.
 */
const CSP_REPORT_ONLY = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' https: data:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  // upgrade-insecure-requests is left out: browsers ignore it in a report-only policy and log a
  // console error on every page. Re-add it when the policy is enforced.
].join("; ");

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Content-Security-Policy-Report-Only", value: CSP_REPORT_ONLY },
];

const nextConfig: NextConfig = {
  // e2e builds use their own output dir so they never clobber a running dev or prod build.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  reactCompiler: true,
  poweredByHeader: false,
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
};

export default nextConfig;
