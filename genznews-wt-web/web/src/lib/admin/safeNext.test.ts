import { describe, expect, it } from "vitest";
import { safeNext } from "./safeNext";

describe("safeNext", () => {
  it.each(["//evil.com", "https://evil.com", "/other", undefined, null, 42, "/admin\\evil", "/admin//x", "/administrator"])(
    "falls back to /admin for %s",
    (v) => {
      expect(safeNext(v)).toBe("/admin");
    },
  );

  it("keeps an admin path", () => {
    expect(safeNext("/admin/abc")).toBe("/admin/abc");
    expect(safeNext("/admin")).toBe("/admin");
    expect(safeNext("/admin?x=1")).toBe("/admin?x=1");
  });
});
