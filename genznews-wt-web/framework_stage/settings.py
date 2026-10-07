"""Environment-backed configuration for the framework stage."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Literal, cast

from dotenv import load_dotenv

load_dotenv()

_ROOT = Path(__file__).resolve().parent.parent


def _int(name: str, default: int, *, minimum: int = 1) -> int:
    raw = os.getenv(name, str(default))
    try:
        parsed = int(raw)
    except ValueError as exc:
        raise ValueError(f"{name} must be an integer") from exc
    if parsed < minimum:
        raise ValueError(f"{name} must be at least {minimum}")
    return parsed


def _float(name: str, default: float, *, low: float = 0.0, high: float | None = None) -> float:
    raw = os.getenv(name, str(default))
    try:
        parsed = float(raw)
    except ValueError as exc:
        raise ValueError(f"{name} must be a number") from exc
    if parsed < low or (high is not None and parsed > high):
        raise ValueError(f"{name} is out of range")
    return parsed


def _bool(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None or not raw.strip():
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


@dataclass(frozen=True)
class Settings:
    db_path: Path
    supabase_url: str
    supabase_service_key: str = field(repr=False)  # secret: never in repr/logs
    framework_model: str
    classifier_model: str
    daily_generation_cap: int
    run_limit: int
    min_source_chars: int
    auto_publish_enabled: bool
    auto_publish_min_confidence: float
    auto_publish_niches: frozenset[str]
    image_policy: Literal["hotlink", "placeholder"]
    title_jaccard_min: float
    simhash_max_distance: int
    dedup_window_hours: int
    cost_per_mtok_in: float
    cost_per_mtok_out: float
    lock_path: Path


def get_settings() -> Settings:
    image_policy = os.getenv("IMAGE_POLICY", "hotlink").strip().lower()
    if image_policy not in ("hotlink", "placeholder"):
        raise ValueError("IMAGE_POLICY must be 'hotlink' or 'placeholder'")

    niches = frozenset(
        n.strip().lower()
        for n in os.getenv("AUTO_PUBLISH_NICHES", "").split(",")
        if n.strip()
    )
    default_model = os.getenv("GEMINI_MODEL", "gemini-2.0-flash").strip()

    return Settings(
        db_path=Path(os.getenv("STAGE_DB_PATH", str(_ROOT / "articles.db"))),
        supabase_url=os.getenv("SUPABASE_URL", "").strip(),
        supabase_service_key=os.getenv("SUPABASE_SERVICE_KEY", "").strip(),
        framework_model=os.getenv("FRAMEWORK_MODEL", default_model).strip(),
        classifier_model=os.getenv("CLASSIFIER_MODEL", default_model).strip(),
        daily_generation_cap=_int("DAILY_GENERATION_CAP", 50),
        run_limit=_int("RUN_LIMIT", 20),
        min_source_chars=_int("MIN_SOURCE_CHARS", 400),
        auto_publish_enabled=_bool("AUTO_PUBLISH_ENABLED", False),
        auto_publish_min_confidence=_float("AUTO_PUBLISH_MIN_CONFIDENCE", 0.9, high=1.0),
        auto_publish_niches=niches,
        image_policy=cast(Literal["hotlink", "placeholder"], image_policy),
        title_jaccard_min=_float("TITLE_JACCARD_MIN", 0.5, high=1.0),
        simhash_max_distance=_int("SIMHASH_MAX_DISTANCE", 6, minimum=0),
        dedup_window_hours=_int("DEDUP_WINDOW_HOURS", 72),
        cost_per_mtok_in=_float("COST_PER_MTOK_IN", 0.10),
        cost_per_mtok_out=_float("COST_PER_MTOK_OUT", 0.40),
        lock_path=Path(os.getenv("STAGE_LOCK_PATH", str(_ROOT / ".framework_stage.lock"))),
    )
