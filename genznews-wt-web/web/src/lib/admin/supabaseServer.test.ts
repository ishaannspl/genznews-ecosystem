import { beforeEach, describe, expect, it, vi } from "vitest";

const { createServerClient, readEnv } = vi.hoisted(() => ({
  createServerClient: vi.fn(() => ({ fake: true })),
  readEnv: vi.fn(),
}));
const store = {
  getAll: vi.fn(() => [{ name: "a", value: "1" }]),
  set: vi.fn(),
};
vi.mock("next/headers", () => ({ cookies: vi.fn(async () => store) }));
vi.mock("@supabase/ssr", () => ({ createServerClient }));
vi.mock("../env", () => ({ readEnv }));

import { createAdminClient } from "./supabaseServer";

describe("createAdminClient", () => {
  beforeEach(() => {
    createServerClient.mockClear();
    store.set.mockReset();
  });

  it("builds a cookie-backed server client from the env values", async () => {
    readEnv.mockReturnValue({ dataSource: "supabase", supabaseUrl: "https://x.supabase.co", supabaseAnonKey: "anon" });
    const client = await createAdminClient();
    expect(client).toEqual({ fake: true });
    const [url, key, opts] = createServerClient.mock.calls[0] as unknown as [string, string, { cookies: { getAll: () => unknown; setAll: (c: unknown[]) => void } }];
    expect(url).toBe("https://x.supabase.co");
    expect(key).toBe("anon");
    expect(opts.cookies.getAll()).toEqual([{ name: "a", value: "1" }]);
  });

  it("setAll writes cookies and swallows the Server Component error", async () => {
    readEnv.mockReturnValue({ dataSource: "supabase", supabaseUrl: "https://x.supabase.co", supabaseAnonKey: "anon" });
    await createAdminClient();
    const opts = (createServerClient.mock.calls[0] as unknown as [string, string, { cookies: { setAll: (c: unknown[]) => void } }])[2];
    opts.cookies.setAll([{ name: "s", value: "v", options: { path: "/" } }]);
    expect(store.set).toHaveBeenCalledWith("s", "v", { path: "/" });
    store.set.mockImplementation(() => {
      throw new Error("Cookies can only be modified in a Server Action or Route Handler");
    });
    expect(() => opts.cookies.setAll([{ name: "s", value: "v", options: {} }])).not.toThrow();
  });

  it("throws naming DATA_SOURCE when the data source is fixtures", async () => {
    readEnv.mockReturnValue({ dataSource: "fixtures" });
    await expect(createAdminClient()).rejects.toThrow(/DATA_SOURCE/);
  });
});
