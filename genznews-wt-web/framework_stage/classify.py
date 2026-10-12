"""Content-type classification: length rule, keyword rules, then LLM."""

from __future__ import annotations

from pydantic import BaseModel

from framework_stage.llm import LLMClient
from framework_stage.models import ContentType, SourceArticle


class ClassificationOut(BaseModel):
    content_type: ContentType


def classify_content_type(
    article: SourceArticle,
    llm: LLMClient,
    *,
    model: str,
    rules: dict[str, list[str]],
    long_form_min_chars: int,
) -> tuple[ContentType, int, int]:
    content = article.original_content or ""
    title = article.original_title or ""
    if len(content) >= long_form_min_chars:
        return ContentType.LONG_FORM, 0, 0

    haystack = f"{title} {content[:300]}".lower()
    for type_name, keywords in rules.items():
        if any(k.lower() in haystack for k in keywords):
            return ContentType(type_name), 0, 0

    prompt = (
        "Classify this news article into exactly one content_type from: "
        + ", ".join(t.value for t in ContentType)
        + f".\n\nTitle: {title}\n\nContent:\n{content[:1500]}"
    )
    result = llm.generate_structured(prompt=prompt, schema=ClassificationOut, model=model)
    return result.value.content_type, result.tokens_in, result.tokens_out
