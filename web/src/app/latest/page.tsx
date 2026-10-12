import type { Metadata } from "next";
import { ErrorState } from "@/components/ErrorState";
import { StoryFeed } from "@/components/StoryFeed";
import { PAGE_SIZE, parsePage } from "@/lib/params";
import { getRepository } from "@/lib/repositories";
import { logListDecision, logListError } from "@/lib/pageLog";
import { listMetadata } from "@/lib/seo";
import { orNullOnRepositoryError } from "@/lib/settle";

// Rendered per request (it reads searchParams): every visit queries the repository,
// so there is no ISR here and relative times are current at request time.

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  return listMetadata({
    title: "Latest stories",
    description: "The newest GenZNews stories, each with the point in three lines.",
    path: "/latest",
    page: parsePage((await searchParams).page),
  });
}

export default async function LatestPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const page = parsePage(params.page);
  // A RepositoryError renders ErrorState inline with HTTP 200, so the message is in
  // the server HTML; any other error still reaches error.tsx.
  const result = await orNullOnRepositoryError(getRepository().list({ page, pageSize: PAGE_SIZE }));
  if (result) logListDecision("latest", result, page);
  else logListError("latest");
  const now = new Date();

  return (
    <div className="pt-8 md:pt-12">
      <h1 className="page-title">Latest stories</h1>
      <div className="mt-6 md:mt-8">
        {result ? (
          <StoryFeed stories={result.items} page={page} total={result.total} basePath="/latest" params={{}} now={now} />
        ) : (
          <ErrorState />
        )}
      </div>
    </div>
  );
}
