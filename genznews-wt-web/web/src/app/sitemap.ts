import type { MetadataRoute } from "next";
import { CATEGORIES } from "@/lib/categories";
import { getRepository } from "@/lib/repositories";
import { RepositoryError } from "@/lib/repository";
import { absoluteUrl } from "@/lib/seo";

export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const statics: MetadataRoute.Sitemap = [
    { url: absoluteUrl("/"), changeFrequency: "hourly", priority: 1 },
    { url: absoluteUrl("/latest"), changeFrequency: "hourly", priority: 0.8 },
    { url: absoluteUrl("/about"), changeFrequency: "yearly", priority: 0.3 },
    ...CATEGORIES.map((c) => ({
      url: absoluteUrl(`/category/${c.slug}`),
      changeFrequency: "daily" as const,
      priority: 0.7,
    })),
  ];

  try {
    // The Supabase query returns at most the API's max rows (default 1000) until allSlugs is paginated.
    const slugs = await getRepository().allSlugs();
    const articles = slugs.map(({ slug, publishedAt }) => ({
      url: absoluteUrl(`/article/${slug}`),
      lastModified: new Date(publishedAt),
      changeFrequency: "weekly" as const,
      priority: 0.6,
    }));
    return [...statics, ...articles];
  } catch (error) {
    if (!(error instanceof RepositoryError)) throw error;
    // A data outage must not fail the build or the request: list the static routes only.
    return statics;
  }
}
