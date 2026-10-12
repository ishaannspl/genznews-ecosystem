"""Slug and SEO helpers for generated articles."""

from __future__ import annotations

import re
import unicodedata
from collections.abc import Callable

from app.ai_writer import remove_em_dashes

from framework_stage.models import GeneratedArticle

DESCRIPTION_LIMIT = 155
TITLE_LIMIT = 60


def slugify(text: str) -> str:
    ascii_text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode("ascii")
    slug = re.sub(r"[^a-z0-9]+", "-", ascii_text.lower()).strip("-")
    return slug or "article"


def unique_slug(base: str, exists: Callable[[str], bool]) -> str:
    if not exists(base):
        return base
    n = 2
    while exists(f"{base}-{n}"):
        n += 1
    return f"{base}-{n}"


def truncate_at_word(text: str, limit: int) -> str:
    text = text.strip()
    if len(text) <= limit:
        return text
    cut = text[: limit + 1]
    if cut[-1].isspace():
        # The character after the limit is a space, so text[:limit] ends on a word boundary.
        return cut[:-1].rstrip()
    head = cut[:-1]
    idx = max(head.rfind(" "), head.rfind("\t"), head.rfind("\n"))
    if idx <= 0:
        return ""
    return head[:idx].rstrip()


def _clean(text: str) -> str:
    cleaned = remove_em_dashes(text).replace("--", "-")
    return re.sub(r"\s+", " ", cleaned).strip()


def build_seo(
    generated: GeneratedArticle, slug_exists: Callable[[str], bool]
) -> GeneratedArticle:
    base = slugify(generated.slug) if generated.slug.strip() else ""
    if base in ("", "article") and generated.slug.strip() == "":
        base = slugify(generated.title)
    return generated.model_copy(
        update={
            "slug": unique_slug(base, slug_exists),
            "seo_title": truncate_at_word(_clean(generated.seo_title), TITLE_LIMIT),
            "seo_description": truncate_at_word(
                _clean(generated.seo_description), DESCRIPTION_LIMIT
            ),
        }
    )
