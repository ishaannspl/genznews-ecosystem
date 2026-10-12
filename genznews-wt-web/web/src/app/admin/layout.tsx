import type { Metadata } from "next";
import { logout } from "./actions/auth";
import { getAdmin } from "@/lib/admin/session";
import { createAdminClient } from "@/lib/admin/supabaseServer";

export const metadata: Metadata = {
  title: { default: "Admin", template: "%s | Admin" },
  robots: { index: false, follow: false },
};

// This layout also wraps /admin/login, so it must never call requireAdmin() (redirect loop).
async function currentAdmin(): Promise<{ email: string } | null> {
  try {
    return await getAdmin(await createAdminClient());
  } catch {
    return null;
  }
}

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const admin = await currentAdmin();
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8">
      <header className="mb-8 flex items-center justify-between gap-4">
        <span className="section-label">Admin</span>
        {admin ? (
          <form action={logout}>
            <button type="submit" className="text-link min-h-11 px-2">
              Sign out
            </button>
          </form>
        ) : null}
      </header>
      {children}
    </div>
  );
}
