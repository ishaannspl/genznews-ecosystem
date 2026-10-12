import json
import logging
from pathlib import Path

import pytest

from framework_stage.strategy import FRAMEWORKS, load_strategy

PROMPTS_DIR = Path(__file__).resolve().parents[2] / "framework_stage" / "prompts"


def _cfg(tmp_path, **over):
    data = {
        "default": "AIDA",
        "content_types": {"GENERAL_NEWS": "AIDA", "PROBLEM_FOCUSED": "PAS"},
        "niche_overrides": {},
    }
    data.update(over)
    p = tmp_path / "frameworks.json"
    p.write_text(json.dumps(data))
    return p


def test_general_news_maps_to_aida():
    assert load_strategy().select("GENERAL_NEWS") == "AIDA"


def test_problem_focused_maps_to_pas():
    assert load_strategy().select("PROBLEM_FOCUSED") == "PAS"


def test_niche_override_beats_content_type(tmp_path):
    s = load_strategy(_cfg(tmp_path, niche_overrides={"health_wellness": "PAS"}))
    assert s.select("GENERAL_NEWS", niche="health_wellness") == "PAS"


def test_explicit_override_beats_niche_override(tmp_path):
    s = load_strategy(_cfg(tmp_path, niche_overrides={"health_wellness": "PAS"}))
    assert s.select("GENERAL_NEWS", niche="health_wellness", override="QUEST") == "QUEST"


def test_unknown_content_type_falls_back_to_default_and_warns(caplog):
    with caplog.at_level(logging.WARNING):
        assert load_strategy().select("NOPE") == "AIDA"
    assert any("NOPE" in r.getMessage() for r in caplog.records)


def test_override_with_unknown_framework_raises_ValueError():
    with pytest.raises(ValueError):
        load_strategy().select("GENERAL_NEWS", override="BOGUS")


def test_config_with_unknown_framework_raises_ValueError(tmp_path):
    with pytest.raises(ValueError):
        load_strategy(_cfg(tmp_path, content_types={"GENERAL_NEWS": "BOGUS"}))


def test_all_seven_frameworks_have_a_prompt_file():
    assert len(FRAMEWORKS) == 7
    for fw in FRAMEWORKS:
        assert (PROMPTS_DIR / f"{fw.lower()}.md").is_file(), fw
