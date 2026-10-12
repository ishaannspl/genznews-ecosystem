import { beforeEach, describe, expect, it, vi } from "vitest";

const { getUser, createServerClient, readEnv } = vi.hoisted(() => ({
  getUser: vi.fn(),
  createServerClient: vi.fn(),
  readEnv: vi.fn(),
}));
vi.mock("@supabase/ssr", () => ({ createServerClient }));
vi.mock("@/lib/env", () => ({ readEnv }));

import { NextRequest } from "next/server";
import { config, proxy } from "./proxy";

const req = (path: string) => new NextRequest(`http://localhost:3000${path}`);

describe("proxy admin guard", () => {
  beforeEach(() => {
    getUser.mockReset();
    createServerClient.mockReset();
    createServerClient.mockImplementation(() => ({ auth: { getUser } }));
    readEnv.mockReturnValue({ dataSource: "supabase", supabaseUrl: "https://x.supabase.co", supabaseAnonKey: "anon" });
  });

  it("matches the admin area", () => {
    expect(config.matcher).toContain("/admin/:path*");
  });

  it("redirects an unauthenticated /admin to /admin/login", async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null });
    const res = await proxy(req("/admin"));
    expect(res.status).toBe(307);
    expect(new URL(res.headers.get("location")!).pathname).toBe("/admin/login");
  });

  it("redirects to login when the auth server is unreachable", async () => {
    getUser.mockRejectedValue(new Error("fetch failed"));
    const res = await proxy(req("/admin/stories"));
    expect(new URL(res.headers.get("location")!).pathname).toBe("/admin/login");
  });

  it("lets /admin/login through when signed out", async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null });
    const res = await proxy(req("/admin/login"));
    expect(res.headers.get("location")).toBeNull();
    expect(res.status).toBe(200);
  });

  it("carries cookies set during getUser onto the login redirect", async () => {
    createServerClient.mockImplementation((_u: string, _k: string, opts: { cookies: { setAll: (l: unknown[], h?: Record<string, string>) => void } }) => ({
      auth: {
        getUser: async () => {
          opts.cookies.setAll([{ name: "sb-token", value: "", options: { maxAge: 0 } }], { "cache-control": "no-store" });
          return { data: { user: null }, error: null };
        },
      },
    }));
    const res = await proxy(req("/admin"));
    expect(new URL(res.headers.get("location")!).pathname).toBe("/admin/login");
    expect(res.cookies.get("sb-token")).toBeDefined();
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("does not treat /administrator as an admin path", async () => {
    const res = await proxy(req("/administrator"));
    expect(createServerClient).not.toHaveBeenCalled();
    expect(new URL(res.headers.get("location") ?? "http://x/", "http://x").pathname).not.toBe("/admin/login");
  });

  it("lets a signed-in user through", async () => {
    getUser.mockResolvedValue({ data: { user: { email: "a@b.com" } }, error: null });
    const res = await proxy(req("/admin"));
    expect(res.headers.get("location")).toBeNull();
  });
});

describe("proxy category route (unchanged)", () => {
  it("rewrites unknown category slugs", async () => {
    const res = await proxy(req("/category/not-a-real-slug"));
    expect(res.headers.get("x-middleware-rewrite")).toContain("/_category-not-found");
  });
});
