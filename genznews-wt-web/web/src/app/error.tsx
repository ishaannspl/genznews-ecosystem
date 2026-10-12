"use client";

import { ErrorState } from "@/components/ErrorState";

export default function Error({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <div className="pt-8 md:pt-12">
      <ErrorState />
      <button
        type="button"
        onClick={() => retry()}
        className="mt-2 h-12 bg-ink px-5 font-display text-base font-bold text-paper hover:opacity-90"
      >
        Try again
      </button>
    </div>
  );
}
