import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { readEnv } from "./env";

describe("readEnv", () => {
  test("test_data_source_is_required_in_every_environment", () => {
    for (const NODE_ENV of ["development", "test", "production", undefined]) {
      expect(() => readEnv({ NODE_ENV })).toThrow(/DATA_SOURCE/);
      expect(() => readEnv({ NODE_ENV, DATA_SOURCE: "  " })).toThrow(/DATA_SOURCE/);
    }
    expect(() => readEnv({})).toThrow(/web\/\.env\.local/);
    expect(() => readEnv({})).toThrow(/supabase/);
  });

  test("test_fixtures_only_when_explicitly_set", () => {
    for (const NODE_ENV of ["development", "test", "production"]) {
      expect(readEnv({ NODE_ENV, DATA_SOURCE: "fixtures" })).toEqual({ dataSource: "fixtures" });
    }
  });

  test("test_supabase_mode_requires_url_and_anon_key", () => {
    expect(() => readEnv({ DATA_SOURCE: "supabase", SUPABASE_ANON_KEY: "k" })).toThrow(/SUPABASE_URL/);
    expect(() => readEnv({ DATA_SOURCE: "supabase", SUPABASE_URL: "https://x.supabase.co" })).toThrow(
      /SUPABASE_ANON_KEY/,
    );
    expect(() => readEnv({ DATA_SOURCE: "supabase", SUPABASE_URL: "ftp://x", SUPABASE_ANON_KEY: "k" })).toThrow(
      /SUPABASE_URL/,
    );
    expect(() => readEnv({ DATA_SOURCE: "supabase", SUPABASE_URL: "not a url", SUPABASE_ANON_KEY: "k" })).toThrow(
      /SUPABASE_URL/,
    );
    expect(
      readEnv({ NODE_ENV: "production", DATA_SOURCE: "supabase", SUPABASE_URL: "https://x.supabase.co", SUPABASE_ANON_KEY: "k" }),
    ).toEqual({ dataSource: "supabase", supabaseUrl: "https://x.supabase.co", supabaseAnonKey: "k" });
  });

  test("test_service_key_is_never_read", () => {
    const src = readFileSync(join(process.cwd(), "src/lib/env.ts"), "utf8");
    expect(src).not.toMatch(/SERVICE/i);
  });

  test("test_invalid_data_source_throws", () => {
    expect(() => readEnv({ DATA_SOURCE: "postgres" })).toThrow(/DATA_SOURCE/);
    expect(() => readEnv({ NODE_ENV: "production", DATA_SOURCE: "" })).toThrow(/DATA_SOURCE/);
    expect(() => readEnv({ DATA_SOURCE: "postgres" })).toThrow(/'supabase'/);
  });

  test("error messages never contain secret values", () => {
    try {
      readEnv({ DATA_SOURCE: "supabase", SUPABASE_URL: "ftp://secret-host", SUPABASE_ANON_KEY: "topsecret" });
    } catch (e) {
      expect(String((e as Error).message)).not.toMatch(/secret/);
    }
  });
});
