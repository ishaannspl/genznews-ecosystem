import { describe, expect, it, vi } from "vitest";

const { redirect, createAdminClient } = vi.hoisted(() => ({
  redirect: vi.fn((to: string): never => {
    throw new Error(`REDIRECT:${to}`);
  }),
  createAdminClient: vi.fn(),
}));
vi.mock("next/navigation", () => ({ redirect }));
vi.mock("./supabaseServer", () => ({ createAdminClient }));

import type { SupabaseClient } from "@supabase/supabase-js";
import { getAdmin, requireAdmin } from "./session";

function fakeClient(opts: {
  user?: { email?: string } | null;
  authError?: unknown;
  row?: { email: string } | null;
}): SupabaseClient {
  const maybeSingle = vi.fn(async () => ({ data: opts.row ?? null, error: null }));
  const eq = vi.fn(() => ({ maybeSingle }));
  const select = vi.fn(() => ({ eq }));
  return {
    auth: {
      getUser: vi.fn(async () => ({ data: { user: opts.user ?? null }, error: opts.authError ?? null })),
    },
    from: vi.fn(() => ({ select })),
  } as unknown as SupabaseClient;
}

describe("getAdmin", () => {
  it("returns null when nobody is signed in", async () => {
    expect(await getAdmin(fakeClient({ user: null }))).toBeNull();
  });

  it("returns null when the user is not on the allowlist", async () => {
    expect(await getAdmin(fakeClient({ user: { email: "x@y.com" }, row: null }))).toBeNull();
  });

  it("returns null when getUser reports an auth error (expired or tampered token)", async () => {
    const client = fakeClient({ user: { email: "x@y.com" }, authError: { message: "bad jwt" }, row: { email: "x@y.com" } });
    expect(await getAdmin(client)).toBeNull();
  });

  it("returns null when getUser throws (auth server unreachable)", async () => {
    const client = fakeClient({});
    (client.auth.getUser as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("fetch failed"));
    expect(await getAdmin(client)).toBeNull();
  });

  it("returns the email when the user is allowlisted", async () => {
    const client = fakeClient({ user: { email: "a@b.com" }, row: { email: "a@b.com" } });
    expect(await getAdmin(client)).toEqual({ email: "a@b.com" });
  });
});

describe("requireAdmin", () => {
  it("redirects to /admin/login when not an admin", async () => {
    createAdminClient.mockResolvedValue(fakeClient({ user: null }));
    await expect(requireAdmin()).rejects.toThrow("REDIRECT:/admin/login");
  });

  it("returns the client and email for an admin", async () => {
    const client = fakeClient({ user: { email: "a@b.com" }, row: { email: "a@b.com" } });
    createAdminClient.mockResolvedValue(client);
    expect(await requireAdmin()).toEqual({ client, email: "a@b.com" });
  });
});
