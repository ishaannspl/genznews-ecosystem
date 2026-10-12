from __future__ import annotations

import pytest
from pydantic import BaseModel

from app.openai_fallback import OpenAIError
from framework_stage.llm import FallbackClient, LLMError, LLMResult, OpenAIClient, TransientLLMError


class Out(BaseModel):
    title: str


class _Primary:
    def __init__(self, exc: Exception | None) -> None:
        self.exc, self.calls = exc, 0

    def generate_structured(self, *, prompt, schema, model):
        self.calls += 1
        if self.exc:
            raise self.exc
        return LLMResult(value=Out(title="gemini"), tokens_in=1, tokens_out=1)


def _chat(replies):
    seen = []

    def chat(prompt, *, api_key, model):
        seen.append((prompt, model))
        r = replies.pop(0)
        if isinstance(r, Exception):
            raise r
        return r, 5, 2

    return chat, seen


def test_openai_client_validates_and_re_asks_once():
    chat, seen = _chat(['{"nope": 1}', '{"title": "ok"}'])
    res = OpenAIClient("k", chat=chat).generate_structured(prompt="p", schema=Out, model="gpt-x")
    assert res.value.title == "ok" and (res.tokens_in, res.tokens_out) == (10, 4)
    assert seen[0][1] == "gpt-x" and '"title"' in seen[0][0]  # schema is in the prompt


def test_openai_client_maps_errors():
    chat, _ = _chat([OpenAIError("x", transient=True)])
    with pytest.raises(TransientLLMError):
        OpenAIClient("k", chat=chat).generate_structured(prompt="p", schema=Out, model="m")
    chat, _ = _chat([OpenAIError("x", transient=False)])
    with pytest.raises(LLMError) as e:
        OpenAIClient("k", chat=chat).generate_structured(prompt="p", schema=Out, model="m")
    assert not isinstance(e.value, TransientLLMError)


def test_fallback_used_only_on_transient_failure():
    chat, seen = _chat(['{"title": "gpt"}'])
    fb = OpenAIClient("k", chat=chat)
    ok = FallbackClient(_Primary(None), fb, "gpt-m")
    assert ok.generate_structured(prompt="p", schema=Out, model="g").value.title == "gemini" and not seen
    over = FallbackClient(_Primary(TransientLLMError("busy")), fb, "gpt-m")
    assert over.generate_structured(prompt="p", schema=Out, model="g").value.title == "gpt"
    assert seen[0][1] == "gpt-m"


def test_any_primary_llm_error_falls_back_but_other_exceptions_do_not():
    chat, seen = _chat(['{"title": "gpt"}'])
    fb = OpenAIClient("k", chat=chat)
    out = FallbackClient(_Primary(LLMError("404 model gone")), fb, "m").generate_structured(prompt="p", schema=Out, model="g")
    assert out.value.title == "gpt" and len(seen) == 1
    with pytest.raises(KeyError):
        FallbackClient(_Primary(KeyError("bug")), fb, "m").generate_structured(prompt="p", schema=Out, model="g")
