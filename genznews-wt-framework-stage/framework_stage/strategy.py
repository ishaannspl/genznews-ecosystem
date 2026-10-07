"""Content type to writing framework mapping, driven by config."""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from pathlib import Path

from framework_stage.models import ContentType

logger = logging.getLogger(__name__)

FRAMEWORKS: tuple[str, ...] = ("AIDA", "PAS", "BAB", "4PS", "FAB", "STORYBRAND", "QUEST")
_DEFAULT_PATH = Path(__file__).resolve().parent / "config" / "frameworks.json"


def _check(name: str, where: str) -> str:
    if name not in FRAMEWORKS:
        raise ValueError(f"Unknown framework {name!r} in {where}; expected one of {FRAMEWORKS}")
    return name


@dataclass(frozen=True)
class FrameworkStrategy:
    default: str
    content_types: dict[str, str] = field(default_factory=dict)
    niche_overrides: dict[str, str] = field(default_factory=dict)

    def __post_init__(self) -> None:
        _check(self.default, "default")
        for k, v in self.content_types.items():
            _check(v, f"content_types[{k}]")
        for k, v in self.niche_overrides.items():
            _check(v, f"niche_overrides[{k}]")

    def select(self, content_type: str, niche: str | None = None, override: str | None = None) -> str:
        if override:
            return _check(override, "override")
        if niche and niche in self.niche_overrides:
            return self.niche_overrides[niche]
        if content_type in self.content_types:
            return self.content_types[content_type]
        logger.warning("Unknown content type %s; falling back to %s", content_type, self.default)
        return self.default


def load_strategy(path: Path | None = None) -> FrameworkStrategy:
    data = json.loads((path or _DEFAULT_PATH).read_text(encoding="utf-8"))
    return FrameworkStrategy(
        default=data["default"],
        content_types=dict(data.get("content_types", {})),
        niche_overrides=dict(data.get("niche_overrides", {})),
    )


def load_classifier_rules(path: Path | None = None) -> tuple[dict[str, list[str]], int]:
    """Read `keyword_rules` and `long_form_min_chars` for classify_content_type."""
    data = json.loads((path or _DEFAULT_PATH).read_text(encoding="utf-8"))
    raw_rules = data.get("keyword_rules", {})
    if not isinstance(raw_rules, dict):
        raise ValueError("keyword_rules must be an object")
    valid = {t.value for t in ContentType}
    rules: dict[str, list[str]] = {}
    for key, words in raw_rules.items():
        if key not in valid:
            raise ValueError(
                f"Unknown content type {key!r} in keyword_rules; expected one of {sorted(valid)}"
            )
        if not isinstance(words, list) or not all(isinstance(w, str) for w in words):
            raise ValueError(f"keyword_rules[{key}] must be a list of strings")
        rules[key] = list(words)
    min_chars = data.get("long_form_min_chars", 6000)
    if isinstance(min_chars, bool) or not isinstance(min_chars, int) or min_chars < 1:
        raise ValueError("long_form_min_chars must be a positive integer")
    return rules, min_chars
