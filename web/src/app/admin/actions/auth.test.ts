import { beforeEach, describe, expect, it, vi } from "vitest";

const { redirect, createAdminClient, getAdmin } = vi.hoisted(() => ({
  redirect: vi.fn((to: string): never => {
    throw new Error(`REDIRECT:${to}`);
  }),
  createAdminClient: vi.fn(),
  getAdmin: vi.fn(),
}));
vi.mock("next/navigation", () => ({ redirect }));
vi.mock("@/lib/admin/supabaseServer", () => ({ createAdminClient }));
vi.mock("@/lib/admin/session", () => ({ getAdmin }));

import { login, logout } from "./auth";

const GENERIC = { error: "Email or password is incorrect." };

function form(values: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(values)) f.set(k, v);
  return f;
}

function client(signIn: () => Promise<unknown>) {
  return { auth: { signInWithPassword: vi.fn(signIn), signOut: vi.fn(async () => ({ error: null })) } };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("login", () => {
  it("returns the generic error on an auth error without leaking the password or message", async () => {
    const c = client(async () => ({ data: {}, error: { message: "Invalid login credentials for hunter2" } }));
    createAdminClient.mockResolvedValue(c);
    const res = await login({}, form({ email: "a@b.com", password: "hunter2" }));
    expect(res).toEqual(GENERIC);
    expect(JSON.stringify(res)).not.toMatch(/hunter2|Invalid login/);
  });

  it("returns the generic error when signInWithPassword rejects, and logs nothing sensitive", async () => {
    const spies = [vi.spyOn(console, "error"), vi.spyOn(console, "log"), vi.spyOn(console, "warn")].map((s) =>
      s.mockImplementation(() => {}),
    );
    createAdminClient.mockResolvedValue(client(async () => Promise.reject(new Error("boom hunter2"))));
    const res = await login({}, form({ email: "a@b.com", password: "hunter2" }));
    expect(res).toEqual(GENERIC);
    for (const s of spies) expect(s).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it("returns the generic error when the client cannot be created", async () => {
    createAdminClient.mockRejectedValue(new Error("no env"));
    expect(await login({}, form({ email: "a@b.com", password: "x" }))).toEqual(GENERIC);
  });

  it("signs out and returns the generic error for a valid user who is not allowlisted", async () => {
    const c = client(async () => ({ data: { user: {} }, error: null }));
    createAdminClient.mockResolvedValue(c);
    getAdmin.mockResolvedValue(null);
    expect(await login({}, form({ email: "a@b.com", password: "x" }))).toEqual(GENERIC);
    expect(c.auth.signOut).toHaveBeenCalledTimes(1);
  });

  it("redirects to a safe next on success", async () => {
    createAdminClient.mockResolvedValue(client(async () => ({ data: {}, error: null })));
    getAdmin.mockResolvedValue({ email: "a@b.com" });
    await expect(login({}, form({ email: "a@b.com", password: "x", next: "/admin/abc" }))).rejects.toThrow("REDIRECT:/admin/abc");
  });

  it("ignores an unsafe next on success", async () => {
    createAdminClient.mockResolvedValue(client(async () => ({ data: {}, error: null })));
    getAdmin.mockResolvedValue({ email: "a@b.com" });
    await expect(login({}, form({ email: "a@b.com", password: "x", next: "//evil.com" }))).rejects.toThrow("REDIRECT:/admin");
  });
});

describe("logout", () => {
  it("signs out then redirects to the login page", async () => {
    const c = client(async () => ({}));
    createAdminClient.mockResolvedValue(c);
    await expect(logout()).rejects.toThrow("REDIRECT:/admin/login");
    expect(c.auth.signOut).toHaveBeenCalledTimes(1);
  });
});
