"use client";

import { useState } from "react";
import {
  approveArticle,
  rejectArticle,
  saveBody,
} from "@/app/admin/actions/review";
import { useReviewAction } from "./useReviewAction";

const button = "text-link min-h-11 px-4";

function ErrorText({ error }: { error: string | null }) {
  return error ? (
    <p role="alert" className="text-sm">
      {error}
    </p>
  ) : null;
}

export function ReviewActions({
  id,
  bodyMd,
  canReview,
}: {
  id: string;
  bodyMd: string;
  canReview: boolean;
}) {
  const [savedBody, setSavedBody] = useState(bodyMd);
  const save = useReviewAction(async (fd) => {
    const result = await saveBody(id, fd);
    if (result.ok) setSavedBody(String(fd.get("body_md") ?? ""));
    return result;
  });
  const approve = useReviewAction(() => approveArticle(id));
  const reject = useReviewAction(() => rejectArticle(id));
  const [body, setBody] = useState(bodyMd);
  // The save result the admin last edited after; "Saved" shows only for a newer, unedited result.
  const [editedAfter, setEditedAfter] = useState<unknown>(null);
  // Approve and Reject only act on the stored body, never on unsaved text.
  const dirty = body !== savedBody;
  const busy = save.pending || approve.pending || reject.pending;
  const showSaved = save.succeeded && editedAfter !== save.result;

  return (
    <div className="flex flex-col gap-6">
      <form action={save.formAction} className="flex flex-col gap-3">
        <label htmlFor="body_md" className="section-label">
          Story body
        </label>
        <textarea
          id="body_md"
          name="body_md"
          value={body}
          onChange={(e) => {
            setBody(e.target.value);
            setEditedAfter(save.result);
          }}
          rows={18}
          required
          className="block w-full border border-current bg-transparent px-3 py-2"
        />
        <ErrorText error={save.error} />
        {showSaved ? (
          <p role="status" className="text-sm">
            Saved
          </p>
        ) : null}
        <button
          type="submit"
          disabled={busy}
          className={`${button} self-start`}
        >
          Save edits
        </button>
      </form>
      {canReview ? (
        <div className="flex flex-wrap items-start gap-4">
          {dirty ? (
            <p id="save-first-hint" className="basis-full text-sm">
              Save your edits first
            </p>
          ) : null}
          <form action={approve.formAction}>
            <button type="submit" disabled={busy || dirty} className={button}>
              Approve and publish
            </button>
            <ErrorText error={approve.error} />
          </form>
          <form action={reject.formAction}>
            <button type="submit" disabled={busy || dirty} className={button}>
              Reject
            </button>
            <ErrorText error={reject.error} />
          </form>
        </div>
      ) : null}
    </div>
  );
}
