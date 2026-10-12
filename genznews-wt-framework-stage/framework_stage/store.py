"""Persistence for the framework stage: Protocol, in-memory and Supabase stores."""

from __future__ import annotations

from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from typing import Any, Protocol

from framework_stage.models import (
    ArticleStatus,
    Fingerprint,
    JobRecord,
    KnownArticle,
    SiteArticleRecord,
)

# Fields replaced by update_generated (regeneration path). The slug is kept.
GENERATED_FIELDS: tuple[str, ...] = (
    "title",
    "summary",
    "body_md",
    "generated_body_md",
    "framework",
    "content_type",
    "tags",
    "seo_title",
    "seo_description",
    "keywords",
    "confidence",
    "fact_risk",
    "flags",
    "content_hash",
    "norm_title",
    "simhash",
)

# Filled by update_generated only when the stored value is null, never overwritten:
# a regenerated FAILED/ARCHIVED row gets a slug and cluster, a live row keeps its own.
# Each group is keyed by the column whose null-ness decides the fill.
NULL_FILL_FIELDS: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("slug", ("slug",)),
    ("cluster_id", ("cluster_id",)),
    ("image_url", ("image_url", "image_source")),
)

_PAGE = 1000


class SiteStore(Protocol):
    def processed_hashes(self) -> set[str]: ...

    def recent_fingerprints(self, hours: int) -> list[KnownArticle]: ...

    def slug_exists(self, slug: str) -> bool: ...

    def generations_today(self) -> int: ...

    def pending_regenerations(self) -> list[tuple[str, str]]: ...

    def insert_article(self, record: SiteArticleRecord) -> None: ...

    def update_generated(self, url_hash: str, record: SiteArticleRecord) -> None: ...

    def add_also_reported_by(self, primary_url_hash: str, source: dict[str, str]) -> None: ...

    def fail_regeneration(self, url_hash: str, flags: list[str]) -> None: ...

    def record_job(self, job: JobRecord) -> None: ...


def _utc_now() -> datetime:
    return datetime.now(UTC)


def _parse(ts: str) -> datetime:
    dt = datetime.fromisoformat(ts.replace("Z", "+00:00"))
    return dt if dt.tzinfo else dt.replace(tzinfo=UTC)


def _day_start(now: datetime) -> datetime:
    n = now.astimezone(UTC)
    return n.replace(hour=0, minute=0, second=0, microsecond=0)


def _merge_flags(existing: list[str], flags: list[str]) -> list[str]:
    return list(dict.fromkeys([*existing, "REGEN_FAILED", *flags]))


def _known(row: SiteArticleRecord | dict[str, Any]) -> KnownArticle | None:
    data = row if isinstance(row, dict) else row.model_dump()
    simhash = data.get("simhash")
    if simhash is None or data.get("cluster_id") is None:
        return None
    return KnownArticle(
        url_hash=data["url_hash"],
        cluster_id=data["cluster_id"],
        fingerprint=Fingerprint(
            content_hash=data.get("content_hash") or "",
            norm_title=data.get("norm_title") or "",
            simhash=int(simhash, 16),
        ),
    )


class InMemoryStore:
    def __init__(self, now: Callable[[], datetime] = _utc_now) -> None:
        self._now = now
        self._articles: dict[str, SiteArticleRecord] = {}
        self._jobs: list[JobRecord] = []

    def get_article(self, url_hash: str) -> SiteArticleRecord | None:
        row = self._articles.get(url_hash)
        return row.model_copy(deep=True) if row else None

    def processed_hashes(self) -> set[str]:
        return set(self._articles)

    def recent_fingerprints(self, hours: int) -> list[KnownArticle]:
        cutoff = self._now() - timedelta(hours=hours)
        out: list[KnownArticle] = []
        for row in self._articles.values():
            if row.created_at is None or _parse(row.created_at) < cutoff:
                continue
            known = _known(row)
            if known:
                out.append(known)
        return out

    def slug_exists(self, slug: str) -> bool:
        return any(r.slug == slug for r in self._articles.values())

    def generations_today(self) -> int:
        start = _day_start(self._now())
        return sum(1 for j in self._jobs if j.tokens_in > 0 and _parse(j.started_at) >= start)

    def pending_regenerations(self) -> list[tuple[str, str]]:
        return [
            (r.url_hash, r.regen_framework)
            for r in self._articles.values()
            if r.status == ArticleStatus.PROCESSING and r.regen_framework
        ]

    def insert_article(self, record: SiteArticleRecord) -> None:
        if record.url_hash in self._articles:
            return
        stamp = self._now().isoformat()
        self._articles[record.url_hash] = record.model_copy(
            deep=True,
            update={
                "created_at": record.created_at or stamp,
                "updated_at": record.updated_at or stamp,
            },
        )

    def update_generated(self, url_hash: str, record: SiteArticleRecord) -> None:
        row = self._articles.get(url_hash)
        if row is None or row.status != ArticleStatus.PROCESSING or not row.regen_framework:
            return
        values: dict[str, Any] = {f: getattr(record, f) for f in GENERATED_FIELDS}
        for key, cols in NULL_FILL_FIELDS:
            if getattr(row, key) is None and getattr(record, key) is not None:
                values.update({c: getattr(record, c) for c in cols})
        values["status"] = ArticleStatus.REVIEW_REQUIRED
        values["regen_framework"] = None
        values["updated_at"] = self._now().isoformat()
        self._articles[url_hash] = row.model_copy(update=values, deep=True)

    def fail_regeneration(self, url_hash: str, flags: list[str]) -> None:
        row = self._articles.get(url_hash)
        if row is None or row.status != ArticleStatus.PROCESSING or not row.regen_framework:
            return
        self._articles[url_hash] = row.model_copy(
            update={
                "status": ArticleStatus.REVIEW_REQUIRED,
                "regen_framework": None,
                "flags": _merge_flags(row.flags, flags),
                "updated_at": self._now().isoformat(),
            },
            deep=True,
        )

    def add_also_reported_by(self, primary_url_hash: str, source: dict[str, str]) -> None:
        row = self._articles.get(primary_url_hash)
        if row is None or source in row.also_reported_by:
            return
        row.also_reported_by = [*row.also_reported_by, dict(source)]

    def record_job(self, job: JobRecord) -> None:
        self._jobs.append(job.model_copy(deep=True))


class SupabaseStore:
    """SiteStore over a supabase-py client. Never logs or stores the service key."""

    def __init__(
        self, client: Any, now: Callable[[], datetime] = _utc_now, page_size: int = _PAGE
    ) -> None:
        self._client = client
        self._now = now
        self._page_size = page_size

    def _select_all(
        self, table: str, cols: str, build: Callable[[Any], Any]
    ) -> list[dict[str, Any]]:
        out: list[dict[str, Any]] = []
        start = 0
        while True:
            q = build(self._client.table(table).select(cols)).order("id")
            data: list[dict[str, Any]] = (
                q.range(start, start + self._page_size - 1).execute().data or []
            )
            if not data:
                return out
            out.extend(data)
            start += len(data)

    def get_article(self, url_hash: str) -> SiteArticleRecord | None:
        res = self._client.table("site_articles").select("*").eq("url_hash", url_hash).execute()
        rows: list[dict[str, Any]] = res.data or []
        return SiteArticleRecord.model_validate(rows[0]) if rows else None

    def processed_hashes(self) -> set[str]:
        rows = self._select_all("site_articles", "url_hash", lambda q: q)
        return {r["url_hash"] for r in rows}

    def recent_fingerprints(self, hours: int) -> list[KnownArticle]:
        cutoff = (self._now() - timedelta(hours=hours)).isoformat()
        rows = self._select_all(
            "site_articles",
            "url_hash,cluster_id,content_hash,norm_title,simhash",
            lambda q: q.gte("created_at", cutoff),
        )
        return [k for r in rows if (k := _known(r)) is not None]

    def slug_exists(self, slug: str) -> bool:
        res = self._client.table("site_articles").select("url_hash").eq("slug", slug).execute()
        return bool(res.data)

    def generations_today(self) -> int:
        start = _day_start(self._now()).isoformat()
        res = (
            self._client.table("site_jobs")
            .select("job_id")
            .gte("started_at", start)
            .gt("tokens_in", 0)
            .execute()
        )
        return len(res.data or [])

    def pending_regenerations(self) -> list[tuple[str, str]]:
        rows = self._select_all(
            "site_articles",
            "url_hash,regen_framework",
            lambda q: q.eq("status", ArticleStatus.PROCESSING.value),
        )
        return [(r["url_hash"], r["regen_framework"]) for r in rows if r.get("regen_framework")]

    def insert_article(self, record: SiteArticleRecord) -> None:
        # ON CONFLICT (url_hash) DO NOTHING: only a url_hash conflict is silent;
        # any other violation (e.g. duplicate slug) raises.
        row = record.model_dump(mode="json", exclude_none=True)
        self._client.table("site_articles").upsert(
            row, on_conflict="url_hash", ignore_duplicates=True
        ).execute()

    def update_generated(self, url_hash: str, record: SiteArticleRecord) -> None:
        values: dict[str, Any] = record.model_dump(mode="json", include=set(GENERATED_FIELDS))
        values["status"] = ArticleStatus.REVIEW_REQUIRED.value
        values["regen_framework"] = None
        values["updated_at"] = self._now().isoformat()
        # Null-fill first: these UPDATEs carry the same PROCESSING/regen guard as the
        # main one (which clears that guard), plus an IS NULL filter on the column.
        filled = record.model_dump(mode="json")
        for key, cols in NULL_FILL_FIELDS:
            if filled.get(key) is None:
                continue
            (
                self._client.table("site_articles")
                .update({c: filled.get(c) for c in cols})
                .eq("url_hash", url_hash)
                .eq("status", ArticleStatus.PROCESSING.value)
                .not_.is_("regen_framework", "null")
                .is_(key, "null")
                .execute()
            )
        # Guarded in the UPDATE itself so a concurrent status change is never clobbered.
        (
            self._client.table("site_articles")
            .update(values)
            .eq("url_hash", url_hash)
            .eq("status", ArticleStatus.PROCESSING.value)
            .not_.is_("regen_framework", "null")
            .execute()
        )

    def fail_regeneration(self, url_hash: str, flags: list[str]) -> None:
        current = self.get_article(url_hash)
        if (
            current is None
            or current.status != ArticleStatus.PROCESSING
            or not current.regen_framework
        ):
            return
        values: dict[str, Any] = {
            "status": ArticleStatus.REVIEW_REQUIRED.value,
            "regen_framework": None,
            "flags": _merge_flags(current.flags, flags),
            "updated_at": self._now().isoformat(),
        }
        # Same guard as update_generated, enforced in the UPDATE itself.
        (
            self._client.table("site_articles")
            .update(values)
            .eq("url_hash", url_hash)
            .eq("status", ArticleStatus.PROCESSING.value)
            .not_.is_("regen_framework", "null")
            .execute()
        )

    def add_also_reported_by(self, primary_url_hash: str, source: dict[str, str]) -> None:
        current = self.get_article(primary_url_hash)
        if current is None or source in current.also_reported_by:
            return
        merged = [*current.also_reported_by, dict(source)]
        self._client.table("site_articles").update({"also_reported_by": merged}).eq(
            "url_hash", primary_url_hash
        ).execute()

    def record_job(self, job: JobRecord) -> None:
        self._client.table("site_jobs").insert(job.model_dump(mode="json")).execute()
