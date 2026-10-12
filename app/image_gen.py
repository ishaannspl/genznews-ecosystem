"""Gemini-powered cover image generation for AajKiJanta articles."""

from __future__ import annotations

import os
import re
import time
from pathlib import Path

from dotenv import load_dotenv
from google import genai
from google.genai import types

from .schemas import GenZArticle

load_dotenv()

DEFAULT_IMAGE_MODEL = "gemini-2.5-flash-image"
_MAX_ATTEMPTS = 3

_STYLE = (
    "Bold, modern editorial illustration with a vibrant Gen Z graphic style: "
    "flat shapes, punchy colors, strong composition, 16:9 landscape cover. "
    "Constraints: no text, no letters, no logos, no watermarks, "
    "and no real people or recognisable faces."
)


def build_image_prompt(article: GenZArticle) -> str:
    """Build a text-free editorial illustration prompt from the article."""
    return (
        f"Cover image for a news story titled: {article.genz_title}\n"
        f"Story hook: {article.hook}\n"
        f"{_STYLE}"
    )


def _image_bytes(response: object) -> bytes | None:
    for candidate in getattr(response, "candidates", None) or []:
        content = getattr(candidate, "content", None)
        for part in getattr(content, "parts", None) or []:
            inline = getattr(part, "inline_data", None)
            data = getattr(inline, "data", None)
            if data:
                return data
    return None


def generate_cover_image(article: GenZArticle, output_dir: Path) -> Path | None:
    """
    Generate a cover image with Gemini and save it under
    <output_dir>/<niche>/images/<slug>.png.

    Returns the saved path, or None on any failure so the text pipeline
    is never blocked by image problems.
    """
    api_key = os.getenv("GEMINI_API_KEY", "").strip()
    if not api_key:
        print("    [Image] GEMINI_API_KEY not set, skipping image.")
        return None

    model = os.getenv("GEMINI_IMAGE_MODEL", DEFAULT_IMAGE_MODEL).strip() or DEFAULT_IMAGE_MODEL
    client = genai.Client(api_key=api_key)
    prompt = build_image_prompt(article)

    data: bytes | None = None
    wait = 4
    for attempt in range(_MAX_ATTEMPTS):
        try:
            response = client.models.generate_content(
                model=model,
                contents=prompt,
                config=types.GenerateContentConfig(response_modalities=["IMAGE"]),
            )
            data = _image_bytes(response)
            if data is None:
                print("    [Image] Gemini returned no image (possibly blocked).")
                return None
            break
        except Exception as exc:
            if attempt == _MAX_ATTEMPTS - 1:
                print(f"    [Image] Generation failed: {exc}")
                return None
            print(f"    [Image] Error, retrying in {wait}s... ({attempt + 1}/{_MAX_ATTEMPTS})")
            time.sleep(wait)
            wait *= 2

    if data is None:
        return None

    slug = re.sub(r"[^a-z0-9-]+", "-", (article.slug or "article").lower()).strip("-") or "article"
    niche = re.sub(r"[^a-z0-9_-]+", "-", (article.niche or "general").lower()).strip("-") or "general"
    path = output_dir / niche / "images" / f"{slug}.png"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    return path
