import crypto from "node:crypto";
import { revalidatePath } from "next/cache";
import { CATEGORIES } from "@/lib/categories";

// Only POST is exported, so Next answers every other method with 405.

const MAX_PATHS = 20;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const STATIC_PATHS = new Set(["/", "/latest", "/about", "/sitemap.xml"]);
const CATEGORY_PATHS = new Set(CATEGORIES.map((c) => `/category/${c.slug}`));

const json = (body: object, status: number) => Response.json(body, { status });
const unauthorized = () => json({ error: "unauthorized" }, 401);
const badRequest = () => json({ error: "bad request" }, 400);

const sha256 = (value: string) => crypto.createHash("sha256").update(value).digest();

/** Both sides are hashed first, so the buffers always have equal length. */
function secretMatches(provided: string, expected: string): boolean {
  return crypto.timingSafeEqual(sha256(provided), sha256(expected));
}

function isAllowedPath(path: string): boolean {
  if (STATIC_PATHS.has(path) || CATEGORY_PATHS.has(path)) return true;
  if (!path.startsWith("/article/")) return false;
  const slug = path.slice("/article/".length);
  return slug.length <= 200 && SLUG.test(slug);
}

export async function POST(request: Request): Promise<Response> {
  const expected = process.env.REVALIDATE_SECRET ?? "";
  const provided = request.headers.get("x-revalidate-secret") ?? "";
  // The comparison always runs, and an unset secret fails like a wrong one.
  const ok = secretMatches(provided, expected);
  if (!expected || !ok) return unauthorized();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return badRequest();
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) return badRequest();
  const { slug, paths } = body as { slug?: unknown; paths?: unknown };

  const targets: string[] = [];
  if (slug !== undefined) {
    if (typeof slug !== "string") return badRequest();
    targets.push(`/article/${slug}`, "/", "/latest");
  }
  if (paths !== undefined) {
    if (!Array.isArray(paths) || paths.some((p) => typeof p !== "string")) return badRequest();
    targets.push(...(paths as string[]));
  }

  const unique = [...new Set(targets)];
  if (unique.length === 0 || unique.length > MAX_PATHS || !unique.every(isAllowedPath)) return badRequest();

  for (const path of unique) revalidatePath(path);
  return json({ revalidated: unique }, 200);
}
