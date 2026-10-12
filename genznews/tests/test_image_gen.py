"""Tests for Gemini cover image generation (Gemini client is mocked)."""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from app import image_gen
from app.schemas import GenZArticle


def _article() -> GenZArticle:
    return GenZArticle(
        genz_title="UPI hits 20 billion monthly transactions",
        hook="Your chai money is now officially big data.",
        slug="upi-20-billion",
        niche="digital_marketing_social_media",
    )


def _response(data: bytes | None) -> SimpleNamespace:
    inline = SimpleNamespace(data=data, mime_type="image/png") if data else None
    part = SimpleNamespace(inline_data=inline, text=None if data else "blocked")
    return SimpleNamespace(candidates=[SimpleNamespace(content=SimpleNamespace(parts=[part]))])


def test_prompt_uses_article_and_forbids_text_and_faces():
    prompt = image_gen.build_image_prompt(_article()).lower()
    assert "upi hits 20 billion" in prompt
    assert "no text" in prompt
    assert "real people" in prompt


def test_saves_png_and_returns_path(tmp_path, monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "test-key")
    client = MagicMock()
    client.models.generate_content.return_value = _response(b"\x89PNGdata")
    monkeypatch.setattr(image_gen.genai, "Client", lambda api_key: client)

    path = image_gen.generate_cover_image(_article(), tmp_path)

    assert path is not None
    assert path == tmp_path / "digital_marketing_social_media" / "images" / "upi-20-billion.png"
    assert path.read_bytes() == b"\x89PNGdata"
    assert client.models.generate_content.call_args.kwargs["model"] == "gemini-2.5-flash-image"


def test_model_overridable_by_env(tmp_path, monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "test-key")
    monkeypatch.setenv("GEMINI_IMAGE_MODEL", "custom-image-model")
    client = MagicMock()
    client.models.generate_content.return_value = _response(b"img")
    monkeypatch.setattr(image_gen.genai, "Client", lambda api_key: client)

    image_gen.generate_cover_image(_article(), tmp_path)

    assert client.models.generate_content.call_args.kwargs["model"] == "custom-image-model"


def test_returns_none_when_no_image_returned(tmp_path, monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "test-key")
    client = MagicMock()
    client.models.generate_content.return_value = _response(None)
    monkeypatch.setattr(image_gen.genai, "Client", lambda api_key: client)

    assert image_gen.generate_cover_image(_article(), tmp_path) is None


def test_returns_none_when_gemini_raises(tmp_path, monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "test-key")
    client = MagicMock()
    client.models.generate_content.side_effect = RuntimeError("boom")
    monkeypatch.setattr(image_gen.genai, "Client", lambda api_key: client)
    monkeypatch.setattr(image_gen.time, "sleep", lambda s: None)

    assert image_gen.generate_cover_image(_article(), tmp_path) is None


def test_returns_none_without_api_key(tmp_path, monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "")
    assert image_gen.generate_cover_image(_article(), tmp_path) is None
