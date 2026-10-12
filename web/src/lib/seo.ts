import type { Metadata } from "next";
import { parseAssembledBody } from "./articleBody";
import { categoryBySlug } from "./categories";
import { plainText } from "./plainText";
import type { Article } from "./types";
import { isHttpUrl } from "./url";

export const SITE_NAME = "GenZNews";
export const SITE_LOCALE = "en_IN";
export const DEFAULT_TITLE = "GenZNews: Truth First. News Always.";
export const DEFAULT_DESCRIPTION =
  "Short, source-grounded news in plain language: the point of the story in three lines.";

const DEFAULT_SITE_URL = "http://localhost:3000";
const DEFAULT_IMAGE = () => absoluteUrl("/opengraph-image");
const MAX_DESCRIPTION = 160;
const MAX_HEADLINE = 110;
const MAX_TITLE = 70;

/** Public site origin without a trailing slash. An unset or invalid value gives the local default. */
export function siteUrl(): string {
  const raw = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (!raw) return DEFAULT_SITE_URL;
  try {
    const u = new URL(raw);
    if (u.protocol !== "http:" && u.protocol !== "https:") return DEFAULT_SITE_URL;
    return u.origin + u.pathname.replace(/\/+$/, "");
  } catch {
    return DEFAULT_SITE_URL;
  }
}

export function absoluteUrl(path: string): string {
  return `${siteUrl()}${path.startsWith("/") ? path : `/${path}`}`;
}

/** Single-line plain text: HTML tags, markdown emphasis and links reduced to their text. */
const plain = (text: string | null | undefined): string => plainText(text ?? "");

function trimToWord(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max + 1);
  const space = cut.lastIndexOf(" ");
  return (space > 0 ? cut.slice(0, space) : text.slice(0, max)).replace(/[\s,;:.\-]+$/, "");
}

/** The SEO title (or the headline), plain and trimmed to 70 characters at a word boundary. */
function articleTitle(a: Article): string {
  return trimToWord(plain(a.seoTitle) || plain(a.title), MAX_TITLE);
}

/**
 * The description, never empty: SEO description, then summary, then the first TL;DR line,
 * then the headline. Plain and trimmed to 160 characters at a word boundary.
 */
function articleDescription(a: Article): string {
  const text =
    plain(a.seoDescription) || plain(a.summary) || plain(parseAssembledBody(a.bodyMd).tldr[0]) || plain(a.title);
  return trimToWord(text, MAX_DESCRIPTION);
}

/**
 * Titles are bare: the root layout title template appends " | GenZNews", so adding the
 * suffix here would double it.
 */
export function articleMetadata(a: Article): Metadata {
  const title = articleTitle(a);
  const description = articleDescription(a);
  const url = absoluteUrl(`/article/${a.slug}`);
  // A segment that sets openGraph/twitter images replaces the file-based default, so the
  // branded image is named explicitly when the article has none of its own.
  const images = [isHttpUrl(a.imageUrl) ? a.imageUrl : absoluteUrl("/opengraph-image")];
  return {
    title,
    description,
    alternates: { canonical: url },
    robots: { index: true, follow: true },
    openGraph: {
      type: "article",
      url,
      title,
      description,
      siteName: SITE_NAME,
      locale: SITE_LOCALE,
      publishedTime: a.publishedAt,
      section: categoryBySlug(a.category)?.name,
      tags: a.tags,
      images: images.map((u) => ({ url: u })),
    },
    twitter: { card: "summary_large_image", title, description, images },
  };
}

export function listMetadata(opts: {
  title: string;
  description: string;
  path: string;
  page?: number;
  noindex?: boolean;
}): Metadata {
  const canonical = opts.page && opts.page > 1 ? `${opts.path}?page=${opts.page}` : opts.path;
  const url = absoluteUrl(canonical);
  return {
    title: opts.title,
    description: opts.description,
    alternates: { canonical: url },
    ...(opts.noindex ? { robots: { index: false, follow: true } } : {}),
    openGraph: {
      type: "website",
      url,
      title: opts.title,
      description: opts.description,
      siteName: SITE_NAME,
      locale: SITE_LOCALE,
      images: [{ url: DEFAULT_IMAGE() }],
    },
    twitter: { card: "summary_large_image", title: opts.title, description: opts.description, images: [DEFAULT_IMAGE()] },
  };
}

export function newsArticleJsonLd(a: Article): object {
  const url = absoluteUrl(`/article/${a.slug}`);
  return {
    "@context": "https://schema.org",
    "@type": "NewsArticle",
    headline: trimToWord(plain(a.title), MAX_HEADLINE),
    description: articleDescription(a),
    datePublished: a.publishedAt,
    dateModified: a.publishedAt,
    author: { "@type": "Organization", name: "GenZNews Desk" },
    publisher: { "@type": "Organization", name: SITE_NAME, url: siteUrl() },
    mainEntityOfPage: url,
    articleSection: categoryBySlug(a.category)?.name,
    keywords: a.tags.join(","),
    inLanguage: "en-IN",
    ...(isHttpUrl(a.sourceUrl) ? { isBasedOn: a.sourceUrl } : {}),
    ...(isHttpUrl(a.imageUrl) ? { image: [a.imageUrl] } : {}),
  };
}

export function breadcrumbJsonLd(items: { name: string; path: string }[]): object {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: item.name,
      item: absoluteUrl(item.path),
    })),
  };
}

/** JSON for a `<script type="application/ld+json">`: nothing in it can close the tag or break the script. */
export function safeJsonLd(data: object): string {
  return JSON.stringify(data)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}
