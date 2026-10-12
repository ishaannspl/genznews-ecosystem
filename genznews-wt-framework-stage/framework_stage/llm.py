"""LLM client abstraction and Gemini implementation."""

from __future__ import annotations

import json
import time
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any, Generic, Protocol, TypeVar

import google.genai as genai
from google.genai import errors as genai_errors
from google.genai import types
from pydantic import BaseModel, ValidationError

T = TypeVar("T", bound=BaseModel)


class LLMError(Exception):
    """Raised when the LLM call fails or returns unusable output."""


class TransientLLMError(LLMError):
    """The provider is temporarily unavailable (quota, overload, deadline) after retries.

    Callers should retry the work later rather than mark it permanently failed.
    """


_TRANSIENT_CODES = frozenset({429, 503, 504})
_TRANSIENT_STATUSES = frozenset({"RESOURCE_EXHAUSTED", "UNAVAILABLE", "DEADLINE_EXCEEDED"})
_TRANSIENT_TEXT = ("503", "UNAVAILABLE", "429", "RESOURCE_EXHAUSTED", "504", "DEADLINE_EXCEEDED")


def _is_transient(exc: Exception) -> bool:
    code = getattr(exc, "code", None)
    status = getattr(exc, "status", None)
    if isinstance(code, int) and code in _TRANSIENT_CODES:
        return True
    if isinstance(status, str) and status.upper() in _TRANSIENT_STATUSES:
        return True
    if isinstance(code, int) or isinstance(status, str):
        return False
    text = str(exc)
    return any(t in text for t in _TRANSIENT_TEXT)


@dataclass
class LLMResult(Generic[T]):
    value: T
    tokens_in: int
    tokens_out: int


class LLMClient(Protocol):
    def generate_structured(
        self, *, prompt: str, schema: type[T], model: str
    ) -> LLMResult[T]: ...


class GeminiClient:
    MAX_RETRIES = 2
    BASE_BACKOFF = 4.0

    def __init__(
        self,
        api_key: str,
        *,
        client: Any | None = None,
        sleep: Callable[[float], None] = time.sleep,
    ) -> None:
        self._client: Any = client if client is not None else genai.Client(api_key=api_key)
        self._sleep = sleep

    def _call(self, prompt: str, schema: type[BaseModel], model: str) -> Any:
        wait = self.BASE_BACKOFF
        for attempt in range(self.MAX_RETRIES + 1):
            try:
                return self._client.models.generate_content(
                    model=model,
                    contents=prompt,
                    config=types.GenerateContentConfig(
                        response_mime_type="application/json",
                        response_schema=schema,
                    ),
                )
            except genai_errors.APIError as exc:
                if not _is_transient(exc):
                    raise LLMError(f"Gemini API error: {exc}") from exc
                if attempt >= self.MAX_RETRIES:
                    raise TransientLLMError(f"Gemini unavailable after retries: {exc}") from exc
                self._sleep(wait)
                wait *= 2
        raise LLMError("Gemini request failed")  # pragma: no cover

    def generate_structured(
        self, *, prompt: str, schema: type[T], model: str
    ) -> LLMResult[T]:
        tokens_in = 0
        tokens_out = 0
        current = prompt
        last_error: Exception | None = None
        for _ in range(2):  # initial ask plus one re-ask
            response = self._call(current, schema, model)
            usage = getattr(response, "usage_metadata", None)
            tokens_in += getattr(usage, "prompt_token_count", None) or 0
            tokens_out += getattr(usage, "candidates_token_count", None) or 0
            text = (getattr(response, "text", None) or "").strip()
            try:
                value = schema.model_validate_json(text)
            except ValidationError as exc:
                last_error = exc
                current = (
                    prompt
                    + "\n\nYour previous reply was not valid JSON for the required "
                    "schema. Reply with only valid JSON matching the schema."
                )
                continue
            return LLMResult(value=value, tokens_in=tokens_in, tokens_out=tokens_out)
        raise LLMError(f"Invalid structured output after re-ask: {last_error}")


class OpenAIClient:
    """OpenAI chat-completions client (JSON mode). Ignores the caller's model name."""

    MAX_RETRIES = 2
    BASE_BACKOFF = 4.0
    URL = "https://api.openai.com/v1/chat/completions"

    def __init__(
        self,
        api_key: str,
        model: str = "gpt-4o-mini",
        *,
        http: Any | None = None,
        sleep: Callable[[float], None] = time.sleep,
    ) -> None:
        import httpx

        self._http: Any = http if http is not None else httpx.Client(timeout=120)
        self._key = api_key
        self._model = model
        self._sleep = sleep

    def _post(self, prompt: str, schema: type[BaseModel]) -> dict[str, Any]:
        body = {
            "model": self._model,
            "response_format": {"type": "json_object"},
            "messages": [
                {
                    "role": "system",
                    "content": "Reply with only a JSON object matching this JSON schema:\n"
                    + json.dumps(schema.model_json_schema()),
                },
                {"role": "user", "content": prompt},
            ],
        }
        wait = self.BASE_BACKOFF
        for attempt in range(self.MAX_RETRIES + 1):
            try:
                resp = self._http.post(
                    self.URL, headers={"Authorization": f"Bearer {self._key}"}, json=body
                )
            except Exception as exc:  # network errors are transient
                if attempt >= self.MAX_RETRIES:
                    raise TransientLLMError(f"OpenAI unreachable: {exc}") from exc
                self._sleep(wait)
                wait *= 2
                continue
            if resp.status_code == 200:
                return resp.json()
            if resp.status_code in _TRANSIENT_CODES or resp.status_code >= 500:
                if attempt >= self.MAX_RETRIES:
                    raise TransientLLMError(f"OpenAI unavailable: {resp.status_code}")
                self._sleep(wait)
                wait *= 2
                continue
            raise LLMError(f"OpenAI API error {resp.status_code}: {resp.text[:300]}")
        raise LLMError("OpenAI request failed")  # pragma: no cover

    def generate_structured(
        self, *, prompt: str, schema: type[T], model: str
    ) -> LLMResult[T]:
        tokens_in = tokens_out = 0
        current = prompt
        last_error: Exception | None = None
        for _ in range(2):
            data = self._post(current, schema)
            usage = data.get("usage") or {}
            tokens_in += usage.get("prompt_tokens") or 0
            tokens_out += usage.get("completion_tokens") or 0
            text = (data["choices"][0]["message"].get("content") or "").strip()
            try:
                value = schema.model_validate_json(text)
            except ValidationError as exc:
                last_error = exc
                current = prompt + "\n\nYour previous reply was not valid JSON for the schema. Reply with only valid JSON."
                continue
            return LLMResult(value=value, tokens_in=tokens_in, tokens_out=tokens_out)
        raise LLMError(f"Invalid structured output after re-ask: {last_error}")


class FallbackLLMClient:
    """Use `primary`; when it is transiently unavailable (quota, overload), use `fallback`."""

    def __init__(self, primary: LLMClient, fallback: LLMClient) -> None:
        self._primary = primary
        self._fallback = fallback

    def generate_structured(
        self, *, prompt: str, schema: type[T], model: str
    ) -> LLMResult[T]:
        try:
            return self._primary.generate_structured(prompt=prompt, schema=schema, model=model)
        except TransientLLMError:
            return self._fallback.generate_structured(prompt=prompt, schema=schema, model=model)
