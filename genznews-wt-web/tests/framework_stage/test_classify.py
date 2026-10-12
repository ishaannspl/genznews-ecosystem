from types import SimpleNamespace

import pytest
from fakes import FakeLLM

from framework_stage.classify import ClassificationOut, classify_content_type
from framework_stage.llm import GeminiClient, LLMError
from framework_stage.models import ContentType, SourceArticle

RULES = {"PRODUCT_LAUNCH": ["launches", "unveils"], "BRAND_STORY": ["founder story"]}


def _article(title: str, content: str) -> SourceArticle:
    return SourceArticle(
        url_hash="h", source_url="https://x.com/a", domain="x.com",
        original_title=title, original_content=content,
    )


def _classify(article, llm):
    return classify_content_type(
        article, llm, model="m", rules=RULES, long_form_min_chars=1000
    )


def test_long_text_is_long_form_without_llm_call():
    llm = FakeLLM([])
    result = _classify(_article("Anything launches", "x" * 1000), llm)
    assert result == (ContentType.LONG_FORM, 0, 0)
    assert llm.calls == []


def test_keyword_rule_matches_product_launch_without_llm_call():
    llm = FakeLLM([])
    result = _classify(_article("Acme UNVEILS new phone", "short body"), llm)
    assert result == (ContentType.PRODUCT_LAUNCH, 0, 0)
    assert llm.calls == []


def test_falls_through_to_llm_for_ambiguous_article():
    llm = FakeLLM([ClassificationOut(content_type=ContentType.PROBLEM_FOCUSED)])
    result = _classify(_article("Water crisis", "short body"), llm)
    assert result == (ContentType.PROBLEM_FOCUSED, 10, 5)
    assert len(llm.calls) == 1
    assert llm.calls[0]["schema"] is ClassificationOut
    assert llm.calls[0]["model"] == "m"


def test_llm_invalid_content_type_raises_LLMError():
    bad = SimpleNamespace(text='{"content_type": "NOPE"}', usage_metadata=None)
    models = SimpleNamespace(calls=0)

    def generate_content(*, model, contents, config):
        models.calls += 1
        return bad

    models.generate_content = generate_content
    gc = GeminiClient("k", client=SimpleNamespace(models=models), sleep=lambda _s: None)
    with pytest.raises(LLMError):
        _classify(_article("Water crisis", "short body"), gc)
    assert models.calls == 2
