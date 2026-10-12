"""CLI for the framework stage.

Reads unprocessed rows from the pipeline's SQLite `articles` table, rewrites them
with a writing framework, and stores them in Supabase `site_articles` for review.

    python run_framework_stage.py [--limit N] [--dry-run]

Exit codes: 0 ok, 1 runtime error (e.g. articles.db missing), 2 missing or
invalid configuration, 3 another run holds the lock.
"""

from __future__ import annotations

import argparse
import dataclasses
import json
import os
import sys
from collections.abc import Callable, Mapping, Sequence
from datetime import UTC, datetime
from typing import Any

from framework_stage.dry_run import DryRunStore
from framework_stage.images import fetch_og_image
from framework_stage.jsonlog import configure_json_logging, get_stage_logger
from framework_stage.llm import GeminiClient, LLMClient
from framework_stage.lock import LockHeldError, file_lock
from framework_stage.runner import run_stage
from framework_stage.settings import Settings, get_settings
from framework_stage.store import SiteStore, SupabaseStore
from framework_stage.strategy import load_classifier_rules, load_strategy

REQUIRED_ENV: tuple[str, ...] = ("GEMINI_API_KEY", "SUPABASE_URL", "SUPABASE_SERVICE_KEY")


def _gemini(api_key: str) -> LLMClient:
    return GeminiClient(api_key)


def _supabase(url: str, service_key: str) -> SiteStore:
    import supabase

    return SupabaseStore(supabase.create_client(url, service_key))


def _utc_now() -> datetime:
    return datetime.now(UTC)


def _positive_int(raw: str) -> int:
    try:
        value = int(raw)
    except ValueError as exc:
        raise argparse.ArgumentTypeError("must be an integer") from exc
    if value < 1:
        raise argparse.ArgumentTypeError("must be at least 1")
    return value


def _parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="Run the GenZNews framework stage once.")
    p.add_argument("--limit", type=_positive_int, help="max new articles this run")
    p.add_argument(
        "--dry-run",
        action="store_true",
        help="run every stage (including LLM calls) but skip all store writes",
    )
    return p


def main(
    argv: Sequence[str] | None = None,
    *,
    env: Mapping[str, str] | None = None,
    settings_factory: Callable[[], Settings] = get_settings,
    llm_factory: Callable[[str], LLMClient] = _gemini,
    store_factory: Callable[[str, str], SiteStore] = _supabase,
    fetch_image: Callable[[str], str | None] = fetch_og_image,
    now: Callable[[], datetime] = _utc_now,
) -> int:
    args = _parser().parse_args(argv)
    environ: Mapping[str, str] = os.environ if env is None else env

    missing = [name for name in REQUIRED_ENV if not environ.get(name, "").strip()]
    if missing:
        print(
            "framework stage: missing required environment variables: " + ", ".join(missing),
            file=sys.stderr,
        )
        return 2

    try:
        settings = settings_factory()
    except ValueError as exc:
        print(f"framework stage: invalid configuration: {exc}", file=sys.stderr)
        return 2
    if args.limit is not None:
        settings = dataclasses.replace(settings, run_limit=args.limit)

    handler = configure_json_logging(sys.stderr)
    try:
        with file_lock(settings.lock_path):
            llm = llm_factory(environ["GEMINI_API_KEY"].strip())
            real_store = store_factory(
                environ["SUPABASE_URL"].strip(), environ["SUPABASE_SERVICE_KEY"].strip()
            )
            store: SiteStore = DryRunStore(real_store) if args.dry_run else real_store
            rules, long_form_min_chars = load_classifier_rules()
            summary = run_stage(
                source_db=settings.db_path,
                store=store,
                llm=llm,
                settings=settings,
                strategy=load_strategy(),
                fetch_image=fetch_image,
                now=now,
                classifier_rules=rules,
                long_form_min_chars=long_form_min_chars,
            )
    except LockHeldError:
        print(
            f"framework stage: another run holds the lock at {settings.lock_path}",
            file=sys.stderr,
        )
        return 3
    except FileNotFoundError as exc:
        print(f"framework stage: {exc}", file=sys.stderr)
        return 1
    finally:
        get_stage_logger().removeHandler(handler)

    out: dict[str, Any] = summary.model_dump()
    if isinstance(store, DryRunStore):
        out["dry_run_writes"] = dict(store.writes)
    print(json.dumps(out, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
