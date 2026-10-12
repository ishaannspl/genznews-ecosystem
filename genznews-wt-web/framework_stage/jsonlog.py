"""One-JSON-line-per-stage structured logging.

Only identifiers, the stage name, its duration and its status are logged.
Article bodies, source text and credentials are never passed to this module.
"""

from __future__ import annotations

import json
import logging
from datetime import UTC, datetime
from typing import IO, Any

STAGE_LOGGER_NAME = "framework_stage.stage"
_EVENT_ATTR = "stage_event"


def get_stage_logger() -> logging.Logger:
    return logging.getLogger(STAGE_LOGGER_NAME)


def log_stage(
    logger: logging.Logger,
    *,
    job_id: str,
    url_hash: str,
    stage: str,
    duration_ms: int,
    status: str,
) -> None:
    event: dict[str, Any] = {
        "job_id": job_id,
        "url_hash": url_hash,
        "stage": stage,
        "duration_ms": duration_ms,
        "status": status,
    }
    logger.info(json.dumps(event, sort_keys=True), extra={_EVENT_ATTR: event})


class JsonLineFormatter(logging.Formatter):
    """Formats stage events (and any other record) as a single JSON line."""

    def format(self, record: logging.LogRecord) -> str:
        event: Any = getattr(record, _EVENT_ATTR, None)
        payload: dict[str, Any] = dict(event) if isinstance(event, dict) else {
            "message": record.getMessage()
        }
        payload["level"] = record.levelname
        payload["ts"] = datetime.fromtimestamp(record.created, UTC).isoformat()
        return json.dumps(payload, sort_keys=True)


def configure_json_logging(stream: IO[str]) -> logging.Handler:
    """Attach a JSON-line handler to the stage logger (idempotent per stream)."""
    logger = get_stage_logger()
    for h in logger.handlers:
        if isinstance(h, logging.StreamHandler) and getattr(h, "stream", None) is stream:
            return h
    handler = logging.StreamHandler(stream)
    handler.setFormatter(JsonLineFormatter())
    logger.addHandler(handler)
    logger.setLevel(logging.INFO)
    return handler
