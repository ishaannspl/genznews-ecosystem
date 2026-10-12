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


def publish_approved(client: Any, now: datetime) -> int:
    rows = client.table("site_articles").select("id,published_at,created_at").eq("status", "APPROVED").execute().data or []
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


def main() -> int:
    url = os.getenv("SUPABASE_URL", "").strip()
    key = os.getenv("SUPABASE_SERVICE_KEY", "").strip()
    if not url or not key:
        print("SUPABASE_URL and SUPABASE_SERVICE_KEY are required", file=sys.stderr)
        return 2
    import supabase

    count = publish_approved(supabase.create_client(url, key), datetime.now(UTC))
    print(f"published {count} approved story(ies)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
