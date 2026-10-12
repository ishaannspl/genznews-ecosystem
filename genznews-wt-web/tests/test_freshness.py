import time
from datetime import UTC, datetime
from types import SimpleNamespace

from app.freshness import entry_datetime, fetch_since, is_fresh

NOW = datetime(2026, 10, 6, 12, 0, tzinfo=UTC)


def _entry(date: str | None) -> SimpleNamespace:
    return SimpleNamespace(published_parsed=time.strptime(date, "%Y-%m-%d") if date else None)


def test_fetch_since_defaults_to_first_of_current_month():
    assert fetch_since({}, now=NOW) == datetime(2026, 10, 1, tzinfo=UTC)


def test_fetch_since_env_override():
    assert fetch_since({"FETCH_SINCE": "2026-09-15"}, now=NOW) == datetime(2026, 9, 15, tzinfo=UTC)


def test_fetch_since_bad_value_falls_back_to_month_start():
    assert fetch_since({"FETCH_SINCE": "nonsense"}, now=NOW) == datetime(2026, 10, 1, tzinfo=UTC)


def test_entry_datetime_reads_feed_date_and_missing_is_none():
    assert entry_datetime(_entry("2026-10-05")) == datetime(2026, 10, 5, tzinfo=UTC)
    assert entry_datetime(_entry(None)) is None


def test_is_fresh_rejects_old_and_undated():
    since = datetime(2026, 10, 1, tzinfo=UTC)
    assert is_fresh(_entry("2026-10-03"), since)
    assert not is_fresh(_entry("2009-08-18"), since)
    assert not is_fresh(_entry(None), since)
