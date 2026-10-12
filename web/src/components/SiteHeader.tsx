import Link from "next/link";
import { CATEGORIES } from "@/lib/categories";
import { ThemeToggle } from "./ThemeToggle";

const linkClass =
  "inline-flex min-h-11 items-center font-display text-[0.9375rem] font-medium hover:underline underline-offset-4";

function NavLinks() {
  return (
    <>
      <Link href="/latest" className={linkClass}>
        Latest
      </Link>
      {CATEGORIES.map((c) => (
        <Link key={c.slug} href={`/category/${c.slug}`} className={linkClass}>
          {c.shortName}
        </Link>
      ))}
    </>
  );
}

export function SiteHeader() {
  return (
    <header className="border-b border-rule">
      <div className="mx-auto flex max-w-[1200px] flex-wrap items-center justify-between gap-x-4 px-4 py-2 md:px-6">
        <Link
          href="/"
          className="inline-flex min-h-11 items-center font-display text-[1.375rem] font-extrabold tracking-tight"
        >
          GenZNews
        </Link>

        <nav
          aria-label="Categories"
          className="hidden flex-wrap gap-x-5 gap-y-1 lg:order-none lg:flex"
        >
          <NavLinks />
        </nav>

        <div className="flex items-center gap-1">
          <Link href="/search" className={`${linkClass} px-2`}>
            Search
          </Link>
          <ThemeToggle />
        </div>

        <details className="group order-4 w-full lg:hidden">
          <summary className="flex min-h-11 cursor-pointer list-none items-center font-display text-[0.9375rem] font-semibold [&::-webkit-details-marker]:hidden">
            <span className="group-open:hidden">Open menu</span>
            <span className="hidden group-open:inline">Close menu</span>
          </summary>
          <nav aria-label="Categories" className="flex flex-col border-t border-rule py-1">
            <NavLinks />
          </nav>
        </details>
      </div>
    </header>
  );
}
