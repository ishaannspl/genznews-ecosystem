"""Auto-publish: move APPROVED stories to PUBLISHED so the site shows them.

Only rows the runner already approved (auto-publish enabled, niche allowed, high confidence,
low fact risk) are touched. `published_at` keeps the story's own date, so the site sorts by it.

    python -m framework_stage.publish
"""

from __future__ import annotations

import os
import sys
from datetime import UTC, datetime
from typing import Any

from dotenv import load_dotenv

load_dotenv()


def publish_by_status(client: Any, now: datetime, status: str) -> int:
    rows = client.table("site_articles").select("id,published_at,created_at").eq("status", status).execute().data or []
    for row in rows:
        client.table("site_articles").update(
            {
                "status": "PUBLISHED",
                "published_at": row.get("published_at") or row.get("created_at") or now.isoformat(),
                "reviewed_by": "auto-publish",
                "reviewed_at": now.isoformat(),
            }
        ).eq("id", row["id"]).execute()
    return len(rows)


def publish_approved(client: Any, now: datetime) -> int:
    return publish_by_status(client, now, "APPROVED")


def main() -> int:
    url = os.getenv("SUPABASE_URL", "").strip()
    key = os.getenv("SUPABASE_SERVICE_KEY", "").strip()
    if not url or not key:
        print("SUPABASE_URL and SUPABASE_SERVICE_KEY are required", file=sys.stderr)
        return 2
    import supabase

    client = supabase.create_client(url, key)
    now = datetime.now(UTC)
    count = publish_approved(client, now)
    if os.getenv("AUTO_PUBLISH_ALL", "true").lower() in ("1", "true", "yes", "on"):
        count += publish_by_status(client, now, "REVIEW_REQUIRED")
    print(f"published {count} story(ies)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
