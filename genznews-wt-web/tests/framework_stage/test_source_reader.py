import json
import sqlite3
from pathlib import Path

import pytest

from framework_stage.source_reader import read_by_hash, read_unprocessed, _connect

SCHEMA = """
CREATE TABLE IF NOT EXISTS articles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    url_hash TEXT NOT NULL UNIQUE,
    source_url TEXT NOT NULL,
    domain TEXT NOT NULL,
    niche TEXT,
    original_title TEXT,
    original_author TEXT,
    published_at TEXT,
    original_content TEXT,
    genz_title TEXT,
    headlines_json TEXT,
    meta_description TEXT,
    slug TEXT,
    genz_tags_json TEXT,
    hook TEXT,
    tldr_json TEXT,
    breakdown TEXT,
    why_it_matters TEXT,
    source_attribution TEXT,
    genz_content TEXT,
    status TEXT DEFAULT 'done',
    created_at TEXT NOT NULL
)
"""


def _make_db(tmp_path: Path, rows: list[dict]) -> Path:
    path = tmp_path / "articles.db"
    conn = sqlite3.connect(path)
    with conn:
        conn.execute(SCHEMA)
        for r in rows:
            conn.execute(
                "INSERT INTO articles (url_hash, source_url, domain, original_title,"
                " original_content, tldr_json, created_at) VALUES (?,?,?,?,?,?,?)",
                (
                    r["h"],
                    f"https://x.test/{r['h']}",
                    "x.test",
                    f"T {r['h']}",
                    r.get("content", "body"),
                    r.get("tldr"),
                    r["created"],
                ),
            )
    conn.close()
    return path


def test_returns_only_unprocessed_newest_first(tmp_path):
    db = _make_db(
        tmp_path,
        [
            {"h": "a", "created": "2026-01-01"},
            {"h": "b", "created": "2026-01-03"},
            {"h": "c", "created": "2026-01-02"},
        ],
    )
    out = read_unprocessed(db, {"a"}, 10)
    assert [a.url_hash for a in out] == ["b", "c"]


def test_since_skips_stale_sources_but_keeps_undated(tmp_path):
    from datetime import UTC, datetime

    db = _make_db(
        tmp_path,
        [{"h": "old", "created": "2026-10-06"}, {"h": "new", "created": "2026-10-05"}, {"h": "none", "created": "2026-10-04"}],
    )
    conn = sqlite3.connect(db)
    with conn:
        conn.execute("UPDATE articles SET published_at='2009-08-18' WHERE url_hash='old'")
        conn.execute("UPDATE articles SET published_at='2026-10-05' WHERE url_hash='new'")
    conn.close()
    out = read_unprocessed(db, set(), 10, since=datetime(2026, 10, 1, tzinfo=UTC))
    assert [a.url_hash for a in out] == ["new", "none"]


def test_limit_is_respected(tmp_path):
    db = _make_db(
        tmp_path, [{"h": str(i), "created": f"2026-01-0{i}"} for i in range(1, 6)]
    )
    assert len(read_unprocessed(db, set(), 2)) == 2


def test_tldr_json_is_decoded_to_list(tmp_path):
    db = _make_db(
        tmp_path,
        [
            {"h": "a", "created": "2026-01-01", "tldr": json.dumps(["x", "y"])},
            {"h": "b", "created": "2026-01-02", "content": None},
        ],
    )
    a = read_by_hash(db, "a")
    assert a is not None and a.tldr == ["x", "y"]
    b = read_by_hash(db, "b")
    assert b is not None and b.tldr == [] and b.original_content == ""
    assert read_by_hash(db, "nope") is None


def test_missing_db_file_raises_FileNotFoundError_and_does_not_create_it(tmp_path):
    missing = tmp_path / "nope.db"
    with pytest.raises(FileNotFoundError):
        read_unprocessed(missing, set(), 5)
    with pytest.raises(FileNotFoundError):
        read_by_hash(missing, "a")
    assert not missing.exists()


def test_connection_is_read_only(tmp_path):
    db = _make_db(tmp_path, [{"h": "a", "created": "2026-01-01"}])
    conn = _connect(db)
    try:
        with pytest.raises(sqlite3.OperationalError):
            conn.execute(
                "INSERT INTO articles (url_hash, source_url, domain, created_at)"
                " VALUES ('z','u','d','t')"
            )
    finally:
        conn.close()
