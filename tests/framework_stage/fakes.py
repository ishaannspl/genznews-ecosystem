"""Test doubles for the framework stage."""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path
from typing import Any, TypeVar

from pydantic import BaseModel

from framework_stage.llm import LLMResult
from framework_stage.models import GeneratedArticle

T = TypeVar("T", bound=BaseModel)


class FakeLLM:
    def __init__(self, responses: list[object | Exception]) -> None:
        self._responses = list(responses)
        self.calls: list[dict[str, Any]] = []

    def generate_structured(
        self, *, prompt: str, schema: type[T], model: str
    ) -> LLMResult[T]:
        self.calls.append({"prompt": prompt, "schema": schema, "model": model})
        item = self._responses.pop(0)
        if isinstance(item, Exception):
            raise item
        return LLMResult(value=item, tokens_in=10, tokens_out=5)  # type: ignore[arg-type]


SOURCE_SCHEMA = """
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


def make_source_db(path: Path, rows: list[dict[str, Any]]) -> Path:
    """Build a temp `articles.db` with the pipeline's schema.

    Row keys: h (url_hash), content, title, niche, domain, tldr (list or None),
    created, attribution.
    """
    conn = sqlite3.connect(path)
    with conn:
        conn.execute(SOURCE_SCHEMA)
        for r in rows:
            domain = r.get("domain", "x.test")
            tldr = r.get("tldr", ["one", "two", "three"])
            conn.execute(
                "INSERT INTO articles (url_hash, source_url, domain, niche, original_title,"
                " original_content, tldr_json, source_attribution, created_at)"
                " VALUES (?,?,?,?,?,?,?,?,?)",
                (
                    r["h"],
                    f"https://{domain}/{r['h']}",
                    domain,
                    r.get("niche", "news"),
                    r.get("title", f"Title {r['h']}"),
                    r.get("content", "body"),
                    json.dumps(tldr) if tldr is not None else None,
                    r.get("attribution"),
                    r.get("created", "2026-10-05T00:00:00"),
                ),
            )
    conn.close()
    return path


def make_generated(**over: Any) -> GeneratedArticle:
    """A generated article that passes validation against any source text."""
    base: dict[str, Any] = dict(
        title="Local update",
        slug="local-update",
        summary="A short update.",
        body_md="The story is a short local update.",
        framework="AIDA",
        content_type="GENERAL_NEWS",
        category="news",
        tags=["update"],
        seo_title="Local update",
        seo_description="A short update.",
        keywords=["update"],
        claims=[],
    )
    base.update(over)
    return GeneratedArticle(**base)
