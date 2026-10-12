// @vitest-environment node
import { afterEach, describe, expect, test, vi } from "vitest";
import { explainDataError } from "../explainError";
import { checkConnection, createSupabaseClient, withTimeout } from "./supabaseRepository";

afterEach(() => vi.unstubAllGlobals());

/** A fetch that never answers on its own and only rejects when its signal aborts. */
const hanging = ((_input: unknown, init?: RequestInit) =>
  new Promise((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
  })) as unknown as typeof fetch;

describe("withTimeout", () => {
  test("a request that never resolves rejects with a timeout error", async () => {
    const started = Date.now();
    const err = await withTimeout(hanging, 20)("https://example-project.supabase.co/x").catch((e: unknown) => e);
    expect(Date.now() - started).toBeLessThan(1000);
    expect((err as Error).name).toBe("TimeoutError");
    expect(explainDataError(err).reason).toBe("Connection timed out");
  });

  test("a caller supplied signal still aborts the request", async () => {
    const controller = new AbortController();
    const pending = withTimeout(hanging, 5000)("https://example-project.supabase.co/x", { signal: controller.signal });
    controller.abort(new Error("caller cancelled"));
    await expect(pending).rejects.toThrow("caller cancelled");
  });

  test("a refused connection keeps its reason instead of the bare 'fetch failed'", async () => {
    const refused = (async () => {
      throw new TypeError("fetch failed", { cause: Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:9"), { code: "ECONNREFUSED" }) });
    }) as unknown as typeof fetch;
    const err = await withTimeout(refused, 20)("http://127.0.0.1:9/x").catch((e: unknown) => e);
    expect(explainDataError(err).reason).toBe("Connection refused");
  });

  test("a code inside an AggregateError cause is found too", async () => {
    const dns = (async () => {
      throw new TypeError("fetch failed", { cause: new AggregateError([Object.assign(new Error("x"), { code: "ENOTFOUND" })]) });
    }) as unknown as typeof fetch;
    const err = await withTimeout(dns, 20)("http://nope.invalid/x").catch((e: unknown) => e);
    expect(explainDataError(err).reason).toBe("Host name not found (DNS lookup failed)");
  });

  test("a fast response passes through", async () => {
    const ok = (async () => new Response("ok")) as unknown as typeof fetch;
    expect(await (await withTimeout(ok, 20)("https://example-project.supabase.co/x")).text()).toBe("ok");
  });
});

describe("createSupabaseClient", () => {
  test("the real client times out through its global fetch and the failure is explained", async () => {
    vi.stubGlobal("fetch", hanging);
    const client = createSupabaseClient("https://example-project.supabase.co", "sb_publishable_FAKEKEY123", { timeoutMs: 20 });
    const err = await checkConnection(client).catch((e: unknown) => e);
    const why = explainDataError(err);
    expect(why.reason).toBe("Connection timed out");
    expect(JSON.stringify(why)).not.toContain("FAKEKEY123");
  });
});
