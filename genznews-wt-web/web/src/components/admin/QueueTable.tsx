"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { categoryByNicheKey } from "@/lib/categories";
import { formatRelative } from "@/lib/format";
import type { QueueRow } from "@/lib/admin/queue";
import { approveArticles, rejectArticles, type BulkResult } from "@/app/admin/actions/review";
import { ApproveButton } from "./ApproveButton";

const CAN_APPROVE = ["REVIEW_REQUIRED", "APPROVED"];

function percent(n: number | null): string {
  return n === null ? "n/a" : `${Math.round(n * 100)}%`;
}

export function QueueTable({ rows, now }: { rows: QueueRow[]; now?: Date }) {
  const router = useRouter();
  const [selected, setSelected] = useState<string[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const selectable = rows.filter((r) => CAN_APPROVE.includes(r.status)).map((r) => r.id);
  // Only ids still on this page count, so a refresh after a bulk action drops stale picks.
  const picked = selected.filter((id) => selectable.includes(id));
  const allPicked = selectable.length > 0 && picked.length === selectable.length;

  function toggle(id: string) {
    setSelected((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  }

  function run(action: (ids: string[]) => Promise<BulkResult>, verb: string) {
    setMessage(null);
    startTransition(async () => {
      const result = await action(picked);
      if (result.ok) {
        setSelected([]);
        setMessage(`${result.count} ${result.count === 1 ? "story" : "stories"} ${verb}.`);
        router.refresh();
      } else {
        setMessage(result.error);
      }
    });
  }

  if (rows.length === 0) {
    return <p className="py-6">No stories in this queue.</p>;
  }
  return (
    <>
      {selectable.length > 0 ? (
        <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-rule pb-3">
          <label className="inline-flex min-h-11 items-center gap-2">
            <input
              type="checkbox"
              checked={allPicked}
              onChange={() => setSelected(allPicked ? [] : selectable)}
            />
            Select all on this page ({selectable.length})
          </label>
          <span className="text-sm">{picked.length} selected</span>
          <button
            type="button"
            disabled={pending || picked.length === 0}
            onClick={() => run(approveArticles, "approved and published")}
            className="text-link min-h-11 px-4"
          >
            Approve selected
          </button>
          <button
            type="button"
            disabled={pending || picked.length === 0}
            onClick={() => run(rejectArticles, "rejected")}
            className="text-link min-h-11 px-4"
          >
            Reject selected
          </button>
          {message ? (
            <p role="status" className="basis-full text-sm">
              {message}
            </p>
          ) : null}
        </div>
      ) : null}
    <ul className="divide-y divide-rule">
      {rows.map((r) => {
        const title = r.title ?? "Untitled";
        const when = r.publishedAt ?? r.createdAt;
        return (
          <li key={r.id} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 py-4">
            {CAN_APPROVE.includes(r.status) ? (
              <input
                type="checkbox"
                aria-label={`Select ${title}`}
                checked={selected.includes(r.id)}
                onChange={() => toggle(r.id)}
                className="mt-4"
              />
            ) : null}
            <div className="min-w-0 flex-1">
              <h2 className="wrap-anywhere text-lg font-bold leading-snug">
                <Link href={`/admin/${r.id}`} className="inline-flex min-h-11 items-center underline">
                  {title}
                </Link>
              </h2>
              <p className="text-sm">
                <span>{r.category ? (categoryByNicheKey(r.category)?.name ?? r.category) : "No category"}</span>
                {" · "}
                <span>Confidence {percent(r.confidence)}</span>
                {" · "}
                <span>Fact risk {r.factRisk ?? "n/a"}</span>
                {" · "}
                <span>
                  {r.flags.length} {r.flags.length === 1 ? "flag" : "flags"}
                </span>
                {" · "}
                <span>{formatRelative(when, now)}</span>
              </p>
            </div>
            {CAN_APPROVE.includes(r.status) ? <ApproveButton id={r.id} title={title} /> : null}
          </li>
        );
      })}
    </ul>
    </>
  );
}
