"""Orchestrates one framework-stage run: source rows in, site_articles rows out.

Each article runs in its own try/except, so one failure never stops the batch,
and every article gets a JobRecord (written best effort).
"""

from __future__ import annotations

import logging
import os
import time
import uuid
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Literal

from pydantic import BaseModel

from app.freshness import fetch_since
from framework_stage.classify import classify_content_type
from framework_stage.dates import parse_source_date
from framework_stage.dedup import find_duplicate, fingerprint
from framework_stage.generate import assemble_body, generate_article
from framework_stage.jsonlog import get_stage_logger, log_stage
from framework_stage.llm import LLMClient, LLMError, TransientLLMError
from framework_stage.models import (
    ArticleStatus,
    ContentType,
    Fingerprint,
    GeneratedArticle,
    JobRecord,
    KnownArticle,
    SiteArticleRecord,
    SourceArticle,
    ValidationResult,
)
from framework_stage.seo import build_seo
from framework_stage.settings import Settings
from framework_stage.source_reader import read_by_hash, read_unprocessed
from framework_stage.store import SiteStore
from framework_stage.strategy import FrameworkStrategy
from framework_stage.validate import validate_article

logger = logging.getLogger(__name__)

STAGES: tuple[str, ...] = (
    "dedup",
    "classify",
    "framework",
    "generate",
    "validate",
    "seo",
    "image",
    "store",
)
_ERROR_LIMIT = 1000

Outcome = Literal["processed", "duplicate", "failed", "regenerated", "capped"]


class RunSummary(BaseModel):
    processed: int = 0
    skipped_duplicate: int = 0
    failed: int = 0
    regenerated: int = 0
    tokens_in: int = 0
    tokens_out: int = 0
    est_cost_usd: float = 0.0
    cap_reached: bool = False
    llm_unavailable: bool = False


@dataclass
class _StageResult:
    status: str = "ok"


class _Job:
    def __init__(self, url_hash: str, now: Callable[[], datetime]) -> None:
        self.job_id = str(uuid.uuid4())
        self.url_hash = url_hash
        self.started_at = now().isoformat()
        self.stages: dict[str, str] = {s: "skip" for s in STAGES}
        self.tokens_in = 0
        self.tokens_out = 0
        self.error: str | None = None
        self._t0 = time.perf_counter()
        self._executed: set[str] = set()
        self._log = get_stage_logger()

    def add_tokens(self, tokens_in: int, tokens_out: int) -> None:
        self.tokens_in += tokens_in
        self.tokens_out += tokens_out

    @contextmanager
    def stage(self, name: str) -> Iterator[_StageResult]:
        res = _StageResult()
        t = time.perf_counter()
        try:
            yield res
        except BaseException:
            res.status = "fail"
            raise
        finally:
            self.stages[name] = res.status
            self._executed.add(name)
            self._emit(name, res.status, int((time.perf_counter() - t) * 1000))

    def _emit(self, name: str, status: str, duration_ms: int) -> None:
        log_stage(
            self._log,
            job_id=self.job_id,
            url_hash=self.url_hash,
            stage=name,
            duration_ms=duration_ms,
            status=status,
        )

    def finish(self, settings: Settings, now: Callable[[], datetime]) -> JobRecord:
        for name in STAGES:
            if name not in self._executed:
                self._emit(name, "skip", 0)
        return JobRecord(
            job_id=self.job_id,
            url_hash=self.url_hash,
            started_at=self.started_at,
            finished_at=now().isoformat(),
            duration_ms=int((time.perf_counter() - self._t0) * 1000),
            stages=dict(self.stages),
            error=self.error,
            model=settings.framework_model,
            tokens_in=self.tokens_in,
            tokens_out=self.tokens_out,
            est_cost_usd=_cost(settings, self.tokens_in, self.tokens_out),
        )


def _cost(settings: Settings, tokens_in: int, tokens_out: int) -> float:
    return (
        tokens_in / 1e6 * settings.cost_per_mtok_in
        + tokens_out / 1e6 * settings.cost_per_mtok_out
    )


def _error_text(exc: BaseException) -> str:
    text = str(exc) if isinstance(exc, LLMError) else f"{type(exc).__name__}: {exc}"
    return text[:_ERROR_LIMIT]


@dataclass
class _Run:
    source_db: Path
    store: SiteStore
    llm: LLMClient
    settings: Settings
    strategy: FrameworkStrategy
    fetch_image: Callable[[str], str | None]
    now: Callable[[], datetime]
    classifier_rules: dict[str, list[str]]
    long_form_min_chars: int
    remaining: int = 0
    cap_blocked: bool = False
    llm_unavailable: bool = False
    tokens_in: int = 0
    tokens_out: int = 0
    known: list[KnownArticle] = field(default_factory=lambda: [])
    run_slugs: set[str] = field(default_factory=lambda: set())

    # ------------------------------------------------------------------ rows

    def _base_record(
        self, source: SourceArticle, job: _Job, status: ArticleStatus, flags: list[str]
    ) -> SiteArticleRecord:
        stamp = self.now().isoformat()
        return SiteArticleRecord(
            url_hash=source.url_hash,
            source_url=source.source_url,
            source_domain=source.domain,
            source_name=source.domain,
            category=source.niche,
            status=status,
            flags=flags,
            job_id=job.job_id,
            published_at=parse_source_date(source.published_at, self.now()),
            created_at=stamp,
            updated_at=stamp,
        )

    def _insert_failed(
        self,
        source: SourceArticle,
        job: _Job,
        flags: list[str],
        *,
        framework: str | None = None,
        content_type: str | None = None,
    ) -> None:
        record = self._base_record(source, job, ArticleStatus.FAILED, flags).model_copy(
            update={"framework": framework, "content_type": content_type}
        )
        with job.stage("store"):
            self.store.insert_article(record)

    def _status_for(self, source: SourceArticle, v: ValidationResult) -> ArticleStatus:
        s = self.settings
        niche = (source.niche or "").strip().lower()
        if (
            s.auto_publish_enabled
            and niche in s.auto_publish_niches
            and v.confidence >= s.auto_publish_min_confidence
            and v.fact_risk == "LOW"
        ):
            return ArticleStatus.APPROVED
        return ArticleStatus.REVIEW_REQUIRED

    # ------------------------------------------------------------- pipeline

    def process(self, source: SourceArticle, regen_framework: str | None) -> Outcome:
        job = _Job(source.url_hash, self.now)
        outcome: Outcome = "failed"
        try:
            outcome = self._pipeline(job, source, regen_framework)
        except Exception as exc:  # one article must never stop the batch
            job.error = _error_text(exc)
            outcome = "failed"
            logger.warning("framework stage job %s failed: %s", job.job_id, type(exc).__name__)
            if regen_framework is not None:
                self._fail_regen(source.url_hash, ["REGEN_ERROR"])
        record = job.finish(self.settings, self.now)
        try:
            self.store.record_job(record)
        except Exception as exc:
            logger.warning("could not record job %s: %s", job.job_id, type(exc).__name__)
        self.tokens_in += record.tokens_in
        self.tokens_out += record.tokens_out
        return outcome

    def _fail_regen(self, url_hash: str, flags: list[str]) -> None:
        """Take a failed regeneration out of the queue; never raises."""
        try:
            self.store.fail_regeneration(url_hash, flags)
        except Exception as exc:
            logger.warning("could not mark regeneration failed: %s", type(exc).__name__)

    def _llm_unavailable(self, job: _Job, exc: TransientLLMError) -> Outcome:
        """Provider down or quota-limited: record the job, write no row, stop the batch.

        No FAILED row and no fail_regeneration, so the article (or pending
        regeneration) is picked up again on the next run.
        """
        job.error = _error_text(exc)
        self.llm_unavailable = True
        return "failed"

    def _llm_failed(
        self,
        job: _Job,
        source: SourceArticle,
        exc: LLMError,
        regen: str | None,
        *,
        framework: str | None = None,
        content_type: str | None = None,
    ) -> Outcome:
        job.error = _error_text(exc)
        if regen is None:
            self._insert_failed(
                source, job, ["LLM_ERROR"], framework=framework, content_type=content_type
            )
        else:
            # Leave the reviewed article as is, but stop retrying it every run.
            self._fail_regen(source.url_hash, ["LLM_ERROR"])
        return "failed"

    def _pipeline(self, job: _Job, source: SourceArticle, regen: str | None) -> Outcome:
        s = self.settings

        if len(source.original_content.strip()) < s.min_source_chars:
            if regen is None:
                self._insert_failed(source, job, ["INSUFFICIENT_SOURCE"])
            else:
                job.error = "INSUFFICIENT_SOURCE"
                self._fail_regen(source.url_hash, ["INSUFFICIENT_SOURCE"])
            return "failed"

        fp: Fingerprint = fingerprint(source)
        # A regeneration is not re-deduplicated; its own cluster is used only when the
        # stored row has none (update_generated never overwrites a cluster or slug).
        cluster_id: str | None = source.url_hash if regen is not None else None
        extra_flags: list[str] = []
        if regen is None:
            with job.stage("dedup"):
                dup = find_duplicate(
                    source,
                    self.known,
                    title_jaccard_min=s.title_jaccard_min,
                    simhash_max_distance=s.simhash_max_distance,
                )
            if dup.kind in ("EXACT", "SAME_STORY") and dup.primary_url_hash:
                primary = dup.primary_url_hash
                record = self._base_record(
                    source, job, ArticleStatus.ARCHIVED, [f"DUPLICATE_OF:{primary}"]
                ).model_copy(
                    update={
                        "cluster_id": dup.cluster_id,
                        "content_hash": fp.content_hash,
                        "norm_title": fp.norm_title,
                        # simhash left None so archived rows are never dedup primaries.
                    }
                )
                with job.stage("store"):
                    self.store.add_also_reported_by(
                        primary, {"url": source.source_url, "domain": source.domain}
                    )
                    self.store.insert_article(record)
                return "duplicate"
            cluster_id = dup.cluster_id
            if dup.kind == "POSSIBLE_SAME_STORY" and dup.primary_url_hash:
                # Headline-only match: generate anyway, join the cluster, flag for
                # review; the primary's also_reported_by is left alone.
                extra_flags.append(f"POSSIBLE_DUPLICATE_OF:{dup.primary_url_hash}")

        if self.remaining <= 0:
            self.cap_blocked = True
            job.error = "DAILY_CAP_REACHED"
            return "capped"

        try:
            with job.stage("classify"):
                ctype, t_in, t_out = classify_content_type(
                    source,
                    self.llm,
                    model=s.classifier_model,
                    rules=self.classifier_rules,
                    long_form_min_chars=self.long_form_min_chars,
                )
                job.add_tokens(t_in, t_out)
        except TransientLLMError as exc:
            return self._llm_unavailable(job, exc)
        except LLMError as exc:
            return self._llm_failed(job, source, exc, regen)
        content_type = ContentType(ctype).value

        with job.stage("framework"):
            framework = self.strategy.select(content_type, source.niche, regen)

        self.remaining -= 1
        generated: GeneratedArticle | None = None
        verdict: ValidationResult | None = None
        try:
            for _ in range(2):  # first attempt plus one regeneration on hard fail
                with job.stage("generate"):
                    generated, t_in, t_out = generate_article(
                        source, framework, content_type, self.llm, model=s.framework_model
                    )
                    job.add_tokens(t_in, t_out)
                with job.stage("validate") as st:
                    verdict = validate_article(
                        generated, source.original_content, source.tldr
                    )
                    if verdict.hard_fail:
                        st.status = "fail"
                if not verdict.hard_fail:
                    break
        except TransientLLMError as exc:
            return self._llm_unavailable(job, exc)
        except LLMError as exc:
            return self._llm_failed(
                job, source, exc, regen, framework=framework, content_type=content_type
            )
        assert generated is not None and verdict is not None

        if verdict.hard_fail:
            if regen is None:
                self._insert_failed(
                    source,
                    job,
                    list(verdict.flags),
                    framework=framework,
                    content_type=content_type,
                )
            else:
                job.error = "VALIDATION_FAILED: " + ", ".join(verdict.flags)[:_ERROR_LIMIT]
                self._fail_regen(source.url_hash, list(verdict.flags))
            return "failed"

        with job.stage("seo"):
            seo = build_seo(
                generated, lambda slug: slug in self.run_slugs or self.store.slug_exists(slug)
            )
            attribution = (
                source.source_attribution
                or f"Sources: {source.domain}. Synthesized and curated by GenZNews."
            )
            body = assemble_body(source.tldr, seo.body_md, attribution)

        image_url: str | None = None
        if s.image_policy == "hotlink":
            with job.stage("image") as st:
                try:
                    image_url = self.fetch_image(source.source_url)
                except Exception:
                    image_url = None
                    st.status = "fail"

        record = self._base_record(
            source, job, self._status_for(source, verdict), [*verdict.flags, *extra_flags]
        ).model_copy(
            update={
                "content_hash": fp.content_hash,
                "norm_title": fp.norm_title,
                "simhash": f"{fp.simhash:016x}",
                "slug": seo.slug,
                "title": seo.title,
                "summary": seo.summary,
                "body_md": body,
                "generated_body_md": body,
                "framework": framework,
                "content_type": content_type,
                "category": seo.category,
                "tags": list(seo.tags),
                "seo_title": seo.seo_title,
                "seo_description": seo.seo_description,
                "keywords": list(seo.keywords),
                "image_url": image_url,
                "image_source": "og:image" if image_url else None,
                "cluster_id": cluster_id,
                "confidence": verdict.confidence,
                "fact_risk": verdict.fact_risk,
            }
        )

        with job.stage("store"):
            if regen is not None:
                self.store.update_generated(source.url_hash, record)
            else:
                self.store.insert_article(record)

        self.run_slugs.add(seo.slug)
        if regen is not None:
            return "regenerated"
        self.known.append(
            KnownArticle(
                url_hash=source.url_hash,
                cluster_id=cluster_id or source.url_hash,
                fingerprint=fp,
            )
        )
        return "processed"


def run_stage(
    *,
    source_db: Path,
    store: SiteStore,
    llm: LLMClient,
    settings: Settings,
    strategy: FrameworkStrategy,
    fetch_image: Callable[[str], str | None],
    now: Callable[[], datetime],
    classifier_rules: dict[str, list[str]],
    long_form_min_chars: int,
) -> RunSummary:
    run = _Run(
        source_db=source_db,
        store=store,
        llm=llm,
        settings=settings,
        strategy=strategy,
        fetch_image=fetch_image,
        now=now,
        classifier_rules=classifier_rules,
        long_form_min_chars=long_form_min_chars,
    )
    processed = store.processed_hashes()
    run.remaining = settings.daily_generation_cap - store.generations_today()
    run.known = list(store.recent_fingerprints(settings.dedup_window_hours))

    work: list[tuple[SourceArticle, str | None]] = []
    for url_hash, framework in store.pending_regenerations():
        source = read_by_hash(source_db, url_hash)
        if source is None:
            logger.warning("regeneration skipped: source row missing for %s", url_hash)
            continue
        work.append((source, framework))
    for source in read_unprocessed(source_db, processed, settings.run_limit, since=fetch_since(os.environ)):
        work.append((source, None))

    summary = RunSummary()
    for source, regen in work:
        outcome = run.process(source, regen)
        if outcome == "processed":
            summary.processed += 1
        elif outcome == "duplicate":
            summary.skipped_duplicate += 1
        elif outcome == "regenerated":
            summary.regenerated += 1
        elif outcome == "failed":
            summary.failed += 1
        if run.llm_unavailable:
            logger.warning("framework stage: LLM unavailable, stopping the batch early")
            break

    summary.tokens_in = run.tokens_in
    summary.tokens_out = run.tokens_out
    summary.est_cost_usd = _cost(settings, run.tokens_in, run.tokens_out)
    summary.cap_reached = run.cap_blocked or run.remaining <= 0
    summary.llm_unavailable = run.llm_unavailable
    return summary
