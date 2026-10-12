"""Read-only access to the existing pipeline's SQLite `articles` table."""

from __future__ import annotations

import json
import sqlite3
from datetime import UTC, datetime
from pathlib import Path

from framework_stage.dates import parse_source_date
from framework_stage.models import SourceArticle

_COLUMNS = (
    "url_hash, source_url, domain, niche, original_title, original_author, "
    "published_at, original_content, genz_title, hook, tldr_json, source_attribution"
)


def _connect(db_path: Path) -> sqlite3.Connection:
    path = Path(db_path)
    if not path.is_file():
        raise FileNotFoundError(f"articles database not found: {path}")
    conn = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    return conn


def _decode_tldr(raw: str | None) -> list[str]:
    if not raw:
        return []
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return []
    if not isinstance(data, list):
        return []
    return [str(x) for x in data]


def _is_older(published_at: str | None, since: datetime) -> bool:
    iso = parse_source_date(published_at, datetime.now(UTC))
    return iso is not None and datetime.fromisoformat(iso) < since


def _to_article(row: sqlite3.Row) -> SourceArticle:
    return SourceArticle(
        url_hash=row["url_hash"],
        source_url=row["source_url"],
        domain=row["domain"],
        niche=row["niche"],
        original_title=row["original_title"],
        original_author=row["original_author"],
        published_at=row["published_at"],
        original_content=row["original_content"] or "",
        genz_title=row["genz_title"],
        hook=row["hook"],
        tldr=_decode_tldr(row["tldr_json"]),
        source_attribution=row["source_attribution"],
    )


def read_unprocessed(
    db_path: Path, processed_hashes: set[str], limit: int, since: datetime | None = None
) -> list[SourceArticle]:
    """Newest-first articles whose url_hash is not in `processed_hashes`.

    With `since`, sources whose own publish date is older are skipped. A source with no
    readable date is kept: the pipeline already filtered it by its feed date.
    """
    if limit <= 0:
        _connect(db_path).close()
        return []
    conn = _connect(db_path)
    try:
        cur = conn.execute(
            f"SELECT {_COLUMNS} FROM articles ORDER BY created_at DESC, id DESC"
        )
        out: list[SourceArticle] = []
        for row in cur:
            if row["url_hash"] in processed_hashes:
                continue
            if since is not None and _is_older(row["published_at"], since):
                continue
            out.append(_to_article(row))
            if len(out) >= limit:
                break
        return out
    finally:
        conn.close()


def read_by_hash(db_path: Path, url_hash: str) -> SourceArticle | None:
    conn = _connect(db_path)
    try:
        row = conn.execute(
            f"SELECT {_COLUMNS} FROM articles WHERE url_hash = ?", (url_hash,)
        ).fetchone()
        return _to_article(row) if row else None
    finally:
        conn.close()
