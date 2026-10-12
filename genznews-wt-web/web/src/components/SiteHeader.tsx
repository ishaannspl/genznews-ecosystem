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

const iconBtn =
  "inline-flex size-11 items-center justify-center hover:bg-rule/40 focus-visible:outline-2";

export function SiteHeader() {
  return (
    <header className="relative border-t-[3px] border-ink bg-paper shadow-[0_2px_8px_rgba(0,0,0,0.12)]">
      <div className="relative mx-auto flex h-[4.5rem] max-w-[1200px] items-center justify-between px-4 md:px-6">
        <div className="flex items-center gap-2">
          <details className="group">
            <summary
              aria-label="Menu"
              className={`${iconBtn} cursor-pointer list-none [&::-webkit-details-marker]:hidden`}
            >
              <svg width="26" height="20" viewBox="0 0 26 20" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M0 2h26M0 10h26M0 18h26" />
              </svg>
            </summary>
            <nav
              aria-label="Categories"
              className="absolute inset-x-0 top-full z-20 flex flex-col border-t border-rule bg-paper px-4 py-2 shadow-[0_8px_16px_rgba(0,0,0,0.12)] md:px-6"
            >
              <NavLinks />
            </nav>
          </details>
          <Link href="/search" aria-label="Search" className={iconBtn}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <circle cx="10.5" cy="10.5" r="6.5" />
              <path d="M15.5 15.5 21 21" />
            </svg>
          </Link>
        </div>

        <Link
          href="/"
          className="absolute left-1/2 inline-flex -translate-x-1/2 items-center font-display text-[1.375rem] font-extrabold uppercase leading-none tracking-tight md:text-[1.75rem]"
        >
          AajKiJanta
        </Link>

        <ThemeToggle />
      </div>
    </header>
  );
}
