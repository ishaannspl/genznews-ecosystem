"""Exact and near-duplicate detection."""

from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass
from typing import Literal

from framework_stage.models import Fingerprint, KnownArticle, SourceArticle
from framework_stage.normalize import content_hash, normalize_text, normalize_title

_EMPTY_HASH = content_hash("")
_WORD = re.compile(r"[a-z0-9]+")
_MIN_JACCARD_TOKENS = 2


@dataclass(frozen=True)
class DedupResult:
    # EXACT / SAME_STORY (content-level) are archived as duplicates.
    # POSSIBLE_SAME_STORY (headline-only) is still generated and flagged for review:
    # similar headlines often belong to different stories ("rain in Mumbai" vs "Chennai").
    kind: Literal["UNIQUE", "EXACT", "SAME_STORY", "POSSIBLE_SAME_STORY"]
    cluster_id: str
    primary_url_hash: str | None


def simhash64(text: str) -> int:
    """64-bit SimHash over word 3-shingles. Returns 0 for empty text."""
    words = _WORD.findall(normalize_text(text))
    if not words:
        return 0
    if len(words) < 3:
        shingles = [" ".join(words)]
    else:
        shingles = [" ".join(words[i : i + 3]) for i in range(len(words) - 2)]
    counts = [0] * 64
    for sh in shingles:
        h = int.from_bytes(hashlib.md5(sh.encode("utf-8")).digest()[:8], "big")
        for bit in range(64):
            counts[bit] += 1 if (h >> bit) & 1 else -1
    out = 0
    for bit in range(64):
        if counts[bit] > 0:
            out |= 1 << bit
    return out


def hamming(a: int, b: int) -> int:
    return (a ^ b).bit_count()


def fingerprint(article: SourceArticle) -> Fingerprint:
    return Fingerprint(
        content_hash=content_hash(article.original_content),
        norm_title=normalize_title(article.original_title or ""),
        simhash=simhash64(article.original_content),
    )


def _jaccard(a: str, b: str) -> float:
    ta, tb = set(a.split()), set(b.split())
    if len(ta) < _MIN_JACCARD_TOKENS or len(tb) < _MIN_JACCARD_TOKENS:
        return 0.0
    return len(ta & tb) / len(ta | tb)


def find_duplicate(
    article: SourceArticle,
    known: list[KnownArticle],
    *,
    title_jaccard_min: float,
    simhash_max_distance: int,
) -> DedupResult:
    fp = fingerprint(article)
    for k in known:
        if k.url_hash == article.url_hash or (
            fp.content_hash != _EMPTY_HASH and k.fingerprint.content_hash == fp.content_hash
        ):
            return DedupResult("EXACT", k.cluster_id, k.url_hash)
    # Precedence: EXACT over SAME_STORY (SimHash) over POSSIBLE_SAME_STORY (title only).
    for k in known:
        kf = k.fingerprint
        if fp.simhash and kf.simhash and hamming(fp.simhash, kf.simhash) <= simhash_max_distance:
            return DedupResult("SAME_STORY", k.cluster_id, k.url_hash)
    for k in known:
        if _jaccard(fp.norm_title, k.fingerprint.norm_title) >= title_jaccard_min:
            return DedupResult("POSSIBLE_SAME_STORY", k.cluster_id, k.url_hash)
    return DedupResult("UNIQUE", article.url_hash, None)
