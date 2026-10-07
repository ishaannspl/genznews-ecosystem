// @vitest-environment node
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const dir = fileURLToPath(new URL("../supabase/migrations/", import.meta.url));
const read = (name: string) => readFileSync(`${dir}${name}`, "utf8").replace(/\s+/g, " ").toLowerCase();

describe("0002_published_at_default.sql", () => {
  const file = "0002_published_at_default.sql";

  test("test_migration_0002_exists", () => {
    expect(existsSync(`${dir}${file}`)).toBe(true);
  });

  test("test_migration_0002_defines_the_trigger_function", () => {
    const sql = read(file);
    expect(sql).toContain("create or replace function public.site_articles_set_published_at() returns trigger");
    expect(sql).toMatch(/if new\.status = 'published' and new\.published_at is null then new\.published_at := now\(\);/);
    expect(sql).toContain("return new;");
  });

  test("test_migration_0002_trigger_is_rerunnable_before_insert_or_update", () => {
    const sql = read(file);
    expect(sql).toMatch(/drop trigger if exists (\w+) on public\.site_articles;/);
    const name = /drop trigger if exists (\w+) on public\.site_articles;/.exec(sql)![1];
    expect(sql).toContain(`create trigger ${name} before insert or update on public.site_articles`);
    expect(sql).toContain("for each row execute function public.site_articles_set_published_at()");
    // The drop comes first, so running the file twice does not fail.
    expect(sql.indexOf("drop trigger")).toBeLessThan(sql.indexOf("create trigger"));
  });

  test("test_migration_0002_backfills_published_rows_once", () => {
    const sql = read(file);
    expect(sql).toContain(
      "update public.site_articles set published_at = created_at where status = 'published' and published_at is null;",
    );
  });
});
