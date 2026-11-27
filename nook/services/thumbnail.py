"""記事のサムネイル画像を選ぶ(#42)。

collector は記事ごとに画像 URL を 1 つ選び、Markdown の「View」リンクの次の行に
``![thumbnail](URL)`` として書く。画面(Cloudflare の viewer)はこの行を取り出し、
記事一覧と本文の上に出す。画像は元のサイトから直接読み込み、R2 には保存しない。
"""

from typing import Any
from urllib.parse import quote, urljoin, urlsplit

from bs4 import BeautifulSoup

_MAX_URL_LENGTH = 2000
_PAGE_IMAGE_META = (
    ("property", "og:image:secure_url"),
    ("property", "og:image"),
    ("name", "og:image"),
    ("name", "twitter:image"),
    ("property", "twitter:image"),
    ("name", "twitter:image:src"),
)


def safe_image_url(url: str | None, base_url: str | None = None) -> str | None:
    """http / https の絶対 URL にして返す。使えない値なら None。"""
    if not isinstance(url, str) or not url.strip():
        return None
    absolute = urljoin(base_url, url.strip()) if base_url else url.strip()
    parts = urlsplit(absolute)
    if parts.scheme not in ("http", "https") or not parts.netloc:
        return None
    if len(absolute) > _MAX_URL_LENGTH:
        return None
    return absolute


def image_from_soup(soup: BeautifulSoup | None, base_url: str | None) -> str | None:
    """記事ページの og:image / twitter:image を返す。"""
    if soup is None:
        return None
    for attribute, value in _PAGE_IMAGE_META:
        meta = soup.find("meta", attrs={attribute: value})
        url = safe_image_url(meta.get("content") if meta else None, base_url)
        if url:
            return url
    return None


def image_from_entry(entry: dict[str, Any]) -> str | None:
    """RSS の media:thumbnail / media:content / enclosure、なければ説明文の最初の画像を返す。"""
    base = entry.get("link")
    for thumbnail in entry.get("media_thumbnail") or []:
        url = safe_image_url(thumbnail.get("url"), base)
        if url:
            return url
    for content in entry.get("media_content") or []:
        kind = (content.get("type") or content.get("medium") or "image").lower()
        url = safe_image_url(content.get("url"), base)
        if url and kind.startswith("image"):
            return url
    for link in entry.get("links") or []:
        if link.get("rel") == "enclosure" and (link.get("type") or "").startswith(
            "image"
        ):
            url = safe_image_url(link.get("href"), base)
            if url:
                return url
    html = entry.get("summary_detail", {}).get("value") or entry.get("summary") or ""
    for content in entry.get("content") or []:
        html += content.get("value") or ""
    if "<img" in html:
        image = BeautifulSoup(html, "html.parser").find("img")
        return safe_image_url(image.get("src") if image else None, base)
    return None


def first_figure_image(html: str, base_url: str) -> str | None:
    """arXiv の HTML 版などで、最初の図の画像を返す。"""
    soup = BeautifulSoup(html, "html.parser")
    for image in soup.select("figure img"):
        url = safe_image_url(image.get("src"), base_url)
        if url:
            return url
    return None


def github_social_image(repository_url: str) -> str | None:
    """GitHub のリポジトリの OGP 画像。パスの最初の数字はキャッシュ用の任意の値。"""
    parts = urlsplit(repository_url)
    segments = [segment for segment in parts.path.split("/") if segment]
    if parts.netloc != "github.com" or len(segments) < 2:
        return None
    return f"https://opengraph.githubassets.com/1/{segments[0]}/{segments[1]}"


def thumbnail_markdown(url: str | None) -> str:
    """Markdown の画像の行。URL の空白や括弧は Markdown が崩れないようエンコードする。"""
    if not url:
        return ""
    return f"![thumbnail]({quote(url, safe=':/?#[]@!$&*+,;=%~-._')})"
