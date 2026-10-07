"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import type { ActionResult } from "@/app/admin/actions/review";

const INITIAL: ActionResult = { ok: true };

/**
 * Wraps a server action that returns an ActionResult for use as a form action.
 * Refreshes the page after a successful run; failures surface as `error`.
 */
export function useReviewAction(run: (formData: FormData) => Promise<ActionResult>) {
  const router = useRouter();
  const [result, formAction, pending] = useActionState<ActionResult, FormData>((_prev, formData) => run(formData), INITIAL);

  useEffect(() => {
    if (result !== INITIAL && result.ok) router.refresh();
  }, [result, router]);

  const succeeded = result !== INITIAL && result.ok;
  return { formAction, pending, error: result.ok ? null : result.error, succeeded, result };
}
