from __future__ import annotations

from typing import Any

from framework_stage.backfill_images import backfill_images


class _Query:
    def __init__(self, client: _Client, op: str) -> None:
        self._client = client
        self._op = op
        self._payload: dict[str, Any] = {}
        self._id: Any = None

    def select(self, _cols: str) -> _Query:
        return self

    def is_(self, _col: str, _val: str) -> _Query:
        return self

    def update(self, payload: dict[str, Any]) -> _Query:
        self._op = "update"
        self._payload = payload
        return self

    def eq(self, _col: str, value: Any) -> _Query:
        self._id = value
        return self

    def execute(self) -> Any:
        if self._op == "update":
            self._client.updates.append((self._id, self._payload))
            return type("R", (), {"data": []})()
        return type("R", (), {"data": self._client.rows})()


class _Client:
    def __init__(self, rows: list[dict[str, Any]]) -> None:
        self.rows = rows
        self.updates: list[tuple[Any, dict[str, Any]]] = []

    def table(self, _name: str) -> _Query:
        return _Query(self, "select")


ROWS = [
    {"id": 1, "source_url": "https://a.example/1"},
    {"id": 2, "source_url": "https://b.example/2"},
]


def _fetch(url: str) -> str | None:
    return "https://img.example/a.jpg" if "a.example" in url else None


def test_updates_only_rows_with_an_image() -> None:
    client = _Client(list(ROWS))
    found = backfill_images(client, _fetch)
    assert found == {1: "https://img.example/a.jpg"}
    assert client.updates == [
        (1, {"image_url": "https://img.example/a.jpg", "image_source": "og:image"})
    ]


def test_dry_run_writes_nothing() -> None:
    client = _Client(list(ROWS))
    found = backfill_images(client, _fetch, dry_run=True)
    assert found == {1: "https://img.example/a.jpg"}
    assert client.updates == []
