import type { Metadata } from "next";
import Link from "next/link";
import { ThreeLineRead } from "@/components/ThreeLineRead";
import { listMetadata } from "@/lib/seo";

export const revalidate = 300;

export const metadata: Metadata = listMetadata({
  title: "About",
  description: "Who GenZNews is for, how stories are made, and what the three-line read is.",
  path: "/about",
});

export default function AboutPage() {
  return (
    <div className="max-w-[680px] pt-8 md:pt-12">
      <h1 className="page-title">About GenZNews</h1>

      <div className="mt-8 flex flex-col gap-5 text-lg leading-[1.7]">
        <p>
          GenZNews is for readers aged 18 to 28 in India who want the point of a story in ten seconds. We
          cover five beats: health and wellness, education and career, entertainment and pop culture, biogas
          and clean energy, and digital marketing and social media.
        </p>

        <h2 className="section-label mt-6">How stories are made</h2>
        <p>
          We read reporting from established outlets, rewrite it in plain, direct language, and review it
          before it goes live. Every story links back to the original.
        </p>

        <h2 className="section-label mt-6">The three-line read</h2>
        <p>Every story opens with three short lines. Read them and you have the point.</p>
        <ThreeLineRead
          className="my-2"
          lines={[
            "What happened, in one line.",
            "Why it matters to you.",
            "What to watch for next.",
          ]}
        />
        <p>
          Want the detail? Keep reading, or follow the link to the original report.{" "}
          <Link href="/latest" className="underline decoration-2 underline-offset-[0.2em]">
            Start with the latest stories
          </Link>
          .
        </p>

        <p className="mt-6 font-display text-[1.75rem] font-extrabold leading-tight tracking-[-0.02em]">
          Truth First. News Always.
        </p>
      </div>
    </div>
  );
}
