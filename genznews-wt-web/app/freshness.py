"""Date cutoff for RSS entries: only stories published since FETCH_SINCE are fetched."""

from __future__ import annotations

import calendar
from collections.abc import Mapping
from datetime import UTC, datetime
from typing import Any


def fetch_since(environ: Mapping[str, str], now: datetime | None = None) -> datetime:
    """FETCH_SINCE (YYYY-MM-DD) if valid, otherwise the first day of the current month (UTC)."""
    raw = (environ.get("FETCH_SINCE") or "").strip()
    if raw:
        try:
            return datetime.strptime(raw, "%Y-%m-%d").replace(tzinfo=UTC)
        except ValueError:
            pass
    now = now or datetime.now(UTC)
    return now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)


def entry_datetime(entry: Any) -> datetime | None:
    """Publication time of a feedparser entry (UTC), or None when the feed gives no date."""
    parsed = getattr(entry, "published_parsed", None) or getattr(entry, "updated_parsed", None)
    if not parsed:
        return None
    return datetime.fromtimestamp(calendar.timegm(parsed), UTC)


def is_fresh(entry: Any, since: datetime) -> bool:
    """True when the entry is dated and not older than `since`. Undated entries are skipped."""
    published = entry_datetime(entry)
    return published is not None and published >= since
