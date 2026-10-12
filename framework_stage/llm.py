"""LLM client abstraction and Gemini implementation."""

from __future__ import annotations

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
