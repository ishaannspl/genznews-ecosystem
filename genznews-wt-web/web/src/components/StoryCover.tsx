"use client";

import { useState } from "react";
import { categoryBySlug, type CategorySlug } from "@/lib/categories";
import { safeHttpUrl } from "@/lib/url";

interface Props {
  src: string | null;
  alt: string;
  category: CategorySlug;
  ratio?: "16/9" | "4/3";
  /** Lead cover: load eagerly with high fetch priority. */
  priority?: boolean;
  className?: string;
}

const RATIOS = { "16/9": "16 / 9", "4/3": "4 / 3" } as const;

/**
 * Hotlinked cover in a reserved aspect-ratio box. Falls back to a category
 * placeholder when there is no image or it fails to load.
 */
export function StoryCover({ src: rawSrc, alt, category, ratio = "16/9", priority = false, className = "" }: Props) {
  // Defence in depth: the mapper already drops unsafe URLs, but only http(s) is ever rendered here.
  const src = safeHttpUrl(rawSrc);
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const showImage = Boolean(src) && failedSrc !== src;
  const name = categoryBySlug(category)?.shortName ?? "";

  return (
    <div
      className={`cover ${className}`}
      data-category={category}
      data-ratio={ratio}
      style={{ aspectRatio: RATIOS[ratio] }}
    >
      {showImage ? (
        // eslint-disable-next-line @next/next/no-img-element -- plain hotlinks by design, no next/image optimization
        <img
          // An image that failed before hydration never fires onError; catch it on mount.
          ref={(el) => {
            if (el && el.complete && el.naturalWidth === 0) setFailedSrc(src);
          }}
          src={src!}
          alt={alt}
          loading={priority ? "eager" : "lazy"}
          fetchPriority={priority ? "high" : undefined}
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setFailedSrc(src)}
          className="absolute inset-0 h-full w-full object-cover"
        />
      ) : (
        <div className="cover-placeholder" data-placeholder aria-hidden="true">
          {/* Scale to the container so the name fills about 90% of the width. */}
          <span style={{ fontSize: `${Math.min(34, 160 / Math.max(name.length, 1))}cqi` }}>{name}</span>
        </div>
      )}
    </div>
  );
}
