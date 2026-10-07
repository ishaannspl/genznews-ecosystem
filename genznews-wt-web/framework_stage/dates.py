"""Parse the loosely formatted publish dates scraped from news sites."""

from __future__ import annotations

from datetime import UTC, datetime
from email.utils import parsedate_to_datetime


def parse_source_date(value: str | None, now: datetime) -> str | None:
    """ISO-8601 UTC string for a scraped date, or None. Dates in the future are clamped to `now`."""
    text = (value or "").strip()
    if not text:
        return None
    parsed: datetime | None = None
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        try:
            parsed = parsedate_to_datetime(text)
        except (TypeError, ValueError):
            return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=UTC)
    return min(parsed.astimezone(UTC), now).isoformat()
