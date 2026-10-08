"""SSRF-safe fetch of the ``og:image`` meta tag of a source article page.

The pipeline does not extract images from article bodies; this module only
reads the page's ``og:image`` declaration. The URL originates from scraped
data and is therefore untrusted:

* only http/https URLs without embedded credentials are fetched;
* the hostname is resolved and every resulting address must be globally
  routable (no loopback, private, link-local, multicast, reserved,
  unspecified, or IPv4-mapped IPv6 forms of those);
* redirects are followed manually (at most 3) and every hop, including the
  first request, is re-validated;
* the body is streamed and capped at 512 KB, with a 5 second timeout.

Known limitation: DNS rebinding (a hostname that resolves to a public IP at
check time and to a private IP at connect time) is not fully closed, because
``requests`` resolves the name again when it connects. This is mitigated by
validating each hop and by running the pipeline on a host without privileged
internal network access. IP pinning is deliberately not implemented.
"""

from __future__ import annotations

import ipaddress
import socket
from collections.abc import Callable
from html.parser import HTMLParser
from typing import Any
from urllib.parse import urljoin, urlsplit

import requests

USER_AGENT = "GenZNewsFrameworkStage/0.1"
TIMEOUT_SECONDS = 5
MAX_BYTES = 524288
MAX_REDIRECTS = 3
MAX_IMAGE_URL_LENGTH = 2048
_CHUNK_SIZE = 8192
_REDIRECT_STATUSES = frozenset({301, 302, 303, 307, 308})
_HTML_TYPES = ("text/html", "application/xhtml+xml")
_BLOCKED_SUFFIXES = (".local", ".internal", ".localhost")

_IMG_SESSION: requests.Session | None = None


def _get_img_session() -> requests.Session:
    global _IMG_SESSION
    if _IMG_SESSION is None:
        _IMG_SESSION = requests.Session()
    return _IMG_SESSION


def _address_is_public(raw: str) -> bool:
    try:
        ip = ipaddress.ip_address(raw.split("%", 1)[0])
    except ValueError:
        return False
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped is not None:
        ip = ip.ipv4_mapped
    if (
        ip.is_loopback
        or ip.is_private
        or ip.is_link_local
        or ip.is_multicast
        or ip.is_reserved
        or ip.is_unspecified
    ):
        return False
    return ip.is_global


def is_public_http_url(url: str, resolver: Callable[..., Any] = socket.getaddrinfo) -> bool:
    """True only for http(s) URLs whose host resolves exclusively to public IPs."""
    try:
        parts = urlsplit(url.strip())
        host = parts.hostname
        _ = parts.port  # raises ValueError on a malformed port
    except ValueError:
        return False
    if parts.scheme not in ("http", "https") or not host:
        return False
    if parts.username is not None or parts.password is not None or "@" in parts.netloc:
        return False
    host = host.rstrip(".").lower()
    if not host or host == "localhost" or host.endswith(_BLOCKED_SUFFIXES):
        return False

    try:
        ipaddress.ip_address(host.split("%", 1)[0])
    except ValueError:
        pass
    else:
        return _address_is_public(host)

    try:
        infos = resolver(host, None)
    except (OSError, UnicodeError):
        return False
    addresses = [str(info[4][0]) for info in infos]
    if not addresses:
        return False
    return all(_address_is_public(address) for address in addresses)


class _OgImageParser(HTMLParser):
    """Collects og:image candidates by priority (lower index wins)."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.main: str | None = None
        self.by_name: str | None = None
        self.secure: str | None = None

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag != "meta":
            return
        values = {key: (value or "") for key, value in attrs}
        content = values.get("content", "").strip()
        if not content:
            return
        prop = values.get("property", "").strip().lower()
        name = values.get("name", "").strip().lower()
        if prop == "og:image" and self.main is None:
            self.main = content
        elif name == "og:image" and self.by_name is None:
            self.by_name = content
        elif prop == "og:image:secure_url" and self.secure is None:
            self.secure = content

    @property
    def best(self) -> str | None:
        return self.main or self.by_name or self.secure


def _is_html(headers: Any) -> bool:
    content_type = str(headers.get("Content-Type", "")).split(";", 1)[0].strip().lower()
    return not content_type or content_type in _HTML_TYPES


def _read_capped(response: Any) -> bytes:
    chunks: list[bytes] = []
    total = 0
    for chunk in response.iter_content(chunk_size=_CHUNK_SIZE):
        if not chunk:
            continue
        remaining = MAX_BYTES - total
        chunks.append(chunk[:remaining])
        total += len(chunks[-1])
        if total >= MAX_BYTES:
            break
    return b"".join(chunks)


def _validated_image_url(candidate: str | None, page_url: str) -> str | None:
    if not candidate:
        return None
    try:
        absolute = urljoin(page_url, candidate.strip()).strip()
        scheme = urlsplit(absolute).scheme
    except ValueError:
        return None
    if scheme not in ("http", "https") or len(absolute) > MAX_IMAGE_URL_LENGTH:
        return None
    return absolute


def fetch_og_image(
    url: str,
    *,
    get: Callable[..., Any] | None = None,
    resolver: Callable[..., Any] = socket.getaddrinfo,
) -> str | None:
    """Return the page's og:image URL, or None. Never raises for network/parse errors."""
    if get is None:
        get = _get_img_session().get
    current = url
    try:
        for _ in range(MAX_REDIRECTS + 1):
            if not is_public_http_url(current, resolver=resolver):
                return None
            response = get(
                current,
                headers={"User-Agent": USER_AGENT},
                timeout=TIMEOUT_SECONDS,
                stream=True,
                allow_redirects=False,
            )
            try:
                if response.status_code in _REDIRECT_STATUSES:
                    location = str(response.headers.get("Location", "")).strip()
                    if not location:
                        return None
                    current = urljoin(current, location)
                    continue
                if response.status_code >= 400 or not _is_html(response.headers):
                    return None
                body = _read_capped(response)
            finally:
                response.close()
            parser = _OgImageParser()
            parser.feed(body.decode("utf-8", errors="replace"))
            parser.close()
            return _validated_image_url(parser.best, current)
    except (requests.RequestException, ValueError):
        return None
    return None
