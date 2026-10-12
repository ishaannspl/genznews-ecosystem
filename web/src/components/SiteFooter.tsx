import Link from "next/link";

export function SiteFooter() {
  return (
    <footer className="mt-16 border-t border-rule">
      <div className="mx-auto flex max-w-[1200px] flex-col gap-1 px-4 py-6 md:px-6">
        <p className="m-0 font-display text-lg font-bold">Truth First. News Always.</p>
        <Link href="/about" className="inline-flex min-h-11 items-center self-start underline underline-offset-4">
          About GenZNews
        </Link>
      </div>
    </footer>
  );
}
