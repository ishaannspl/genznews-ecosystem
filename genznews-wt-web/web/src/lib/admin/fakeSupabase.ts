import { vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

export type Call = { method: string; args: unknown[] };
type Result = { data?: unknown; error?: unknown; count?: number | null };

/** Recording fake of the chainable Supabase query builder. Every call is logged; awaiting resolves to `result`. */
export function fakeSupabase(result: Result | ((calls: Call[]) => Result) = {}) {
  const calls: Call[] = [];
  const resolve = () => ({ data: null, error: null, count: null, ...(typeof result === "function" ? result(calls) : result) });
  const builder: Record<string, unknown> = {};
  for (const m of ["select", "update", "eq", "neq", "in", "order", "range"]) {
    builder[m] = vi.fn((...args: unknown[]) => {
      calls.push({ method: m, args });
      return builder;
    });
  }
  builder.maybeSingle = vi.fn(async () => {
    calls.push({ method: "maybeSingle", args: [] });
    return resolve();
  });
  builder.then = (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => Promise.resolve(resolve()).then(ok, bad);
  const from = vi.fn((table: string) => {
    calls.push({ method: "from", args: [table] });
    return builder;
  });
  return { client: { from } as unknown as SupabaseClient, calls, from };
}

export const callsOf = (calls: Call[], method: string) => calls.filter((c) => c.method === method);
