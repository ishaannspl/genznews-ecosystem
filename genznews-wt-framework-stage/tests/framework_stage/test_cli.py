from __future__ import annotations

import dataclasses
import json
import os
import sys
from pathlib import Path
from typing import Any

import pytest
from fakes import FakeLLM, make_generated, make_source_db

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

import run_framework_stage as cli  # noqa: E402
from framework_stage.classify import ClassificationOut  # noqa: E402
from framework_stage.models import ContentType  # noqa: E402
from framework_stage.settings import get_settings  # noqa: E402
from framework_stage.store import InMemoryStore  # noqa: E402

ENV = {
    "GEMINI_API_KEY": "gem-secret-value",
    "SUPABASE_URL": "https://proj.supabase.co",
    "SUPABASE_SERVICE_KEY": "svc-secret-value",
}


def _never(*args: Any, **kwargs: Any) -> Any:
    raise AssertionError("factory must not be called")


def _settings(tmp_path: Path, **over: Any):
    def factory():
        return dataclasses.replace(
            get_settings(),
            db_path=tmp_path / "articles.db",
            lock_path=tmp_path / "stage.lock",
            min_source_chars=10,
            **over,
        )

    return factory


def test_main_exits_2_when_env_vars_missing(tmp_path, capsys):
    env = {"GEMINI_API_KEY": "gem-secret-value"}
    code = cli.main([], env=env, settings_factory=_settings(tmp_path),
                    llm_factory=_never, store_factory=_never)
    assert code == 2
    err = capsys.readouterr().err
    assert "SUPABASE_URL" in err and "SUPABASE_SERVICE_KEY" in err
    assert "gem-secret-value" not in err


def test_main_exits_2_when_values_are_blank(tmp_path, capsys):
    env = {**ENV, "GEMINI_API_KEY": "   "}
    code = cli.main([], env=env, settings_factory=_settings(tmp_path),
                    llm_factory=_never, store_factory=_never)
    assert code == 2
    out = capsys.readouterr()
    assert "GEMINI_API_KEY" in out.err
    assert "svc-secret-value" not in out.err + out.out


def test_main_exits_3_when_lock_held(tmp_path, capsys):
    (tmp_path / "stage.lock").write_text(str(os.getpid()))
    code = cli.main([], env=ENV, settings_factory=_settings(tmp_path),
                    llm_factory=_never, store_factory=_never)
    assert code == 3
    assert "lock" in capsys.readouterr().err.lower()
    assert (tmp_path / "stage.lock").exists()


# The shipped keyword rules do not match the fixture text, so classify asks the LLM.
CLS = ClassificationOut(content_type=ContentType.GENERAL_NEWS)


def _source(tmp_path: Path) -> None:
    make_source_db(
        tmp_path / "articles.db",
        [
            {"h": "a", "content": "Plenty of words about one story here.", "title": "Alpha one"},
            {"h": "b", "content": "Different words about another event now.", "title": "Beta two",
             "created": "2026-10-04T00:00:00"},
        ],
    )


def test_main_prints_summary_json_and_respects_limit(tmp_path, capsys):
    _source(tmp_path)
    store = InMemoryStore()
    seen: dict[str, str] = {}

    def llm_factory(key: str) -> FakeLLM:
        seen["key"] = key
        return FakeLLM([CLS, make_generated()])

    def store_factory(url: str, key: str) -> InMemoryStore:
        seen["url"] = url
        return store

    code = cli.main(["--limit", "1"], env=ENV, settings_factory=_settings(tmp_path),
                    llm_factory=llm_factory, store_factory=store_factory,
                    fetch_image=lambda u: None)
    assert code == 0
    out = capsys.readouterr().out
    summary = json.loads(out)
    assert summary["processed"] == 1 and summary["cap_reached"] is False
    assert seen == {"key": "gem-secret-value", "url": "https://proj.supabase.co"}
    assert store.processed_hashes() == {"a"}
    assert "secret" not in out
    assert not (tmp_path / "stage.lock").exists()


def test_main_dry_run_writes_nothing(tmp_path, capsys):
    _source(tmp_path)
    store = InMemoryStore()
    code = cli.main(["--dry-run"], env=ENV, settings_factory=_settings(tmp_path),
                    llm_factory=lambda k: FakeLLM([CLS, make_generated(), CLS, make_generated(slug="b")]),
                    store_factory=lambda u, k: store, fetch_image=lambda u: None)
    assert code == 0
    out = json.loads(capsys.readouterr().out)
    assert out["processed"] == 2 and out["dry_run_writes"]["insert_article"] == 2
    assert store.processed_hashes() == set()


def test_main_missing_source_db_exits_1(tmp_path, capsys):
    code = cli.main([], env=ENV, settings_factory=_settings(tmp_path),
                    llm_factory=lambda k: FakeLLM([]), store_factory=lambda u, k: InMemoryStore())
    assert code == 1
    assert "articles database not found" in capsys.readouterr().err
    assert not (tmp_path / "stage.lock").exists()


def test_limit_must_be_positive(tmp_path):
    with pytest.raises(SystemExit):
        cli.main(["--limit", "0"], env=ENV, settings_factory=_settings(tmp_path),
                 llm_factory=_never, store_factory=_never)
