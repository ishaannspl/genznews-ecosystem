import Link from "next/link";
import { categoryByNicheKey } from "@/lib/categories";
import { formatRelative } from "@/lib/format";
import type { QueueRow } from "@/lib/admin/queue";
import { ApproveButton } from "./ApproveButton";

const CAN_APPROVE = ["REVIEW_REQUIRED", "APPROVED"];

function percent(n: number | null): string {
  return n === null ? "n/a" : `${Math.round(n * 100)}%`;
}

export function QueueTable({ rows, now }: { rows: QueueRow[]; now?: Date }) {
  if (rows.length === 0) {
    return <p className="py-6">No stories in this queue.</p>;
  }
  return (
    <ul className="divide-y divide-rule">
      {rows.map((r) => {
        const title = r.title ?? "Untitled";
        const when = r.publishedAt ?? r.createdAt;
        return (
          <li key={r.id} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 py-4">
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
  );
}
