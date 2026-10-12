from __future__ import annotations

from typing import Any

import pytest
import requests

from framework_stage.images import fetch_og_image, is_public_http_url

PUBLIC_IP = "93.184.216.34"


def resolver_for(mapping: dict[str, list[str]] | None = None, default: str = PUBLIC_IP):
    mapping = mapping or {}

    def resolve(host: str, *args: Any, **kwargs: Any) -> list[tuple[Any, ...]]:
        ips = mapping.get(host, [default])
        return [(2, 1, 6, "", (ip, 0)) for ip in ips]

    return resolve


def failing_resolver(host: str, *args: Any, **kwargs: Any) -> list[tuple[Any, ...]]:
    raise OSError("no such host")


class FakeResponse:
    def __init__(
        self,
        body: bytes = b"",
        status_code: int = 200,
        headers: dict[str, str] | None = None,
    ) -> None:
        self.status_code = status_code
        self.headers = headers if headers is not None else {"Content-Type": "text/html; charset=utf-8"}
        self._body = body
        self.closed = False
        self.bytes_served = 0

    def iter_content(self, chunk_size: int = 1, decode_unicode: bool = False):
        for i in range(0, len(self._body), chunk_size):
            chunk = self._body[i : i + chunk_size]
            self.bytes_served += len(chunk)
            yield chunk

    def close(self) -> None:
        self.closed = True


def html_with(tag: str) -> bytes:
    return f"<html><head>{tag}</head><body>x</body></html>".encode()


def redirect(location: str, status: int = 302) -> FakeResponse:
    return FakeResponse(status_code=status, headers={"Location": location})


class Getter:
    def __init__(self, responses: list[Any]) -> None:
        self.responses = list(responses)
        self.calls: list[tuple[str, dict[str, Any]]] = []

    def __call__(self, url: str, **kwargs: Any) -> FakeResponse:
        self.calls.append((url, kwargs))
        item = self.responses.pop(0)
        if isinstance(item, Exception):
            raise item
        return item


@pytest.mark.parametrize(
    "url",
    [
        "http://127.0.0.1/x",
        "http://10.1.2.3/x",
        "http://192.168.1.1/x",
        "http://169.254.169.254/latest/meta-data",
        "http://[::1]/x",
        "http://[::ffff:127.0.0.1]/x",
        "http://0.0.0.0/x",
        "http://localhost/x",
        "http://foo.local/x",
        "http://db.internal/x",
        "http://224.0.0.1/x",
    ],
)
def test_rejects_localhost_and_private_ranges(url: str) -> None:
    assert is_public_http_url(url, resolver=resolver_for()) is False


@pytest.mark.parametrize(
    "url",
    [
        "ftp://example.com/x",
        "file:///etc/passwd",
        "javascript:alert(1)",
        "gopher://example.com",
        "//example.com/x",
        "http:///nohost",
        "http://user:pw@example.com/x",
        "",
    ],
)
def test_rejects_non_http_schemes(url: str) -> None:
    assert is_public_http_url(url, resolver=resolver_for()) is False


def test_accepts_public_http_and_https() -> None:
    assert is_public_http_url("https://example.com/a", resolver=resolver_for()) is True
    assert is_public_http_url("http://example.com/a", resolver=resolver_for()) is True
    assert is_public_http_url("http://93.184.216.34/a", resolver=failing_resolver) is True


def test_hostname_resolving_to_private_ip_is_rejected() -> None:
    assert is_public_http_url("https://evil.example/x", resolver=resolver_for({"evil.example": ["10.0.0.5"]})) is False
    # any non-global address among several rejects
    mixed = resolver_for({"mix.example": [PUBLIC_IP, "127.0.0.1"]})
    assert is_public_http_url("https://mix.example/x", resolver=mixed) is False
    mapped = resolver_for({"m.example": ["::ffff:10.0.0.1"]})
    assert is_public_http_url("https://m.example/x", resolver=mapped) is False


def test_resolution_failure_is_rejected() -> None:
    assert is_public_http_url("https://nope.example/x", resolver=failing_resolver) is False


def test_redirect_to_private_ip_is_not_followed() -> None:
    get = Getter([redirect("http://169.254.169.254/latest/meta-data")])
    assert fetch_og_image("https://example.com/a", get=get, resolver=resolver_for()) is None
    assert len(get.calls) == 1


def test_first_hop_private_never_requested() -> None:
    get = Getter([])
    assert fetch_og_image("http://127.0.0.1/a", get=get, resolver=resolver_for()) is None
    assert get.calls == []


def test_redirect_limit_is_three() -> None:
    ok = FakeResponse(html_with('<meta property="og:image" content="https://img.example/a.jpg">'))
    three = Getter([redirect("/b"), redirect("/c"), redirect("/d"), ok])
    assert (
        fetch_og_image("https://example.com/a", get=three, resolver=resolver_for())
        == "https://img.example/a.jpg"
    )
    assert len(three.calls) == 4
    four = Getter([redirect("/b"), redirect("/c"), redirect("/d"), redirect("/e"), ok])
    assert fetch_og_image("https://example.com/a", get=four, resolver=resolver_for()) is None
    assert len(four.calls) == 4


def test_reads_at_most_512kb_and_5s_timeout() -> None:
    big = b"<html><head>" + b"a" * (2 * 1024 * 1024)
    resp = FakeResponse(big)
    get = Getter([resp])
    assert fetch_og_image("https://example.com/a", get=get, resolver=resolver_for()) is None
    _, kwargs = get.calls[0]
    assert kwargs["timeout"] == 5
    assert kwargs["stream"] is True
    assert kwargs["allow_redirects"] is False
    assert kwargs["headers"]["User-Agent"] == "GenZNewsFrameworkStage/0.1"
    assert resp.closed is True
    assert resp.bytes_served <= 524288 + 8192


def test_og_image_beyond_512kb_is_not_seen() -> None:
    body = b"<html><head>" + b" " * 600000 + b'<meta property="og:image" content="https://i.example/a.jpg">'
    get = Getter([FakeResponse(body)])
    assert fetch_og_image("https://example.com/a", get=get, resolver=resolver_for()) is None


def test_extracts_og_image_and_resolves_relative_url() -> None:
    page = html_with('<meta property="og:image" content="  /img/cover.jpg ">')
    get = Getter([FakeResponse(page)])
    assert (
        fetch_og_image("https://example.com/news/a", get=get, resolver=resolver_for())
        == "https://example.com/img/cover.jpg"
    )


def test_relative_resolves_against_final_url_after_redirect() -> None:
    page = html_with('<meta property="og:image" content="cover.jpg">')
    get = Getter([redirect("https://other.example/path/x"), FakeResponse(page)])
    assert (
        fetch_og_image("https://example.com/a", get=get, resolver=resolver_for())
        == "https://other.example/path/cover.jpg"
    )


def test_fallback_priority() -> None:
    page = html_with(
        '<meta property="og:image:secure_url" content="https://a.example/secure.jpg">'
        '<meta name="og:image" content="https://a.example/name.jpg">'
        '<meta property="og:image" content="https://a.example/main.jpg">'
        '<meta property="og:image" content="https://a.example/second.jpg">'
    )
    assert (
        fetch_og_image("https://example.com/a", get=Getter([FakeResponse(page)]), resolver=resolver_for())
        == "https://a.example/main.jpg"
    )
    page2 = html_with(
        '<meta property="og:image:secure_url" content="https://a.example/secure.jpg">'
        '<meta name="og:image" content="https://a.example/name.jpg">'
    )
    assert (
        fetch_og_image("https://example.com/a", get=Getter([FakeResponse(page2)]), resolver=resolver_for())
        == "https://a.example/name.jpg"
    )
    page3 = html_with('<meta property="og:image:secure_url" content="https://a.example/secure.jpg">')
    assert (
        fetch_og_image("https://example.com/a", get=Getter([FakeResponse(page3)]), resolver=resolver_for())
        == "https://a.example/secure.jpg"
    )


def test_returns_none_when_no_og_image_or_on_any_request_error() -> None:
    no_tag = FakeResponse(html_with('<meta property="og:title" content="t">'))
    assert fetch_og_image("https://example.com/a", get=Getter([no_tag]), resolver=resolver_for()) is None
    boom = Getter([requests.ConnectionError("down")])
    assert fetch_og_image("https://example.com/a", get=boom, resolver=resolver_for()) is None
    timeout = Getter([requests.Timeout("slow")])
    assert fetch_og_image("https://example.com/a", get=timeout, resolver=resolver_for()) is None


def test_non_html_content_type_returns_none() -> None:
    page = html_with('<meta property="og:image" content="https://a.example/x.jpg">')
    resp = FakeResponse(page, headers={"Content-Type": "application/json"})
    assert fetch_og_image("https://example.com/a", get=Getter([resp]), resolver=resolver_for()) is None
    assert resp.closed is True
    missing = FakeResponse(page, headers={})
    assert (
        fetch_og_image("https://example.com/a", get=Getter([missing]), resolver=resolver_for())
        == "https://a.example/x.jpg"
    )
    xhtml = FakeResponse(page, headers={"Content-Type": "application/xhtml+xml"})
    assert (
        fetch_og_image("https://example.com/a", get=Getter([xhtml]), resolver=resolver_for())
        == "https://a.example/x.jpg"
    )


def test_error_status_returns_none() -> None:
    page = html_with('<meta property="og:image" content="https://a.example/x.jpg">')
    resp = FakeResponse(page, status_code=404)
    assert fetch_og_image("https://example.com/a", get=Getter([resp]), resolver=resolver_for()) is None


@pytest.mark.parametrize(
    "value",
    ["data:image/png;base64,AAAA", "javascript:alert(1)", "ftp://a.example/x.jpg", ""],
)
def test_non_http_image_url_returns_none(value: str) -> None:
    page = html_with(f'<meta property="og:image" content="{value}">')
    assert fetch_og_image("https://example.com/a", get=Getter([FakeResponse(page)]), resolver=resolver_for()) is None


def test_overlong_image_url_returns_none() -> None:
    page = html_with(f'<meta property="og:image" content="https://a.example/{"x" * 2100}">')
    assert fetch_og_image("https://example.com/a", get=Getter([FakeResponse(page)]), resolver=resolver_for()) is None
