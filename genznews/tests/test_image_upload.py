"""Tests for uploading cover images to Supabase Storage (client is mocked)."""

from __future__ import annotations

from unittest.mock import MagicMock

from app import database


def _client(public_url: str = "https://x.supabase.co/storage/v1/object/public/article-images/n/s.png"):
    client = MagicMock()
    bucket = client.storage.from_.return_value
    bucket.get_public_url.return_value = public_url
    return client, bucket


def test_upload_returns_public_url(tmp_path):
    img = tmp_path / "s.png"
    img.write_bytes(b"pngbytes")
    client, bucket = _client()

    url = database.upload_image(client, img, "n/s.png")

    client.storage.from_.assert_called_with("article-images")
    args = bucket.upload.call_args
    assert args.args[0] == "n/s.png"
    assert args.args[1] == b"pngbytes"
    assert args.args[2]["content-type"] == "image/png"
    assert url is not None and url.endswith("/n/s.png")


def test_upload_returns_none_on_error(tmp_path):
    img = tmp_path / "s.png"
    img.write_bytes(b"x")
    client, bucket = _client()
    bucket.upload.side_effect = RuntimeError("bucket missing")

    assert database.upload_image(client, img, "n/s.png") is None


def test_upload_returns_none_when_file_missing(tmp_path):
    client, _ = _client()
    assert database.upload_image(client, tmp_path / "nope.png", "n/s.png") is None
