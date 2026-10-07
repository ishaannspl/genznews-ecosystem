from __future__ import annotations

from typing import Any

import pytest

from app.openai_fallback import OpenAIError, chat_json


class _Resp:
    def __init__(self, status: int, body: dict[str, Any] | None = None) -> None:
        self.status_code = status
        self._body = body or {}
        self.text = str(body)

    def json(self) -> dict[str, Any]:
        return self._body


def _ok(text: str = '{"a": 1}') -> _Resp:
    return _Resp(200, {"choices": [{"message": {"content": text}}], "usage": {"prompt_tokens": 7, "completion_tokens": 3}})


class _Session:
    def __init__(self, *responses: _Resp) -> None:
        self.responses = list(responses)
        self.calls: list[dict[str, Any]] = []

    def post(self, url: str, **kwargs: Any) -> _Resp:
        self.calls.append({"url": url, **kwargs})
        return self.responses.pop(0)


def test_returns_text_and_token_counts_and_sends_json_mode():
    s = _Session(_ok())
    text, tin, tout = chat_json("hi JSON", api_key="k", model="m", session=s, sleep=lambda _: None)
    assert (text, tin, tout) == ('{"a": 1}', 7, 3)
    call = s.calls[0]
    assert call["headers"]["Authorization"] == "Bearer k"
    assert call["json"]["response_format"] == {"type": "json_object"}
    assert call["json"]["model"] == "m"


def test_retries_transient_then_succeeds():
    s = _Session(_Resp(429), _Resp(503), _ok())
    waits: list[float] = []
    text, _, _ = chat_json("p", api_key="k", model="m", session=s, sleep=waits.append)
    assert text == '{"a": 1}' and len(s.calls) == 3 and len(waits) == 2


def test_gives_up_transient_after_retries():
    s = _Session(_Resp(503), _Resp(503), _Resp(503))
    with pytest.raises(OpenAIError) as e:
        chat_json("p", api_key="k", model="m", session=s, sleep=lambda _: None)
    assert e.value.transient is True


def test_permanent_error_is_not_retried_and_hides_key():
    s = _Session(_Resp(401, {"error": {"message": "bad key"}}))
    with pytest.raises(OpenAIError) as e:
        chat_json("p", api_key="sk-secret", model="m", session=s, sleep=lambda _: None)
    assert e.value.transient is False and len(s.calls) == 1 and "sk-secret" not in str(e.value)
