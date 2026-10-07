import type { Metadata } from "next";
import { safeNext } from "@/lib/admin/safeNext";
import { LoginForm } from "./LoginForm";

export const metadata: Metadata = {
  title: "Sign in",
  robots: { index: false, follow: false },
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string | string[] }> }) {
  const { next } = await searchParams;
  return (
    <section>
      <h1 className="section-label mb-6">Admin sign in</h1>
      <LoginForm next={safeNext(next)} />
    </section>
  );
}
