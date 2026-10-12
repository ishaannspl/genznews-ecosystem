from __future__ import annotations

import dataclasses
import json
import logging
import uuid
from datetime import UTC, datetime
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest
from fakes import FakeLLM, make_generated, make_source_db

from framework_stage.dedup import fingerprint
from framework_stage.dry_run import DryRunStore
from framework_stage.jsonlog import JsonLineFormatter, get_stage_logger
from framework_stage.llm import GeminiClient, LLMError, TransientLLMError
from framework_stage.models import (
    ArticleStatus,
    JobRecord,
    SiteArticleRecord,
    SourceArticle,
)
from framework_stage.runner import STAGES, RunSummary, run_stage
from framework_stage.settings import Settings
from framework_stage.store import InMemoryStore
from framework_stage.strategy import load_classifier_rules, load_strategy

NOW = datetime(2026, 10, 5, 12, 0, tzinfo=UTC)

CONTENTS = {
    "a": "Mumbai police arrested twelve people on Monday after a protest near the old railway station downtown.",
    "b": "A startup in Bengaluru raised fresh funding to build cheaper electric scooters for delivery riders.",
    "c": "Heavy rain flooded several roads in Chennai and schools stayed shut while crews cleared drains.",
    "d": "The cricket board named a young spinner to the test squad after a strong domestic season.",
    "e": "Farmers in Punjab started harvesting wheat early because of an unusually warm spring this year.",
}
TITLES = {
    "a": "Mumbai protest arrests",
    "b": "Bengaluru scooter startup funding",
    "c": "Chennai flooding shuts schools",
    "d": "Spinner joins cricket test squad",
    "e": "Punjab wheat harvest early",
}


class RecordingStore(InMemoryStore):
    def __init__(self) -> None:
        super().__init__(now=lambda: NOW)
        self.jobs: list[JobRecord] = []

    def record_job(self, job: JobRecord) -> None:
        self.jobs.append(job)
        super().record_job(job)


def settings(**over: Any) -> Settings:
    base = Settings(
        db_path=Path("unused.db"),
        supabase_url="",
        supabase_service_key="",
        framework_model="gen-model",
        classifier_model="cls-model",
        daily_generation_cap=50,
        run_limit=20,
        min_source_chars=40,
        auto_publish_enabled=False,
        auto_publish_min_confidence=0.9,
        auto_publish_niches=frozenset(),
        image_policy="hotlink",
        title_jaccard_min=0.5,
        simhash_max_distance=6,
        dedup_window_hours=72,
        cost_per_mtok_in=0.10,
        cost_per_mtok_out=0.40,
        lock_path=Path("unused.lock"),
    )
    return dataclasses.replace(base, **over)


def db(tmp_path: Path, keys: list[str], **per: dict[str, Any]) -> Path:
    rows: list[dict[str, Any]] = []
    for i, k in enumerate(keys):
        row: dict[str, Any] = {
            "h": k,
            "title": TITLES.get(k, f"Title {k}"),
            "content": CONTENTS.get(k, f"Unique filler content number {k} " * 4),
            "created": f"2026-10-05T0{9 - i}:00:00",  # first key is newest
        }
        row.update(per.get(k, {}))
        rows.append(row)
    return make_source_db(tmp_path / "articles.db", rows)


def run(
    source_db: Path,
    store: InMemoryStore,
    llm: Any,
    *,
    fetch_image: Any = None,
    rules: dict[str, list[str]] | None = None,
    **over: Any,
) -> RunSummary:
    return run_stage(
        source_db=source_db,
        store=store,
        llm=llm,
        settings=settings(**over),
        strategy=load_strategy(),
        fetch_image=fetch_image or (lambda url: None),
        now=lambda: NOW,
        # The classifier haystack always contains a space, so by default every
        # article hits this GENERAL_NEWS keyword rule and classify makes no LLM call.
        classifier_rules=rules if rules is not None else {"GENERAL_NEWS": [" "]},
        long_form_min_chars=6000,
    )


def gen_llm(n: int, **over: Any) -> FakeLLM:
    return FakeLLM([make_generated(**over) for _ in range(n)])


# --------------------------------------------------------------------------- brief


def test_new_article_is_stored_as_review_required_with_framework_and_job(tmp_path):
    store = RecordingStore()
    llm = gen_llm(1)
    s = run(db(tmp_path, ["a"]), store, llm, fetch_image=lambda u: "https://img.test/a.jpg")
    row = store.get_article("a")
    assert row is not None
    assert row.status == ArticleStatus.REVIEW_REQUIRED
    assert row.framework == "AIDA" and row.content_type == "GENERAL_NEWS"
    assert row.slug == "local-update" and row.title == "Local update"
    assert row.body_md == row.generated_body_md
    assert row.body_md is not None and row.body_md.startswith("**TL;DR**")
    assert "Sources: x.test. Synthesized and curated by GenZNews." in row.body_md
    assert row.source_url == "https://x.test/a" and row.source_domain == "x.test"
    assert row.source_name == "x.test" and row.category == "news"
    assert row.cluster_id == "a" and row.content_hash and row.norm_title
    assert row.simhash is not None and int(row.simhash, 16) > 0
    assert row.confidence == 1.0 and row.fact_risk == "LOW"
    assert row.image_url == "https://img.test/a.jpg" and row.image_source == "og:image"
    assert row.byline == "GenZNews Desk" and row.created_at == NOW.isoformat()
    assert len(store.jobs) == 1
    job = store.jobs[0]
    assert row.job_id == job.job_id
    assert job.url_hash == "a" and job.error is None and job.model == "gen-model"
    assert job.stages == {st: "ok" for st in STAGES}
    assert (job.tokens_in, job.tokens_out) == (10, 5)
    assert s.processed == 1 and s.failed == 0 and not s.cap_reached


def test_second_run_creates_nothing(tmp_path):
    store = RecordingStore()
    source = db(tmp_path, ["a", "b"])
    first = run(source, store, gen_llm(2, slug="x"))
    llm2 = FakeLLM([])
    second = run(source, store, llm2)
    assert first.processed == 2
    assert second == RunSummary(
        processed=0, skipped_duplicate=0, failed=0, regenerated=0,
        tokens_in=0, tokens_out=0, est_cost_usd=0.0, cap_reached=False,
    )
    assert llm2.calls == [] and len(store.jobs) == 2


def test_published_article_is_not_overwritten_on_rerun(tmp_path):
    store = RecordingStore()
    store.insert_article(
        SiteArticleRecord(url_hash="a", title="Live", status=ArticleStatus.PUBLISHED)
    )
    llm = FakeLLM([])
    s = run(db(tmp_path, ["a"]), store, llm)
    row = store.get_article("a")
    assert row is not None and row.status == ArticleStatus.PUBLISHED and row.title == "Live"
    assert llm.calls == [] and s.processed == 0


def test_thin_source_is_failed_insufficient_source_with_zero_llm_calls(tmp_path):
    store = RecordingStore()
    llm = FakeLLM([])
    s = run(db(tmp_path, ["a"], a={"content": "   too short   "}), store, llm)
    row = store.get_article("a")
    assert row is not None and row.status == ArticleStatus.FAILED
    assert row.flags == ["INSUFFICIENT_SOURCE"]
    assert llm.calls == [] and s.failed == 1 and s.processed == 0
    assert store.jobs[0].stages["store"] == "ok"
    assert store.jobs[0].stages["generate"] == "skip"
    assert store.generations_today() == 0


def _resp(text: str) -> SimpleNamespace:
    return SimpleNamespace(
        text=text,
        usage_metadata=SimpleNamespace(prompt_token_count=7, candidates_token_count=3),
    )


class StubModels:
    def __init__(self, outcomes: list[Any]) -> None:
        self.outcomes = list(outcomes)
        self.calls = 0

    def generate_content(self, *, model: str, contents: str, config: Any) -> Any:
        self.calls += 1
        return self.outcomes.pop(0)


def test_malformed_llm_output_retries_once_then_failed_and_batch_continues(tmp_path):
    models = StubModels(
        [_resp("not json"), _resp("{still not json"), _resp(make_generated().model_dump_json())]
    )
    llm = GeminiClient("k", client=SimpleNamespace(models=models), sleep=lambda s: None)
    store = RecordingStore()
    s = run(db(tmp_path, ["a", "b"]), store, llm)
    assert models.calls == 3  # one ask + one re-ask for "a", one ask for "b"
    bad, good = store.get_article("a"), store.get_article("b")
    assert bad is not None and bad.status == ArticleStatus.FAILED and bad.flags == ["LLM_ERROR"]
    assert good is not None and good.status == ArticleStatus.REVIEW_REQUIRED
    job_a = next(j for j in store.jobs if j.url_hash == "a")
    assert job_a.error is not None and "Invalid structured output" in job_a.error
    assert job_a.stages["generate"] == "fail"
    assert s.failed == 1 and s.processed == 1


def test_same_story_generates_once_and_links_other_outlet(tmp_path):
    # Content-level (SimHash) match with a different headline: archived and linked.
    store = RecordingStore()
    llm = gen_llm(1)
    source = db(
        tmp_path,
        ["a", "a2"],
        a2={
            "title": "Railway station protest ends in detentions",
            "content": "Reports: " + CONTENTS["a"],
            "domain": "other.test",
        },
    )
    s = run(source, store, llm)
    assert len(llm.calls) == 1
    primary, dup = store.get_article("a"), store.get_article("a2")
    assert primary is not None and dup is not None
    assert primary.also_reported_by == [{"url": "https://other.test/a2", "domain": "other.test"}]
    assert dup.status == ArticleStatus.ARCHIVED
    assert dup.cluster_id == primary.cluster_id == "a"
    assert dup.flags == ["DUPLICATE_OF:a"]
    assert s.skipped_duplicate == 1 and s.processed == 1


def test_exact_duplicate_makes_no_llm_call(tmp_path):
    store = RecordingStore()
    fp = fingerprint(SourceArticle(url_hash="p", source_url="u", domain="d",
                                   original_title="x", original_content=CONTENTS["a"]))
    store.insert_article(
        SiteArticleRecord(
            url_hash="p", cluster_id="cl-1", content_hash=fp.content_hash,
            norm_title="unrelated words here", simhash=f"{fp.simhash:x}",
            status=ArticleStatus.PUBLISHED,
        )
    )
    llm = FakeLLM([])
    s = run(db(tmp_path, ["a"], a={"title": "Totally different headline words"}), store, llm)
    assert llm.calls == []
    dup = store.get_article("a")
    assert dup is not None and dup.status == ArticleStatus.ARCHIVED
    assert dup.cluster_id == "cl-1" and dup.flags == ["DUPLICATE_OF:p"]
    primary = store.get_article("p")
    assert primary is not None
    assert primary.also_reported_by == [{"url": "https://x.test/a", "domain": "x.test"}]
    assert s.skipped_duplicate == 1
    assert store.jobs[-1].stages["dedup"] == "ok" and store.jobs[-1].stages["generate"] == "skip"


class FailingInsertStore(RecordingStore):
    def __init__(self, bad: str) -> None:
        super().__init__()
        self.bad = bad

    def insert_article(self, record: SiteArticleRecord) -> None:
        if record.url_hash == self.bad:
            raise RuntimeError("duplicate key value violates unique constraint")
        super().insert_article(record)


def test_store_error_on_one_article_does_not_stop_batch(tmp_path):
    store = FailingInsertStore("a")
    s = run(db(tmp_path, ["a", "b"]), store, gen_llm(2, slug="s"))
    assert store.get_article("a") is None
    assert store.get_article("b") is not None
    job_a = next(j for j in store.jobs if j.url_hash == "a")
    assert job_a.error is not None and "unique constraint" in job_a.error
    assert job_a.stages["store"] == "fail"
    assert s.failed == 1 and s.processed == 1


def test_daily_cap_stops_generation_and_reports_it(tmp_path):
    store = RecordingStore()
    llm = gen_llm(5, slug="s")
    s = run(db(tmp_path, ["a", "b", "c"]), store, llm, daily_generation_cap=2)
    assert len(llm.calls) == 2 and s.processed == 2 and s.cap_reached
    assert store.get_article("c") is None  # left for a later run
    # Next run (same day) generates nothing more.
    llm2 = gen_llm(1)
    s2 = run(tmp_path / "articles.db", store, llm2, daily_generation_cap=2)
    assert llm2.calls == [] and s2.cap_reached and s2.processed == 0


def test_run_limit_caps_articles_per_run(tmp_path):
    store = RecordingStore()
    llm = gen_llm(5, slug="s")
    s = run(db(tmp_path, ["a", "b", "c", "d", "e"]), store, llm, run_limit=2)
    assert s.processed == 2 and len(llm.calls) == 2
    assert store.processed_hashes() == {"a", "b"}  # newest first


def test_regeneration_request_uses_forced_framework_and_clears_flag(tmp_path):
    store = RecordingStore()
    store.insert_article(
        SiteArticleRecord(
            url_hash="a", slug="keep-me", title="Old", framework="AIDA",
            status=ArticleStatus.PROCESSING, regen_framework="PAS",
        )
    )
    llm = gen_llm(1, title="New")
    s = run(db(tmp_path, ["a"]), store, llm)
    assert "Framework key: PAS" in llm.calls[0]["prompt"]
    row = store.get_article("a")
    assert row is not None
    assert row.framework == "PAS" and row.title == "New" and row.slug == "keep-me"
    assert row.regen_framework is None and row.status == ArticleStatus.REVIEW_REQUIRED
    assert s.regenerated == 1 and s.processed == 0
    assert store.jobs[0].stages["dedup"] == "skip"


def test_auto_publish_off_by_default_even_at_confidence_one(tmp_path):
    store = RecordingStore()
    run(db(tmp_path, ["a"], a={"niche": "tech"}), store, gen_llm(1),
        auto_publish_niches=frozenset({"tech"}), auto_publish_min_confidence=0.5)
    row = store.get_article("a")
    assert row is not None and row.confidence == 1.0
    assert row.status == ArticleStatus.REVIEW_REQUIRED


def test_auto_publish_requires_enabled_niche_and_threshold(tmp_path):
    on = dict(auto_publish_enabled=True, auto_publish_niches=frozenset({"tech"}),
              auto_publish_min_confidence=0.9)
    store = RecordingStore()
    run(
        db(tmp_path, ["a", "b", "c"], a={"niche": "tech"}, b={"niche": "sports"},
           c={"niche": "tech"}),
        store,
        FakeLLM([
            make_generated(slug="one"),
            make_generated(slug="two"),
            # One ungrounded entity: confidence 0.85 < 0.9.
            make_generated(slug="three", body_md="The story is about Zanzibar."),
        ]),
        **on,
    )
    a, b, c = (store.get_article(k) for k in "abc")
    assert a is not None and a.status == ArticleStatus.APPROVED
    assert b is not None and b.status == ArticleStatus.REVIEW_REQUIRED
    assert c is not None and c.status == ArticleStatus.REVIEW_REQUIRED
    assert c.confidence is not None and c.confidence < 0.9


def test_hard_validation_failure_regenerates_once_then_failed(tmp_path):
    store = RecordingStore()
    # generate_article strips em-dashes, so a banned phrase is what reaches validation.
    bad = make_generated(body_md="Moreover, the story is a short local update.")
    llm = FakeLLM([bad, bad, make_generated()])
    s = run(db(tmp_path, ["a", "b"]), store, llm)
    assert len(llm.calls) == 3
    row = store.get_article("a")
    assert row is not None and row.status == ArticleStatus.FAILED
    assert "BANNED_PHRASE:moreover" in row.flags
    assert row.body_md is None
    ok = store.get_article("b")
    assert ok is not None and ok.status == ArticleStatus.REVIEW_REQUIRED
    job_a = next(j for j in store.jobs if j.url_hash == "a")
    assert job_a.stages["validate"] == "fail" and job_a.tokens_in == 20
    assert s.failed == 1 and s.processed == 1


def test_hard_validation_failure_then_pass_on_regeneration_is_stored(tmp_path):
    store = RecordingStore()
    bad = make_generated(body_md="Let us delve into a short local update.")
    llm = FakeLLM([bad, make_generated()])
    s = run(db(tmp_path, ["a"]), store, llm)
    row = store.get_article("a")
    assert row is not None and row.status == ArticleStatus.REVIEW_REQUIRED
    assert s.processed == 1 and s.tokens_in == 20 and s.tokens_out == 10


def test_est_cost_uses_settings_prices(tmp_path):
    store = RecordingStore()
    s = run(db(tmp_path, ["a"]), store, gen_llm(1), cost_per_mtok_in=1.0,
            cost_per_mtok_out=2.0)
    assert (s.tokens_in, s.tokens_out) == (10, 5)
    assert s.est_cost_usd == pytest.approx(10 / 1e6 * 1.0 + 5 / 1e6 * 2.0)
    assert store.jobs[0].est_cost_usd == pytest.approx(s.est_cost_usd)


def test_image_failure_still_stores_article_with_null_image(tmp_path):
    def boom(url: str) -> str | None:
        raise RuntimeError("network down")

    store = RecordingStore()
    s = run(db(tmp_path, ["a"]), store, gen_llm(1), fetch_image=boom)
    row = store.get_article("a")
    assert row is not None and row.image_url is None and row.image_source is None
    assert row.status == ArticleStatus.REVIEW_REQUIRED
    assert store.jobs[0].stages["image"] == "fail" and store.jobs[0].stages["store"] == "ok"
    assert s.processed == 1


# --------------------------------------------------------------------------- rulings


def test_placeholder_image_policy_skips_fetch(tmp_path):
    calls: list[str] = []
    store = RecordingStore()
    run(db(tmp_path, ["a"]), store, gen_llm(1), image_policy="placeholder",
        fetch_image=lambda u: calls.append(u) or "x")
    row = store.get_article("a")
    assert calls == [] and row is not None and row.image_url is None
    assert store.jobs[0].stages["image"] == "skip"


def test_in_run_slug_collision_gets_suffix(tmp_path):
    store = RecordingStore()
    run(db(tmp_path, ["a", "b"]), store, gen_llm(2, slug="same-slug"))
    a, b = store.get_article("a"), store.get_article("b")
    assert a is not None and b is not None
    assert a.slug == "same-slug" and b.slug == "same-slug-2"


def test_existing_store_slug_collision_gets_suffix(tmp_path):
    store = RecordingStore()
    store.insert_article(SiteArticleRecord(url_hash="z", slug="local-update"))
    run(db(tmp_path, ["a"]), store, gen_llm(1))
    row = store.get_article("a")
    assert row is not None and row.slug == "local-update-2"


def test_job_ids_are_valid_uuids_and_unique(tmp_path):
    store = RecordingStore()
    run(db(tmp_path, ["a", "b", "c"], c={"content": "short"}), store, gen_llm(2, slug="s"))
    ids = [j.job_id for j in store.jobs]
    assert len(ids) == 3 and len(set(ids)) == 3
    for i in ids:
        assert str(uuid.UUID(i)) == i


def test_llm_error_in_classify_is_failed_without_retry(tmp_path):
    store = RecordingStore()
    llm = FakeLLM([LLMError("quota exhausted")])
    s = run(db(tmp_path, ["a"]), store, llm, rules={})
    assert len(llm.calls) == 1  # the runner does not retry an LLMError
    row = store.get_article("a")
    assert row is not None and row.status == ArticleStatus.FAILED and row.flags == ["LLM_ERROR"]
    job_a = next(j for j in store.jobs if j.url_hash == "a")
    assert job_a.error == "quota exhausted" and job_a.stages["classify"] == "fail"
    assert job_a.stages["generate"] == "skip"
    assert s.failed == 1 and s.processed == 0


def test_unexpected_exception_records_job_and_batch_continues(tmp_path):
    store = RecordingStore()
    llm = FakeLLM([make_generated(), make_generated(slug="b")])
    # An unknown forced framework makes strategy.select raise ValueError.
    store.insert_article(SiteArticleRecord(url_hash="a", status=ArticleStatus.PROCESSING,
                                           regen_framework="NOT_A_FRAMEWORK"))
    s = run(db(tmp_path, ["a", "b"]), store, llm)
    row = store.get_article("a")
    assert row is not None and row.status == ArticleStatus.REVIEW_REQUIRED
    assert row.regen_framework is None and "REGEN_ERROR" in row.flags
    job_a = next(j for j in store.jobs if j.url_hash == "a")
    assert job_a.error is not None and "Unknown framework" in job_a.error
    assert store.get_article("b") is not None
    assert s.failed == 1 and s.processed == 1


def test_record_job_failure_does_not_stop_batch(tmp_path):
    class BadJobs(RecordingStore):
        def record_job(self, job: JobRecord) -> None:
            raise RuntimeError("site_jobs down")

    store = BadJobs()
    s = run(db(tmp_path, ["a", "b"]), store, gen_llm(2, slug="s"))
    assert store.get_article("a") is not None and store.get_article("b") is not None
    assert s.processed == 2


def test_regeneration_missing_source_row_is_skipped(tmp_path):
    store = RecordingStore()
    store.insert_article(SiteArticleRecord(url_hash="gone", status=ArticleStatus.PROCESSING,
                                           regen_framework="PAS"))
    llm = gen_llm(1)
    s = run(db(tmp_path, ["a"]), store, llm)
    assert len(llm.calls) == 1 and s.regenerated == 0 and s.processed == 1


def test_duplicates_and_thin_sources_do_not_consume_cap(tmp_path):
    store = RecordingStore()
    source = db(
        tmp_path,
        ["t", "a", "a2"],
        t={"content": "tiny"},
        a2={"title": "Mumbai protest arrests Monday", "content": CONTENTS["a"] + " Updated."},
    )
    s = run(source, store, gen_llm(1), daily_generation_cap=1)
    assert s.processed == 1 and s.skipped_duplicate == 1 and s.failed == 1
    a2 = store.get_article("a2")
    assert a2 is not None and a2.status == ArticleStatus.ARCHIVED


def test_stage_logs_are_json_lines_without_bodies(tmp_path, caplog):
    store = RecordingStore()
    with caplog.at_level(logging.INFO, logger=get_stage_logger().name):
        run(db(tmp_path, ["a"]), store, gen_llm(1))
    events = [r for r in caplog.records if r.name == get_stage_logger().name]
    assert [json.loads(r.getMessage())["stage"] for r in events] == list(STAGES)
    for r in events:
        payload = json.loads(JsonLineFormatter().format(r))
        assert set(payload) >= {"job_id", "url_hash", "stage", "duration_ms", "status"}
        assert payload["url_hash"] == "a" and payload["status"] == "ok"
        assert isinstance(payload["duration_ms"], int)
        assert CONTENTS["a"] not in r.getMessage() and "TL;DR" not in r.getMessage()


# --------------------------------------------------------------------------- dry run


def test_dry_run_store_delegates_reads_and_counts_writes():
    inner = InMemoryStore(now=lambda: NOW)
    inner.insert_article(SiteArticleRecord(url_hash="p", slug="taken"))
    dry = DryRunStore(inner)
    assert dry.processed_hashes() == {"p"}
    assert dry.slug_exists("taken") and not dry.slug_exists("free")
    assert dry.generations_today() == 0 and dry.pending_regenerations() == []
    assert dry.recent_fingerprints(72) == []
    dry.insert_article(SiteArticleRecord(url_hash="new"))
    dry.update_generated("p", SiteArticleRecord(url_hash="p"))
    dry.add_also_reported_by("p", {"url": "u", "domain": "d"})
    dry.record_job(JobRecord(job_id=str(uuid.uuid4()), url_hash="new", started_at=NOW.isoformat()))
    assert inner.processed_hashes() == {"p"}
    row = inner.get_article("p")
    assert row is not None and row.also_reported_by == []
    assert dry.writes == {
        "insert_article": 1, "update_generated": 1, "add_also_reported_by": 1, "record_job": 1
    }


def test_dry_run_full_stage_writes_nothing(tmp_path):
    inner = RecordingStore()
    dry = DryRunStore(inner)
    s = run_stage(
        source_db=db(tmp_path, ["a"]), store=dry, llm=gen_llm(1), settings=settings(),
        strategy=load_strategy(), fetch_image=lambda u: None, now=lambda: NOW,
        classifier_rules={"GENERAL_NEWS": [" "]}, long_form_min_chars=6000,
    )
    assert s.processed == 1 and inner.processed_hashes() == set() and inner.jobs == []
    assert dry.writes["insert_article"] == 1 and dry.writes["record_job"] == 1


# --------------------------------------------------------------------------- rules


def test_load_classifier_rules_reads_shipped_config():
    rules, min_chars = load_classifier_rules()
    assert "PRODUCT_LAUNCH" in rules and min_chars == 6000


def test_load_classifier_rules_rejects_unknown_key(tmp_path):
    p = tmp_path / "frameworks.json"
    p.write_text(json.dumps({"default": "AIDA", "keyword_rules": {"GOSSIP": ["x"]},
                             "long_form_min_chars": 10}))
    with pytest.raises(ValueError, match="GOSSIP"):
        load_classifier_rules(p)


# --------------------------------------------------------------------------- failed regenerations


def _pending(store: InMemoryStore, regen: str = "PAS") -> None:
    store.insert_article(
        SiteArticleRecord(
            url_hash="a", slug="keep-me", title="Old", body_md="old body",
            status=ArticleStatus.PROCESSING, regen_framework=regen,
        )
    )


def _assert_regen_failed(store: InMemoryStore, flag: str) -> None:
    row = store.get_article("a")
    assert row is not None
    assert row.regen_framework is None and row.status == ArticleStatus.REVIEW_REQUIRED
    assert "REGEN_FAILED" in row.flags and flag in row.flags
    assert row.body_md == "old body" and row.slug == "keep-me" and row.title == "Old"


def test_failed_regeneration_by_validation_is_not_retried_next_run(tmp_path):
    store = RecordingStore()
    _pending(store)
    source = db(tmp_path, ["a"])
    bad = make_generated(body_md="Moreover, the story is a short local update.")
    llm1 = FakeLLM([bad, bad])
    s1 = run(source, store, llm1)
    assert len(llm1.calls) == 2 and s1.failed == 1 and s1.regenerated == 0
    _assert_regen_failed(store, "BANNED_PHRASE:moreover")
    assert store.jobs[-1].stages["validate"] == "fail"
    llm2 = FakeLLM([])
    s2 = run(source, store, llm2)
    assert llm2.calls == [] and s2.failed == 0 and store.generations_today() == 1


def test_failed_regeneration_by_llm_error_is_not_retried_next_run(tmp_path):
    store = RecordingStore()
    _pending(store)
    source = db(tmp_path, ["a"])
    s1 = run(source, store, FakeLLM([LLMError("quota exhausted")]))
    assert s1.failed == 1
    _assert_regen_failed(store, "LLM_ERROR")
    assert store.jobs[-1].error == "quota exhausted"
    llm2 = FakeLLM([])
    run(source, store, llm2)
    assert llm2.calls == []


def test_failed_regeneration_by_unknown_framework_is_not_retried_next_run(tmp_path):
    store = RecordingStore()
    _pending(store, regen="NOT_A_FRAMEWORK")
    source = db(tmp_path, ["a"])
    s1 = run(source, store, FakeLLM([]))
    assert s1.failed == 1
    _assert_regen_failed(store, "REGEN_ERROR")
    assert store.jobs[-1].stages["framework"] == "fail"
    llm2 = FakeLLM([])
    s2 = run(source, store, llm2)
    assert llm2.calls == [] and s2.failed == 0


def test_failing_fail_regeneration_does_not_stop_batch(tmp_path):
    class BadFail(RecordingStore):
        def fail_regeneration(self, url_hash: str, flags: list[str]) -> None:
            raise RuntimeError("site_articles down")

    store = BadFail()
    _pending(store, regen="NOT_A_FRAMEWORK")
    s = run(db(tmp_path, ["a", "b"]), store, gen_llm(1))
    assert store.get_article("b") is not None
    assert s.failed == 1 and s.processed == 1
    assert len(store.jobs) == 2


def test_dry_run_store_fail_regeneration_is_counted_no_op():
    inner = InMemoryStore(now=lambda: NOW)
    inner.insert_article(SiteArticleRecord(url_hash="p", status=ArticleStatus.PROCESSING,
                                           regen_framework="PAS"))
    dry = DryRunStore(inner)
    dry.fail_regeneration("p", ["LLM_ERROR"])
    row = inner.get_article("p")
    assert row is not None and row.regen_framework == "PAS" and row.flags == []
    assert dry.writes["fail_regeneration"] == 1


# --------------------------------------------------------------------------- transient LLM errors


@pytest.mark.parametrize("rules", [None, {}], ids=["in-generate", "in-classify"])
def test_transient_llm_error_stops_batch_without_rows_and_next_run_recovers(tmp_path, rules):
    store = RecordingStore()
    source = db(tmp_path, ["a", "b", "c"])
    llm = FakeLLM([TransientLLMError("Gemini unavailable after retries: 429 RESOURCE_EXHAUSTED")])
    s = run(source, store, llm, rules=rules)
    assert len(llm.calls) == 1  # "b" and "c" were never attempted
    assert store.processed_hashes() == set()  # no FAILED rows
    assert len(store.jobs) == 1
    job_a = store.jobs[0]
    assert job_a.url_hash == "a" and job_a.error is not None and "RESOURCE_EXHAUSTED" in job_a.error
    assert job_a.tokens_in == 0 and store.generations_today() == 0
    assert s.llm_unavailable and s.failed == 1 and s.processed == 0

    if rules == {}:
        from framework_stage.classify import ClassificationOut
        from framework_stage.models import ContentType

        responses: list[object | Exception] = []
        for slug in ("one", "two", "three"):
            responses += [ClassificationOut(content_type=ContentType.GENERAL_NEWS),
                          make_generated(slug=slug)]
        llm2 = FakeLLM(responses)
    else:
        llm2 = FakeLLM([make_generated(slug=x) for x in ("one", "two", "three")])
    s2 = run(source, store, llm2, rules=rules)
    assert s2.processed == 3 and s2.failed == 0 and not s2.llm_unavailable
    for k in "abc":
        row = store.get_article(k)
        assert row is not None and row.status == ArticleStatus.REVIEW_REQUIRED


def test_transient_llm_error_on_regeneration_keeps_it_pending(tmp_path):
    store = RecordingStore()
    _pending(store)
    source = db(tmp_path, ["a", "b"])
    llm = FakeLLM([TransientLLMError("Gemini unavailable after retries: 503 UNAVAILABLE")])
    s = run(source, store, llm)
    assert len(llm.calls) == 1 and s.llm_unavailable and s.failed == 1
    row = store.get_article("a")
    assert row is not None and row.status == ArticleStatus.PROCESSING
    assert row.regen_framework == "PAS" and row.flags == [] and row.body_md == "old body"
    assert store.get_article("b") is None  # batch stopped
    assert store.pending_regenerations() == [("a", "PAS")]
    s2 = run(source, store, gen_llm(2, slug="fresh"))
    assert s2.regenerated == 1 and s2.processed == 1


# --------------------------------------------------------------------------- regenerating failed rows


def _requeue(store: InMemoryStore, url_hash: str, framework: str = "PAS") -> None:
    """What the admin UI does: set PROCESSING and the forced framework."""
    row = store._articles[url_hash]
    store._articles[url_hash] = row.model_copy(
        update={"status": ArticleStatus.PROCESSING, "regen_framework": framework}
    )


def test_regenerating_failed_row_twice_gets_unique_slug_and_cluster(tmp_path):
    store = RecordingStore()
    store.insert_article(SiteArticleRecord(url_hash="z", slug="local-update"))
    source = db(tmp_path, ["a"])
    run(source, store, FakeLLM([LLMError("bad output")]))
    failed = store.get_article("a")
    assert failed is not None and failed.status == ArticleStatus.FAILED and failed.slug is None

    _requeue(store, "a")
    s1 = run(source, store, gen_llm(1), fetch_image=lambda u: "https://img.test/a.jpg")
    row = store.get_article("a")
    assert row is not None and s1.regenerated == 1
    assert row.status == ArticleStatus.REVIEW_REQUIRED
    assert row.slug == "local-update-2" and row.cluster_id == "a"
    assert row.image_url == "https://img.test/a.jpg" and row.simhash is not None

    _requeue(store, "a", "BAB")
    s2 = run(source, store, gen_llm(1))
    again = store.get_article("a")
    assert again is not None and s2.regenerated == 1
    assert again.framework == "BAB" and again.slug == "local-update-2" and again.cluster_id == "a"
    slugs = [r.slug for r in store._articles.values()]
    assert len(slugs) == len(set(slugs))


def test_regenerating_published_slug_row_keeps_slug_and_cluster(tmp_path):
    store = RecordingStore()
    store.insert_article(
        SiteArticleRecord(url_hash="a", slug="live-slug", cluster_id="cl-live",
                          status=ArticleStatus.PROCESSING, regen_framework="PAS")
    )
    s = run(db(tmp_path, ["a"]), store, gen_llm(1, slug="live-slug"))
    row = store.get_article("a")
    assert row is not None and s.regenerated == 1
    assert row.slug == "live-slug" and row.cluster_id == "cl-live"


def test_regeneration_of_thin_source_fails_without_llm_call(tmp_path):
    store = RecordingStore()
    _pending(store)
    llm = FakeLLM([])
    s = run(db(tmp_path, ["a"], a={"content": "  too short  "}), store, llm)
    assert llm.calls == [] and s.failed == 1 and s.regenerated == 0
    _assert_regen_failed(store, "INSUFFICIENT_SOURCE")
    assert len(store.jobs) == 1 and store.jobs[0].stages["generate"] == "skip"



# --------------------------------------------------------------------------- title-only possible duplicates


def test_title_only_match_generates_both_and_flags_the_second(tmp_path):
    store = RecordingStore()
    llm = FakeLLM([make_generated(slug="one"), make_generated(slug="two")])
    source = db(
        tmp_path,
        ["a", "a2"],
        a2={
            "title": "Mumbai protest arrests Monday",
            "content": "Police in Mumbai detained a dozen protesters near the station late on Monday evening.",
            "domain": "other.test",
        },
    )
    s = run(source, store, llm)
    assert len(llm.calls) == 2
    primary, second = store.get_article("a"), store.get_article("a2")
    assert primary is not None and second is not None
    assert primary.status == second.status == ArticleStatus.REVIEW_REQUIRED
    assert primary.also_reported_by == []
    assert second.cluster_id == primary.cluster_id == "a"
    assert "POSSIBLE_DUPLICATE_OF:a" in second.flags
    assert not any(f.startswith("POSSIBLE_DUPLICATE_OF") for f in primary.flags)
    assert second.body_md is not None and second.slug == "two"
    assert s.processed == 2 and s.skipped_duplicate == 0


@pytest.mark.parametrize(
    "t1,t2",
    [
        ("Heavy rain lashes Mumbai, IMD issues orange alert",
         "Heavy rain lashes Chennai, IMD issues orange alert"),
        ("Gold price today in Delhi", "Gold price today in Mumbai"),
        ("India beat Australia in final", "India beat Pakistan in final"),
    ],
)
def test_similar_headlines_for_different_stories_are_never_archived(tmp_path, t1, t2):
    store = RecordingStore()
    source = db(tmp_path, ["a", "c"], a={"title": t1}, c={"title": t2})
    s = run(source, store, FakeLLM([make_generated(slug="one"), make_generated(slug="two")]))
    second = store.get_article("c")
    assert second is not None and second.status != ArticleStatus.ARCHIVED
    assert "POSSIBLE_DUPLICATE_OF:a" in second.flags
    assert s.processed == 2 and s.skipped_duplicate == 0
