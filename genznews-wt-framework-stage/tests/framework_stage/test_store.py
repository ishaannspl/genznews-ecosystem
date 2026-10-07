from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest

from framework_stage.models import ArticleStatus, JobRecord, SiteArticleRecord
from framework_stage.store import InMemoryStore, SiteStore, SupabaseStore

_: type[SiteStore] = SiteStore

NOW = datetime(2026, 10, 5, 12, 0, tzinfo=UTC)


class FakeAPIError(Exception):
    def __init__(self, message: str, code: str) -> None:
        super().__init__(message)
        self.code = code


class FakeQuery:
    def __init__(self, db: FakeSupabase, name: str) -> None:
        self.db = db
        self.name = name
        self.op = "select"
        self.payload: Any = None
        self.filters: list[tuple[str, str, Any]] = []
        self.window: tuple[int, int] | None = None
        self.order_col: str | None = None
        self.ignore_dupes = False
        self._negate = False

    @property
    def not_(self) -> FakeQuery:
        self._negate = True
        return self

    def is_(self, col: str, val: str) -> FakeQuery:
        assert val == "null"
        self.filters.append(("notnull" if self._negate else "isnull", col, None))
        self._negate = False
        return self

    def order(self, col: str) -> FakeQuery:
        self.order_col = col
        return self

    def upsert(
        self, row: dict[str, Any], on_conflict: str, ignore_duplicates: bool = False
    ) -> FakeQuery:
        assert on_conflict == "url_hash" and ignore_duplicates
        self.op, self.payload, self.ignore_dupes = "insert", row, True
        return self

    def select(self, _cols: str = "*") -> FakeQuery:
        self.op = "select"
        return self

    def insert(self, row: dict[str, Any]) -> FakeQuery:
        self.op, self.payload = "insert", row
        return self

    def update(self, values: dict[str, Any]) -> FakeQuery:
        self.op, self.payload = "update", values
        return self

    def eq(self, col: str, val: Any) -> FakeQuery:
        self.filters.append(("eq", col, val))
        return self

    def gte(self, col: str, val: Any) -> FakeQuery:
        self.filters.append(("gte", col, val))
        return self

    def gt(self, col: str, val: Any) -> FakeQuery:
        self.filters.append(("gt", col, val))
        return self

    def range(self, start: int, end: int) -> FakeQuery:
        self.window = (start, end)
        return self

    def _match(self, row: dict[str, Any]) -> bool:
        for kind, col, val in self.filters:
            cur = row.get(col)
            if kind == "eq" and cur != val:
                return False
            if kind == "gte" and not (cur is not None and cur >= val):
                return False
            if kind == "gt" and not (cur is not None and cur > val):
                return False
            if kind == "notnull" and cur is None:
                return False
            if kind == "isnull" and cur is not None:
                return False
        return True

    def execute(self) -> SimpleNamespace:
        rows = self.db.tables.setdefault(self.name, [])
        if self.op == "insert":
            assert isinstance(self.payload, dict)
            if self.name == "site_articles":
                if any(r["url_hash"] == self.payload["url_hash"] for r in rows):
                    if self.ignore_dupes:
                        return SimpleNamespace(data=[])
                    raise FakeAPIError("duplicate key url_hash", "23505")
                slug = self.payload.get("slug")
                if slug is not None and any(r.get("slug") == slug for r in rows):
                    raise FakeAPIError("duplicate key value violates slug_key", "23505")
            rows.append(dict(self.payload))
            return SimpleNamespace(data=[dict(self.payload)])
        if self.op == "update":
            hit = [r for r in rows if self._match(r)]
            for r in hit:
                r.update(self.payload)
            return SimpleNamespace(data=[dict(r) for r in hit])
        hit = [dict(r) for r in rows if self._match(r)]
        if self.order_col:
            hit.sort(key=lambda r: str(r.get(self.order_col, "")))
        if self.window:
            hit = hit[self.window[0] : self.window[1] + 1]
        return SimpleNamespace(data=hit)


class FakeSupabase:
    def __init__(self) -> None:
        self.tables: dict[str, list[dict[str, Any]]] = {}

    def table(self, name: str) -> FakeQuery:
        return FakeQuery(self, name)


@pytest.fixture(params=["memory", "supabase"])
def store(request: pytest.FixtureRequest) -> InMemoryStore | SupabaseStore:
    if request.param == "memory":
        return InMemoryStore(now=lambda: NOW)
    return SupabaseStore(FakeSupabase(), now=lambda: NOW)


def rec(url_hash: str, **kw: Any) -> SiteArticleRecord:
    return SiteArticleRecord(url_hash=url_hash, **kw)


def job(url_hash: str, started: datetime, tokens_in: int) -> JobRecord:
    return JobRecord(
        job_id=str(uuid.uuid4()),
        url_hash=url_hash,
        started_at=started.isoformat(),
        tokens_in=tokens_in,
    )


def test_insert_then_processed_hashes_contains_it(store: InMemoryStore | SupabaseStore) -> None:
    store.insert_article(rec("h1"))
    store.insert_article(rec("h2", status=ArticleStatus.FAILED))
    store.insert_article(rec("h3", status=ArticleStatus.REJECTED))
    assert store.processed_hashes() == {"h1", "h2", "h3"}


def test_insert_twice_does_not_overwrite_status_or_body(store: InMemoryStore | SupabaseStore) -> None:
    store.insert_article(
        rec("h1", status=ArticleStatus.PUBLISHED, body_md="first", slug="s-one")
    )
    store.insert_article(rec("h1", status=ArticleStatus.PROCESSING, body_md="second", slug="s-two"))
    got = store.get_article("h1")
    assert got is not None
    assert got.status == ArticleStatus.PUBLISHED
    assert got.body_md == "first"
    assert store.processed_hashes() == {"h1"}
    assert store.slug_exists("s-one")
    assert not store.slug_exists("s-two")


def test_slug_exists(store: InMemoryStore | SupabaseStore) -> None:
    assert not store.slug_exists("nope")
    store.insert_article(rec("h1", slug="hello-world"))
    assert store.slug_exists("hello-world")
    assert not store.slug_exists("hello")


def test_generations_today_counts_only_today(store: InMemoryStore | SupabaseStore) -> None:
    store.record_job(job("a", NOW - timedelta(hours=1), 100))
    store.record_job(job("b", NOW - timedelta(days=1), 100))
    store.record_job(job("c", NOW - timedelta(minutes=5), 0))
    store.record_job(job("d", NOW, 5))
    assert store.generations_today() == 2


def test_pending_regenerations_lists_processing_rows_with_forced_framework(
    store: InMemoryStore | SupabaseStore,
) -> None:
    store.insert_article(rec("p1", status=ArticleStatus.PROCESSING, regen_framework="PAS"))
    store.insert_article(rec("p2", status=ArticleStatus.PROCESSING))
    store.insert_article(rec("p3", status=ArticleStatus.PUBLISHED, regen_framework="AIDA"))
    assert store.pending_regenerations() == [("p1", "PAS")]


def test_also_reported_by_appends_without_duplicates(store: InMemoryStore | SupabaseStore) -> None:
    store.insert_article(rec("h1"))
    src = {"url": "https://a.example/x", "domain": "a.example"}
    store.add_also_reported_by("h1", src)
    store.add_also_reported_by("h1", dict(src))
    store.add_also_reported_by("h1", {"url": "https://b.example/y", "domain": "b.example"})
    got = store.get_article("h1")
    assert got is not None
    assert got.also_reported_by == [
        src,
        {"url": "https://b.example/y", "domain": "b.example"},
    ]


def test_update_generated_keeps_slug_and_clears_regen(store: InMemoryStore | SupabaseStore) -> None:
    store.insert_article(
        rec("h1", slug="keep-me", status=ArticleStatus.PROCESSING, regen_framework="PAS")
    )
    store.update_generated(
        "h1", rec("h1", slug="other", title="New", body_md="new body", framework="PAS")
    )
    got = store.get_article("h1")
    assert got is not None
    assert got.slug == "keep-me"
    assert got.title == "New"
    assert got.body_md == "new body"
    assert got.status == ArticleStatus.REVIEW_REQUIRED
    assert got.regen_framework is None
    assert got.updated_at is not None
    assert store.pending_regenerations() == []


@pytest.mark.parametrize("status", [ArticleStatus.PUBLISHED, ArticleStatus.APPROVED])
def test_update_generated_ignores_non_pending_rows(
    store: InMemoryStore | SupabaseStore, status: ArticleStatus
) -> None:
    store.insert_article(rec("h1", status=status, body_md="orig", regen_framework="PAS"))
    store.update_generated("h1", rec("h1", body_md="new", status=ArticleStatus.PUBLISHED))
    got = store.get_article("h1")
    assert got is not None
    assert got.status == status
    assert got.body_md == "orig"


def test_update_generated_ignores_processing_without_regen(
    store: InMemoryStore | SupabaseStore,
) -> None:
    store.insert_article(rec("h1", body_md="orig"))
    store.update_generated("h1", rec("h1", body_md="new"))
    got = store.get_article("h1")
    assert got is not None
    assert got.body_md == "orig"
    assert got.status == ArticleStatus.PROCESSING


def test_update_generated_forces_review_required(store: InMemoryStore | SupabaseStore) -> None:
    store.insert_article(rec("h1", regen_framework="PAS", body_md="orig"))
    store.update_generated("h1", rec("h1", body_md="new", status=ArticleStatus.PUBLISHED))
    got = store.get_article("h1")
    assert got is not None
    assert got.status == ArticleStatus.REVIEW_REQUIRED
    assert got.body_md == "new"
    assert got.regen_framework is None


def test_supabase_slug_collision_raises() -> None:
    s = SupabaseStore(FakeSupabase(), now=lambda: NOW)
    s.insert_article(rec("h1", slug="same"))
    with pytest.raises(FakeAPIError):
        s.insert_article(rec("h2", slug="same"))


def test_supabase_paging_returns_every_hash_once() -> None:
    client = FakeSupabase()
    client.tables["site_articles"] = [
        {"id": f"{i:05d}", "url_hash": f"h{i}"} for i in range(2300)
    ]
    s = SupabaseStore(client, now=lambda: NOW, page_size=500)
    assert s.processed_hashes() == {f"h{i}" for i in range(2300)}


def test_recent_fingerprints_window_and_hex_simhash(store: InMemoryStore | SupabaseStore) -> None:
    store.insert_article(
        rec(
            "new",
            content_hash="c1",
            norm_title="t1",
            simhash=format(0xDEADBEEF, "x"),
            cluster_id="cl1",
            created_at=(NOW - timedelta(hours=2)).isoformat(),
        )
    )
    store.insert_article(
        rec(
            "old",
            content_hash="c2",
            norm_title="t2",
            simhash="ff",
            cluster_id="cl2",
            created_at=(NOW - timedelta(hours=100)).isoformat(),
        )
    )
    got = store.recent_fingerprints(48)
    assert [k.url_hash for k in got] == ["new"]
    assert got[0].cluster_id == "cl1"
    assert got[0].fingerprint.simhash == 0xDEADBEEF
    assert got[0].fingerprint.content_hash == "c1"


def test_supabase_store_conflict_is_silent_but_other_errors_raise() -> None:
    client = FakeSupabase()
    s = SupabaseStore(client, now=lambda: NOW)
    s.insert_article(rec("h1"))
    s.insert_article(rec("h1"))
    assert len(client.tables["site_articles"]) == 1

    class Boom(FakeQuery):
        def execute(self) -> SimpleNamespace:
            raise FakeAPIError("connection reset", "08006")

    client.table = lambda name: Boom(client, name)  # type: ignore[method-assign]
    with pytest.raises(FakeAPIError):
        s.insert_article(rec("h2"))


MIGRATION = Path(__file__).resolve().parents[2] / "web/supabase/migrations/0001_site_tables.sql"


def test_migration_job_id_columns_are_uuid() -> None:
    low = MIGRATION.read_text().lower()
    assert "job_id uuid primary key" in low  # site_jobs
    assert "job_id uuid,\n  search_tsv" in low  # site_articles


def test_migration_contains_key_objects() -> None:
    sql = MIGRATION.read_text()
    for table in ("site_articles", "site_jobs", "admin_emails"):
        assert f"create table if not exists public.{table}" in sql.lower()
        assert f"alter table public.{table} enable row level security" in sql.lower()
    low = sql.lower()
    assert "status = 'published'" in low
    assert "to anon" in low
    assert "tsvector" in low and "using gin" in low
    assert "search_tsv" in low
    assert "url_hash text not null unique" in low
    for status in (
        "PROCESSING", "REVIEW_REQUIRED", "APPROVED", "PUBLISHED",
        "REJECTED", "FAILED", "ARCHIVED",
    ):
        assert f"'{status}'" in sql
    assert "check (status in" in low
    assert "admin_emails" in low and "auth.jwt()" in low
    assert "published_at desc" in low
    assert "cluster_id" in low and "category" in low


def test_fail_regeneration_clears_regen_and_flags_row(store: InMemoryStore | SupabaseStore) -> None:
    store.insert_article(
        rec("r1", status=ArticleStatus.PROCESSING, regen_framework="PAS", body_md="old body",
            slug="keep-slug", title="Old", flags=["UNGROUNDED_NUMBER:5"])
    )
    store.fail_regeneration("r1", ["BANNED_PHRASE:delve"])
    got = store.get_article("r1")
    assert got is not None
    assert got.regen_framework is None and got.status == ArticleStatus.REVIEW_REQUIRED
    assert got.flags == ["UNGROUNDED_NUMBER:5", "REGEN_FAILED", "BANNED_PHRASE:delve"]
    assert got.body_md == "old body" and got.slug == "keep-slug" and got.title == "Old"
    assert got.updated_at == NOW.isoformat()
    assert store.pending_regenerations() == []


@pytest.mark.parametrize("status", [ArticleStatus.PUBLISHED, ArticleStatus.APPROVED])
def test_fail_regeneration_ignores_non_pending_rows(
    store: InMemoryStore | SupabaseStore, status: ArticleStatus
) -> None:
    store.insert_article(rec("r1", status=status, regen_framework="PAS", flags=["X"]))
    store.fail_regeneration("r1", ["LLM_ERROR"])
    got = store.get_article("r1")
    assert got is not None and got.status == status
    assert got.regen_framework == "PAS" and got.flags == ["X"]


def test_fail_regeneration_ignores_processing_without_regen(
    store: InMemoryStore | SupabaseStore,
) -> None:
    store.insert_article(rec("r1", status=ArticleStatus.PROCESSING))
    store.fail_regeneration("r1", ["LLM_ERROR"])
    store.fail_regeneration("missing", ["LLM_ERROR"])
    got = store.get_article("r1")
    assert got is not None and got.status == ArticleStatus.PROCESSING and got.flags == []
    assert store.get_article("missing") is None


def test_fail_regeneration_appends_flags_without_duplicates(
    store: InMemoryStore | SupabaseStore,
) -> None:
    store.insert_article(
        rec("r1", status=ArticleStatus.PROCESSING, regen_framework="PAS",
            flags=["REGEN_FAILED", "LLM_ERROR"])
    )
    store.fail_regeneration("r1", ["LLM_ERROR", "LLM_ERROR", "NEW"])
    got = store.get_article("r1")
    assert got is not None and got.flags == ["REGEN_FAILED", "LLM_ERROR", "NEW"]


def test_update_generated_fills_null_slug_cluster_and_image(
    store: InMemoryStore | SupabaseStore,
) -> None:
    store.insert_article(
        rec("f1", status=ArticleStatus.PROCESSING, regen_framework="PAS", flags=["LLM_ERROR"])
    )
    store.update_generated(
        "f1",
        rec("f1", slug="fresh-slug", cluster_id="f1", title="New", body_md="b",
            image_url="https://img.test/x.jpg", image_source="og:image"),
    )
    got = store.get_article("f1")
    assert got is not None
    assert got.slug == "fresh-slug" and got.cluster_id == "f1"
    assert got.image_url == "https://img.test/x.jpg" and got.image_source == "og:image"
    assert got.status == ArticleStatus.REVIEW_REQUIRED and got.regen_framework is None
    assert store.slug_exists("fresh-slug")


def test_update_generated_never_overwrites_non_null_slug_cluster_or_image(
    store: InMemoryStore | SupabaseStore,
) -> None:
    store.insert_article(
        rec("k1", status=ArticleStatus.PROCESSING, regen_framework="PAS", slug="live-slug",
            cluster_id="cl-orig", image_url="https://img.test/orig.jpg", image_source="og:image")
    )
    store.update_generated(
        "k1",
        rec("k1", slug="other", cluster_id="k1", title="New", image_url=None, image_source=None),
    )
    got = store.get_article("k1")
    assert got is not None and got.title == "New"
    assert got.slug == "live-slug" and got.cluster_id == "cl-orig"
    assert got.image_url == "https://img.test/orig.jpg" and got.image_source == "og:image"
    assert not store.slug_exists("other")


@pytest.mark.parametrize("status", [ArticleStatus.PUBLISHED, ArticleStatus.FAILED])
def test_update_generated_null_fill_respects_guard(
    store: InMemoryStore | SupabaseStore, status: ArticleStatus
) -> None:
    store.insert_article(rec("g1", status=status, regen_framework="PAS"))
    store.update_generated("g1", rec("g1", slug="nope", cluster_id="g1", image_url="u"))
    got = store.get_article("g1")
    assert got is not None and got.status == status
    assert got.slug is None and got.cluster_id is None and got.image_url is None
