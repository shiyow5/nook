from pathlib import Path

import pytest

import nook.services.tech_news.service as tech_news_service
from nook.services.storage import FilesystemStorageBackend

CHALLENGE_HTML = "<html><body><p>请稍候…</p></body></html>"
ARTICLE_HTML = (
    "<html><body><article><p>"
    + "本文がしっかりある記事です。" * 30
    + "</p></article></body></html>"
)


class _Response:
    def __init__(self, text: str) -> None:
        self.text = text
        self.url = "https://36kr.com/p/1"
        self.apparent_encoding = "utf-8"
        self.encoding = "utf-8"

    def raise_for_status(self) -> None:
        return None


@pytest.fixture
def collector(monkeypatch: pytest.MonkeyPatch, tmp_path: Path):
    monkeypatch.setattr(tech_news_service, "create_client", lambda **kwargs: object())
    monkeypatch.setattr(
        tech_news_service,
        "build_storage_backend",
        lambda env: FilesystemStorageBackend(data_dir=tmp_path),
    )
    return tech_news_service.TechNews()


def _entry(summary: str) -> dict:
    return {
        "link": "https://36kr.com/p/1?f=rss",
        "title": "AI の記事",
        "summary_detail": {"value": summary},
    }


def test_uses_the_rss_body_when_the_page_returns_a_bot_check(
    collector, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(
        tech_news_service.requests,
        "get",
        lambda url, **kwargs: _Response(CHALLENGE_HTML),
    )
    rss_body = "<p>" + "RSS に入っている本文。" * 40 + "</p><p>二段落目。</p>"

    article = collector._retrieve_article(_entry(rss_body), feed_name="36Kr")

    assert article is not None
    assert article.text.startswith("RSS に入っている本文。")
    assert article.text.endswith("二段落目。")


def test_keeps_the_page_text_when_it_is_longer_than_the_rss_teaser(
    collector, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(
        tech_news_service.requests, "get", lambda url, **kwargs: _Response(ARTICLE_HTML)
    )

    article = collector._retrieve_article(_entry("<p>短い紹介文</p>"), feed_name="Zenn")

    assert article is not None
    assert article.text.startswith("本文がしっかりある記事です。")


def test_36kr_uses_the_www_feed_with_chinese_keywords() -> None:
    feeds = {
        feed.name: feed for feed in tech_news_service.Config.load_feeds("tech_news")
    }

    assert feeds["36Kr"].url == "https://www.36kr.com/feed"
    assert "人工智能" in (feeds["36Kr"].keywords or [])
