import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/admin/session";
import { getForReview, UUID_RE } from "@/lib/admin/queue";
import { categoryByNicheKey, CATEGORIES } from "@/lib/categories";
import { safeHttpUrl } from "@/lib/url";
import { StoryCover } from "@/components/StoryCover";
import { FlagList } from "@/components/admin/FlagList";
import { ReviewActions } from "@/components/admin/ReviewActions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Review" };

export default async function AdminReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { client } = await requireAdmin();
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();
  const article = await getForReview(client, id);
  if (!article) notFound();

  const title = article.title ?? "Untitled";
  const category = categoryByNicheKey(article.category ?? "")?.slug ?? CATEGORIES[0].slug;
  const sourceUrl = safeHttpUrl(article.sourceUrl);
  const canReview = article.status === "REVIEW_REQUIRED" || article.status === "APPROVED";

  return (
    <article className="flex flex-col gap-6">
      <Link href="/admin" className="inline-flex min-h-11 items-center self-start underline">
        Back to queue
      </Link>
      <header>
        <p className="section-label">Status: {article.status}</p>
        <h1 className="wrap-anywhere text-2xl font-extrabold leading-tight">{title}</h1>
        {article.summary ? <p className="mt-2">{article.summary}</p> : null}
      </header>
      <StoryCover src={article.imageUrl} alt="" category={category} />
      {sourceUrl ? (
        <p>
          <a href={sourceUrl} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center underline">
            Read the source{article.sourceName ? ` at ${article.sourceName}` : ""} (opens in a new tab)
          </a>
        </p>
      ) : null}
      <FlagList flags={article.flags} />
      <ReviewActions id={article.id} bodyMd={article.bodyMd ?? ""} canReview={canReview} />
    </article>
  );
}
