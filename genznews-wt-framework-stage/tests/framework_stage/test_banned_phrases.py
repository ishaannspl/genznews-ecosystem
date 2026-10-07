import json
from pathlib import Path

from app.ai_writer import _SYSTEM_PROMPT

_PATH = Path(__file__).resolve().parents[2] / "framework_stage" / "config" / "banned_phrases.json"


def _load() -> list[str]:
    return json.loads(_PATH.read_text(encoding="utf-8"))


def test_list_matches_ai_writer_prompt():
    prompt = _SYSTEM_PROMPT.lower()
    for phrase in _load():
        assert phrase.lower() in prompt, phrase


def test_includes_delve_and_moreover():
    phrases = [p.lower() for p in _load()]
    assert "delve" in phrases
    assert "moreover" in phrases
