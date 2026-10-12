import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { categoryBySlug } from "@/lib/categories";
import { readEnv } from "@/lib/env";

/**
 * Unknown category slugs are rewritten to an unmatched path, so Next serves the
 * prerendered not-found page: HTTP 404 with the full not-found HTML. A notFound()
 * thrown while rendering the page also gives 404, but its HTML body is an empty
 * error shell until JavaScript runs (Next 16.3 behaviour, see the Task 5 report).
 * The check is a lookup in the fixed category list, with no data access.
 */
function categoryGuard(request: NextRequest) {
  const slug = request.nextUrl.pathname.split("/")[2] ?? "";
  if (!categoryBySlug(slug)) {
    return NextResponse.rewrite(new URL("/_category-not-found", request.url));
  }
  return NextResponse.next();
}

/**
 * Admin area: refreshes the Supabase session cookies (standard @supabase/ssr proxy pattern) and
 * sends signed-out visitors to /admin/login. This is an optimistic check only; every admin page
 * and action still calls requireAdmin(). Any failure to validate the user counts as signed out.
 */
async function adminGuard(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isLogin = pathname === "/admin/login";
  let response = NextResponse.next({ request });

  let signedIn = false;
  try {
    const env = readEnv();
    if (env.dataSource === "supabase") {
      const supabase = createServerClient(env.supabaseUrl, env.supabaseAnonKey, {
        cookies: {
          getAll: () => request.cookies.getAll(),
          setAll: (list, headers) => {
            for (const { name, value } of list) request.cookies.set(name, value);
            response = NextResponse.next({ request });
            for (const { name, value, options } of list) response.cookies.set(name, value, options);
            // Cache-control no-store etc., so refreshed-token responses are never cached.
            for (const [key, value] of Object.entries(headers ?? {})) response.headers.set(key, value);
          },
        },
      });
      const { data, error } = await supabase.auth.getUser();
      signedIn = !error && !!data?.user;
    }
  } catch {
    signedIn = false;
  }

  if (!signedIn && !isLogin) {
    const redirect = NextResponse.redirect(new URL("/admin/login", request.url));
    // Keep cookies set during getUser() (token refresh, clearing a dead session).
    for (const cookie of response.cookies.getAll()) redirect.cookies.set(cookie);
    for (const [key, value] of response.headers.entries()) {
      if (key === "cache-control" || key === "expires" || key === "pragma") redirect.headers.set(key, value);
    }
    return redirect;
  }
  return response;
}

function isAdminPath(pathname: string) {
  return pathname === "/admin" || pathname.startsWith("/admin/");
}

export async function proxy(request: NextRequest) {
  if (isAdminPath(request.nextUrl.pathname)) return adminGuard(request);
  return categoryGuard(request);
}

export const config = { matcher: ["/category/:slug", "/admin/:path*"] };
