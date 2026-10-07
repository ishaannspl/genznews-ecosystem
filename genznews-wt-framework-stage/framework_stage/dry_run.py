"""A SiteStore wrapper that reads through and turns every write into a counted no-op."""

from __future__ import annotations

from collections import Counter

from framework_stage.models import JobRecord, KnownArticle, SiteArticleRecord
from framework_stage.store import SiteStore


class DryRunStore:
    def __init__(self, inner: SiteStore) -> None:
        self._inner = inner
        self.writes: Counter[str] = Counter()

    # reads delegate
    def processed_hashes(self) -> set[str]:
        return self._inner.processed_hashes()

    def recent_fingerprints(self, hours: int) -> list[KnownArticle]:
        return self._inner.recent_fingerprints(hours)

    def slug_exists(self, slug: str) -> bool:
        return self._inner.slug_exists(slug)

    def generations_today(self) -> int:
        return self._inner.generations_today()

    def pending_regenerations(self) -> list[tuple[str, str]]:
        return self._inner.pending_regenerations()

    # writes are counted, never applied
    def insert_article(self, record: SiteArticleRecord) -> None:
        self.writes["insert_article"] += 1

    def update_generated(self, url_hash: str, record: SiteArticleRecord) -> None:
        self.writes["update_generated"] += 1

    def add_also_reported_by(self, primary_url_hash: str, source: dict[str, str]) -> None:
        self.writes["add_also_reported_by"] += 1

    def fail_regeneration(self, url_hash: str, flags: list[str]) -> None:
        self.writes["fail_regeneration"] += 1

    def record_job(self, job: JobRecord) -> None:
        self.writes["record_job"] += 1
