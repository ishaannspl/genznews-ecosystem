import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Page not found",
  robots: { index: false, follow: false },
};

export default function NotFound() {
  return (
    <div className="max-w-[680px] pt-8 md:pt-12">
      <h1 className="page-title">We can&apos;t find that page</h1>
      <p className="mt-5 text-lg">
        The link may be old or mistyped. Head to the home page, or catch up on the latest stories.
      </p>
      <div className="mt-4 flex flex-wrap gap-x-8">
        <Link href="/" className="text-link text-base">
          Go to the home page
        </Link>
        <Link href="/latest" className="text-link text-base">
          Read the latest stories
        </Link>
      </div>
    </div>
  );
}
