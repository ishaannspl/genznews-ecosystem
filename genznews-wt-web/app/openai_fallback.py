"""Minimal OpenAI chat client (plain `requests`) used when Gemini is overloaded."""

from __future__ import annotations

import time
from collections.abc import Callable
from typing import Any

import requests

URL = "https://api.openai.com/v1/chat/completions"
TIMEOUT_SECONDS = 60
_BACKOFF_SECONDS = (3.0, 8.0)
_TRANSIENT = frozenset({408, 409, 429, 500, 502, 503, 504})


class OpenAIError(RuntimeError):
    """OpenAI call failed. `transient` is True for overload, rate limit and timeouts."""

    def __init__(self, message: str, *, transient: bool) -> None:
        super().__init__(message)
        self.transient = transient


def chat_json(
    prompt: str,
    *,
    api_key: str,
    model: str,
    temperature: float = 0.7,
    session: Any = requests,
    sleep: Callable[[float], None] = time.sleep,
) -> tuple[str, int, int]:
    """Ask for a JSON object. Returns (text, prompt_tokens, completion_tokens). The key is never logged."""
    payload = {
        "model": model,
        "messages": [{"role": "user", "content": prompt}],
        "response_format": {"type": "json_object"},
        "temperature": temperature,
    }
    headers = {"Authorization": f"Bearer {api_key}"}
    for attempt in range(len(_BACKOFF_SECONDS) + 1):
        try:
            resp = session.post(URL, headers=headers, json=payload, timeout=TIMEOUT_SECONDS)
        except requests.RequestException as exc:
            status = 0
            failure = f"network error: {type(exc).__name__}"
        else:
            status = resp.status_code
            if status == 200:
                body = resp.json()
                text = (body["choices"][0]["message"]["content"] or "").strip()
                if not text:
                    raise OpenAIError("OpenAI returned an empty response", transient=False)
                usage = body.get("usage") or {}
                return text, int(usage.get("prompt_tokens") or 0), int(usage.get("completion_tokens") or 0)
            failure = f"HTTP {status}"
        transient = status == 0 or status in _TRANSIENT
        if not transient:
            raise OpenAIError(f"OpenAI request failed: {failure}", transient=False)
        if attempt == len(_BACKOFF_SECONDS):
            raise OpenAIError(f"OpenAI unavailable after retries: {failure}", transient=True)
        sleep(_BACKOFF_SECONDS[attempt])
    raise OpenAIError("OpenAI request failed", transient=True)  # pragma: no cover
