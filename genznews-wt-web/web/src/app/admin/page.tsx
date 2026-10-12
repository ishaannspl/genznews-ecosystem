import type { Metadata } from "next";
import Link from "next/link";
import { requireAdmin } from "@/lib/admin/session";
import { listQueue, parseQueueStatus, statusCounts, type QueueStatus } from "@/lib/admin/queue";
import { QueueTable } from "@/components/admin/QueueTable";
import { ErrorState } from "@/components/ErrorState";
import { Pagination } from "@/components/Pagination";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Queue" };

const PAGE_SIZE = 20;
const TABS: { status: QueueStatus; label: string }[] = [
  { status: "REVIEW_REQUIRED", label: "Needs review" },
  { status: "APPROVED", label: "Approved" },
  { status: "PUBLISHED", label: "Published" },
  { status: "REJECTED", label: "Rejected" },
  { status: "FAILED", label: "Failed" },
];

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

function parsePage(v: string | undefined): number {
  const n = v !== undefined && /^\d{1,6}$/.test(v) ? Number(v) : 1;
  return n >= 1 ? n : 1;
}

export default async function AdminQueuePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { client } = await requireAdmin();
  const params = await searchParams;
  const status = parseQueueStatus(first(params.status));
  const page = parsePage(first(params.page));
  let data;
  try {
    data = await Promise.all([listQueue(client, status, page, PAGE_SIZE), statusCounts(client)]);
  } catch {
    return (
      <section>
        <h1 className="section-label mb-4">Story queue</h1>
        <ErrorState title="Could not load the queue. Refresh the page, or try again in a minute." />
      </section>
    );
  }
  const [{ rows, total }, counts] = data;

  return (
    <section>
      <h1 className="section-label mb-4">Story queue</h1>
      <nav aria-label="Queue status" className="mb-4 flex flex-wrap gap-x-4">
        {TABS.map((t) => (
          <Link
            key={t.status}
            href={`/admin?status=${t.status}`}
            aria-current={t.status === status ? "page" : undefined}
            className={`inline-flex min-h-11 items-center ${t.status === status ? "font-bold underline" : ""}`}
          >
            {t.label} ({counts[t.status]})
          </Link>
        ))}
      </nav>
      <QueueTable rows={rows} />
      <Pagination page={page} total={total} pageSize={PAGE_SIZE} basePath="/admin" params={{ status }} />
    </section>
  );
}
