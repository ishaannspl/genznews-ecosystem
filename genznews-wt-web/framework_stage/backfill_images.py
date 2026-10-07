"""One-off backfill of `site_articles.image_url` for rows that have none.

Legacy-imported articles were stored without an image. This fetches each source page's
og:image (SSRF-safe, see `images.py`) and fills only rows where `image_url` is null.

    python -m framework_stage.backfill_images [--dry-run]
"""

from __future__ import annotations

import argparse
import os
import sys
from collections.abc import Callable
from typing import Any

from framework_stage.images import fetch_og_image


def backfill_images(
    client: Any,
    fetch: Callable[[str], str | None],
    *,
    dry_run: bool = False,
) -> dict[int, str]:
    """Return {row id: image url} for rows that got an image; write them unless dry_run."""
    rows = (
        client.table("site_articles").select("id,source_url").is_("image_url", "null").execute().data
        or []
    )
    found: dict[int, str] = {}
    for row in rows:
        image_url = fetch(row["source_url"])
        if not image_url:
            continue
        found[row["id"]] = image_url
        if not dry_run:
            client.table("site_articles").update(
                {"image_url": image_url, "image_source": "og:image"}
            ).eq("id", row["id"]).execute()
    return found


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true", help="print changes, write nothing")
    args = parser.parse_args(argv)

    url = os.getenv("SUPABASE_URL", "").strip()
    key = os.getenv("SUPABASE_SERVICE_KEY", "").strip()
    if not url or not key:
        print("SUPABASE_URL and SUPABASE_SERVICE_KEY are required", file=sys.stderr)
        return 2

    import supabase

    client = supabase.create_client(url, key)
    found = backfill_images(client, fetch_og_image, dry_run=args.dry_run)
    for row_id, image_url in found.items():
        print(f"{row_id}\t{image_url}")
    print(f"{'would update' if args.dry_run else 'updated'} {len(found)} row(s)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
