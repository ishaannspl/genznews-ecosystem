"use client";

import { approveArticle } from "@/app/admin/actions/review";
import { useReviewAction } from "./useReviewAction";

export function ApproveButton({ id, title }: { id: string; title: string }) {
  const { formAction, pending, error } = useReviewAction(() => approveArticle(id));
  return (
    <form action={formAction} className="flex flex-col items-start">
      <button type="submit" disabled={pending} aria-label={`Approve ${title}`} className="text-link min-h-11 px-4">
        Approve
      </button>
      {error ? (
        <p role="alert" className="text-sm">
          {error}
        </p>
      ) : null}
    </form>
  );
}
