"""Prompt building and article generation for the framework stage."""

from __future__ import annotations

import json
import re
from pathlib import Path

from app.ai_writer import remove_em_dashes
from framework_stage.llm import LLMClient
from framework_stage.models import Claim, GeneratedArticle, SourceArticle
from framework_stage.validate import strip_markdown_rules

_PKG = Path(__file__).resolve().parent
_PROMPTS = _PKG / "prompts"
_BANNED = _PKG / "config" / "banned_phrases.json"
_CLOSE_TAG_RE = re.compile(r"<\s*/\s*source_article\s*>", re.IGNORECASE)


def _banned_phrases() -> list[str]:
    return json.loads(_BANNED.read_text(encoding="utf-8"))


def build_prompt(article: SourceArticle, framework: str, content_type: str) -> str:
    banned = "\n".join(f'  - "{p}"' for p in _banned_phrases())
    header = (_PROMPTS / "_header.md").read_text(encoding="utf-8").format(banned_list=banned)
    template = (_PROMPTS / f"{framework.lower()}.md").read_text(encoding="utf-8")
    safe_text = _CLOSE_TAG_RE.sub(r"<\\/source_article>", article.original_content)
    source = (
        "SOURCE ARTICLE\n"
        f"Content type: {content_type}\n"
        f"Framework key: {framework}\n"
        f"Original title: {article.original_title or ''}\n"
        f"Source URL: {article.source_url}\n"
        "Source text:\n"
        f"<source_article>\n{safe_text}\n</source_article>\n"
    )
    return f"{header}\n{template}\n\n{source}"


def _clean(text: str) -> str:
    return remove_em_dashes(text)


def generate_article(
    article: SourceArticle,
    framework: str,
    content_type: str,
    llm: LLMClient,
    *,
    model: str,
) -> tuple[GeneratedArticle, int, int]:
    prompt = build_prompt(article, framework, content_type)
    result = llm.generate_structured(prompt=prompt, schema=GeneratedArticle, model=model)
    g = result.value
    cleaned = GeneratedArticle(
        title=_clean(g.title),
        slug=_clean(g.slug),
        summary=_clean(g.summary),
        # assemble_body adds its own rule; tables are not part of our format.
        body_md=_clean(strip_markdown_rules(g.body_md)),
        framework=framework,
        content_type=content_type,
        category=article.niche or "",
        tags=[_clean(t) for t in g.tags],
        seo_title=_clean(g.seo_title),
        seo_description=_clean(g.seo_description),
        keywords=[_clean(k) for k in g.keywords],
        claims=[Claim(text=_clean(c.text), source_quote=c.source_quote) for c in g.claims],
    )
    return cleaned, result.tokens_in, result.tokens_out


def assemble_body(tldr: list[str], body_md: str, attribution: str) -> str:
    if len(tldr) != 3:
        raise ValueError(f"tldr must have exactly 3 items, got {len(tldr)}")
    bullets = "\n".join(f"- {item}" for item in tldr)
    return f"**TL;DR**\n\n{bullets}\n\n{body_md.strip()}\n\n---\n\n*{attribution}*\n"
