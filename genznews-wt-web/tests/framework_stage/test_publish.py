from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from framework_stage.dates import parse_source_date
from framework_stage.publish import publish_approved

NOW = datetime(2026, 10, 6, 12, 0, tzinfo=UTC)


def test_parse_source_date_formats():
    assert parse_source_date("2026-10-05", NOW) == "2026-10-05T00:00:00+00:00"
    assert parse_source_date("2026-10-05T11:15:24+05:30", NOW) == "2026-10-05T05:45:24+00:00"
    assert parse_source_date("Tue, 06 Oct 2026 10:00:00 +0530", NOW) == "2026-10-06T04:30:00+00:00"


def test_parse_source_date_rejects_garbage_and_clamps_future():
    assert parse_source_date(None, NOW) is None
    assert parse_source_date("not a date", NOW) is None
    assert parse_source_date("2030-01-01", NOW) == NOW.isoformat()


class _Query:
    def __init__(self, client: _Client) -> None:
        self.c = client
        self.op = "select"
        self.payload: dict[str, Any] = {}
        self.target: Any = None

    def select(self, _cols: str) -> _Query:
        return self

    def update(self, payload: dict[str, Any]) -> _Query:
        self.op, self.payload = "update", payload
        return self

    def eq(self, col: str, value: Any) -> _Query:
        if self.op == "select":
            self.c.filters.append((col, value))
        else:
            self.target = value
        return self

    def execute(self) -> Any:
        if self.op == "update":
            self.c.updates.append((self.target, self.payload))
            return type("R", (), {"data": []})()
        return type("R", (), {"data": self.c.rows})()


class _Client:
    def __init__(self, rows: list[dict[str, Any]]) -> None:
        self.rows = rows
        self.filters: list[tuple[str, Any]] = []
        self.updates: list[tuple[Any, dict[str, Any]]] = []

    def table(self, _name: str) -> _Query:
        return _Query(self)


def test_publish_approved_uses_source_date_and_falls_back_to_created():
    client = _Client(
        [
            {"id": "a", "published_at": "2026-10-05T01:00:00+00:00", "created_at": "2026-10-06T00:00:00+00:00"},
            {"id": "b", "published_at": None, "created_at": "2026-10-06T02:00:00+00:00"},
        ]
    )
    assert publish_approved(client, NOW) == 2
    assert client.filters == [("status", "APPROVED")]
    assert client.updates[0][0] == "a" and client.updates[0][1]["published_at"] == "2026-10-05T01:00:00+00:00"
    assert client.updates[1][1]["published_at"] == "2026-10-06T02:00:00+00:00"
    assert all(u[1]["status"] == "PUBLISHED" and u[1]["reviewed_by"] == "auto-publish" for u in client.updates)
