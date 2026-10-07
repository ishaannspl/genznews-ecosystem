import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { readMigrations } from "./exportLegacy";
import { renderSetupSql } from "./legacyImport";

const dir = join(__dirname, "..", "..", "..", "supabase", "migrations");
const m1 = readFileSync(join(dir, "0001_site_tables.sql"), "utf8");
const m2 = readFileSync(join(dir, "0002_published_at_default.sql"), "utf8");
const NOTIFY = "notify pgrst, 'reload schema';";

describe("migrations are re-runnable", () => {
  test("every create policy is immediately preceded by a matching drop policy if exists", () => {
    const lines = m1.split("\n");
    const creates = lines.map((l, i) => ({ l, i })).filter((x) => x.l.startsWith("create policy"));
    expect(creates).toHaveLength(5);
    for (const { l, i } of creates) {
      const m = /^create policy ("[^"]+") on (\S+)/.exec(l);
      expect(m).not.toBeNull();
      expect(lines[i - 1]).toBe(`drop policy if exists ${m![1]} on ${m![2]};`);
    }
    expect(m1.match(/drop policy if exists/g)).toHaveLength(5);
  });

  test("both migrations end with the schema reload notify", () => {
    expect(m1.trimEnd().endsWith(NOTIFY)).toBe(true);
    expect(m2.trimEnd().endsWith(NOTIFY)).toBe(true);
  });

  test("tables and indexes stay if not exists, and no dashes", () => {
    expect(m1).not.toMatch(/create table (?!if not exists)/);
    expect(m1).not.toMatch(/create (unique )?index (?!if not exists)/);
    expect(m1 + m2).not.toMatch(/[\u2013\u2014]/);
  });

  test("the generated setup file embeds each real migration exactly once, verbatim", () => {
    const migs = readMigrations(dir);
    const setup = renderSetupSql("begin;\ncommit;\n\nselect 1;\n", migs);
    expect(setup.split(m1).length - 1).toBe(1);
    expect(setup.split(m2).length - 1).toBe(1);
    expect(setup.indexOf(m1)).toBeLessThan(setup.indexOf(m2));
    expect(setup.endsWith(`select 1;\n\n-- Ask the API (PostgREST) to refresh its table cache.\n${NOTIFY}\n`)).toBe(true);
  });
});
