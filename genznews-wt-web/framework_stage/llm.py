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

from app.openai_fallback import OpenAIError, chat_json

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
    """Structured generation through OpenAI chat completions (JSON mode, schema in the prompt)."""

    def __init__(self, api_key: str, *, chat: Callable[..., tuple[str, int, int]] = chat_json) -> None:
        self._api_key = api_key
        self._chat = chat

    def generate_structured(
        self, *, prompt: str, schema: type[T], model: str
    ) -> LLMResult[T]:
        ask = (
            f"{prompt}\n\nReply with only a JSON object that matches this JSON schema:\n"
            f"{json.dumps(schema.model_json_schema())}"
        )
        tokens_in = tokens_out = 0
        last_error: Exception | None = None
        for _ in range(2):  # initial ask plus one re-ask
            try:
                text, t_in, t_out = self._chat(ask, api_key=self._api_key, model=model)
            except OpenAIError as exc:
                if exc.transient:
                    raise TransientLLMError(f"OpenAI unavailable: {exc}") from exc
                raise LLMError(f"OpenAI API error: {exc}") from exc
            tokens_in += t_in
            tokens_out += t_out
            try:
                return LLMResult(value=schema.model_validate_json(text), tokens_in=tokens_in, tokens_out=tokens_out)
            except ValidationError as exc:
                last_error = exc
                ask = f"{prompt}\n\nYour previous reply was not valid JSON for the required schema. Reply with only valid JSON."
        raise LLMError(f"Invalid structured output after re-ask: {last_error}")


class FallbackClient:
    """Tries `primary`; when it fails for any reason, asks `fallback` instead."""

    def __init__(self, primary: LLMClient, fallback: LLMClient, fallback_model: str) -> None:
        self._primary = primary
        self._fallback = fallback
        self._fallback_model = fallback_model

    def generate_structured(
        self, *, prompt: str, schema: type[T], model: str
    ) -> LLMResult[T]:
        try:
            return self._primary.generate_structured(prompt=prompt, schema=schema, model=model)
        except LLMError:  # overload, quota, or a Gemini-side error such as a retired model
            return self._fallback.generate_structured(
                prompt=prompt, schema=schema, model=self._fallback_model
            )
