/** Post-login redirect target. Only same-site /admin paths pass; anything else becomes /admin. */
export function safeNext(value: unknown): string {
  if (typeof value !== "string") return "/admin";
  if (!/^\/admin(?:[/?#]|$)/.test(value)) return "/admin";
  if (value.includes("//") || value.includes("\\")) return "/admin";
  return value;
}
