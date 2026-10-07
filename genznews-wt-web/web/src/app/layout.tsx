import type { Metadata } from "next";
import { Bricolage_Grotesque, Source_Serif_4 } from "next/font/google";
import { InlineScript } from "@/components/InlineScript";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";
import { SkipLink } from "@/components/SkipLink";
import { DEFAULT_DESCRIPTION, DEFAULT_TITLE, SITE_LOCALE, SITE_NAME, siteUrl } from "@/lib/seo";
import "./globals.css";

const display = Bricolage_Grotesque({
  subsets: ["latin"],
  weight: ["500", "600", "700", "800"],
  variable: "--font-display",
  display: "swap",
});

const reading = Source_Serif_4({
  subsets: ["latin"],
  weight: ["400", "600"],
  variable: "--font-reading",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl()),
  title: { default: DEFAULT_TITLE, template: `%s | ${SITE_NAME}` },
  description: DEFAULT_DESCRIPTION,
  applicationName: SITE_NAME,
  openGraph: { siteName: SITE_NAME, locale: SITE_LOCALE, type: "website" },
  twitter: { card: "summary_large_image" },
};

// Applies a stored theme choice before first paint. With no choice, CSS follows the system setting.
const themeScript = `try{var t=localStorage.getItem("gz-theme");if(t==="light"||t==="dark"){document.documentElement.setAttribute("data-theme",t)}}catch(e){}`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${display.variable} ${reading.variable}`} suppressHydrationWarning>
      <head>
        <InlineScript html={themeScript} />
      </head>
      <body>
        <SkipLink />
        <SiteHeader />
        <main id="main" tabIndex={-1} className="mx-auto max-w-[1200px] px-4 md:px-6">
          {children}
        </main>
        <SiteFooter />
      </body>
    </html>
  );
}
