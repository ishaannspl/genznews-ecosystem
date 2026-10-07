"""Text normalization helpers for dedup."""

from __future__ import annotations

import hashlib
import re

STOPWORDS: frozenset[str] = frozenset(
    """a an the and or but of in on at to for from by with as is are was were be been
    it its this that these those has have had will would can could says say said
    after before over into than then up out about""".split()
)

_NON_ALNUM = re.compile(r"[^a-z0-9\s]+")
_WS = re.compile(r"\s+")


def title_tokens(title: str) -> frozenset[str]:
    cleaned = _NON_ALNUM.sub(" ", title.lower())
    return frozenset(t for t in _WS.split(cleaned.strip()) if t and t not in STOPWORDS)


def normalize_title(title: str) -> str:
    """Lowercase, strip punctuation, drop stopwords; unique tokens sorted."""
    return " ".join(sorted(title_tokens(title)))


def normalize_text(text: str) -> str:
    return _WS.sub(" ", text.lower()).strip()


def content_hash(text: str) -> str:
    return hashlib.sha256(normalize_text(text).encode("utf-8")).hexdigest()
