from types import SimpleNamespace

import pytest
from google.genai import errors as genai_errors
from pydantic import BaseModel

from framework_stage.llm import GeminiClient, LLMError, TransientLLMError


class Out(BaseModel):
    answer: str


class StubModels:
    def __init__(self, outcomes):
        self.outcomes = list(outcomes)
        self.calls = 0
        self.configs = []

    def generate_content(self, *, model, contents, config):
        self.calls += 1
        self.configs.append(config)
        item = self.outcomes.pop(0)
        if isinstance(item, Exception):
            raise item
        return item


def _resp(text, pt=7, ct=3):
    return SimpleNamespace(
        text=text,
        usage_metadata=SimpleNamespace(prompt_token_count=pt, candidates_token_count=ct),
    )


def _client(outcomes):
    models = StubModels(outcomes)
    sleeps: list[float] = []
    gc = GeminiClient("k", client=SimpleNamespace(models=models), sleep=sleeps.append)
    return gc, models, sleeps


def _503():
    return genai_errors.ServerError(503, {"error": {"message": "UNAVAILABLE"}})


def test_success_reports_tokens_and_uses_json_schema():
    gc, models, _ = _client([_resp('{"answer": "hi"}')])
    r = gc.generate_structured(prompt="p", schema=Out, model="m")
    assert r.value == Out(answer="hi")
    assert (r.tokens_in, r.tokens_out) == (7, 3)
    assert models.configs[0].response_mime_type == "application/json"
    assert models.configs[0].response_schema is Out


def test_none_usage_counts_as_zero():
    resp = SimpleNamespace(text='{"answer": "a"}', usage_metadata=None)
    gc, _, _ = _client([resp])
    r = gc.generate_structured(prompt="p", schema=Out, model="m")
    assert (r.tokens_in, r.tokens_out) == (0, 0)


def test_retries_503_then_succeeds():
    gc, models, sleeps = _client([_503(), _503(), _resp('{"answer": "ok"}')])
    r = gc.generate_structured(prompt="p", schema=Out, model="m")
    assert r.value.answer == "ok"
    assert models.calls == 3
    assert sleeps == [4.0, 8.0]


def test_gives_up_after_two_retries_with_LLMError():
    gc, models, sleeps = _client([_503(), _503(), _503()])
    with pytest.raises(LLMError):
        gc.generate_structured(prompt="p", schema=Out, model="m")
    assert models.calls == 3
    assert sleeps == [4.0, 8.0]


def test_non_json_response_reasked_once_then_LLMError():
    gc, models, _ = _client([_resp("not json"), _resp("still not")])
    with pytest.raises(LLMError):
        gc.generate_structured(prompt="p", schema=Out, model="m")
    assert models.calls == 2


def test_reask_recovers():
    gc, models, _ = _client([_resp("nope"), _resp('{"answer": "b"}')])
    r = gc.generate_structured(prompt="p", schema=Out, model="m")
    assert r.value.answer == "b"
    assert (r.tokens_in, r.tokens_out) == (14, 6)


def _429():
    return genai_errors.ClientError(
        429, {"error": {"code": 429, "message": "Quota exceeded", "status": "RESOURCE_EXHAUSTED"}}
    )


def _504():
    return genai_errors.ServerError(504, {"error": {"message": "deadline", "status": "DEADLINE_EXCEEDED"}})


def test_retries_429_then_succeeds():
    gc, models, sleeps = _client([_429(), _resp('{"answer": "ok"}')])
    r = gc.generate_structured(prompt="p", schema=Out, model="m")
    assert r.value.answer == "ok" and models.calls == 2 and sleeps == [4.0]


def test_429_forever_raises_transient_after_three_calls():
    gc, models, sleeps = _client([_429(), _429(), _429()])
    with pytest.raises(TransientLLMError) as info:
        gc.generate_structured(prompt="p", schema=Out, model="m")
    assert models.calls == 3 and sleeps == [4.0, 8.0]
    assert "RESOURCE_EXHAUSTED" in str(info.value)


def test_504_forever_raises_transient():
    gc, models, sleeps = _client([_504(), _504(), _504()])
    with pytest.raises(TransientLLMError):
        gc.generate_structured(prompt="p", schema=Out, model="m")
    assert models.calls == 3 and sleeps == [4.0, 8.0]


def test_503_exhaustion_is_transient():
    gc, _, _ = _client([_503(), _503(), _503()])
    with pytest.raises(TransientLLMError):
        gc.generate_structured(prompt="p", schema=Out, model="m")


def test_400_client_error_is_not_transient_and_not_retried():
    err = genai_errors.ClientError(400, {"error": {"message": "bad", "status": "INVALID_ARGUMENT"}})
    gc, models, sleeps = _client([err])
    with pytest.raises(LLMError) as info:
        gc.generate_structured(prompt="p", schema=Out, model="m")
    assert not isinstance(info.value, TransientLLMError)
    assert models.calls == 1 and sleeps == []


def test_500_server_error_is_not_transient_and_not_retried():
    err = genai_errors.ServerError(500, {"error": {"message": "internal", "status": "INTERNAL"}})
    gc, models, sleeps = _client([err])
    with pytest.raises(LLMError) as info:
        gc.generate_structured(prompt="p", schema=Out, model="m")
    assert not isinstance(info.value, TransientLLMError)
    assert models.calls == 1 and sleeps == []


def test_api_key_never_in_transient_error_text():
    models = StubModels([_429(), _429(), _429()])
    gc = GeminiClient("SECRET-KEY-123", client=SimpleNamespace(models=models), sleep=lambda s: None)
    with pytest.raises(TransientLLMError) as info:
        gc.generate_structured(prompt="p", schema=Out, model="m")
    assert "SECRET-KEY-123" not in str(info.value)
