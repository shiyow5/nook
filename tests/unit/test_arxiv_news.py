import time
import tomllib
from datetime import date, datetime, timedelta
from pathlib import Path

import feedparser
import pytest

import nook.services.tech_news.service as tech_news_service
from nook.services.catalog import get_service_definition
from nook.services.registry import resolve_collector_runner
from nook.services.storage import FilesystemStorageBackend
from nook.services.viewer.content import display_label, viewer_service_names

CONFIG_PATH = Path("configs/arxiv_news/feed.toml")


@pytest.fixture
def collector(monkeypatch: pytest.MonkeyPatch, tmp_path: Path):
    from nook.services.arxiv_news.service import ArxivNews

    monkeypatch.setattr(tech_news_service, "create_client", lambda **kwargs: object())
    monkeypatch.setattr(
        tech_news_service,
        "build_storage_backend",
        lambda env: FilesystemStorageBackend(data_dir=tmp_path),
    )
    return ArxivNews()


def _entry(link: str, announce_type: str, title: str = "KV cache compression") -> dict:
    return {
        "link": link,
        "title": title,
        "summary": "We study long-context inference.",
        "arxiv_announce_type": announce_type,
        "published_parsed": time.localtime(),
    }


def test_arxiv_news_is_registered_with_its_own_tab() -> None:
    assert get_service_definition("arxiv_news").kind == "collector"
    assert resolve_collector_runner("arxiv_news").class_name == "ArxivNews"
    assert display_label("arxiv_news") == "arXiv"
    names = viewer_service_names()
    assert names.index("arxiv_news") == names.index("paper_summarizer") + 1


def test_arxiv_news_config_covers_three_categories_with_keywords() -> None:
    with CONFIG_PATH.open("rb") as file:
        feeds = tomllib.load(file)["feeds"]

    assert [feed["url"] for feed in feeds] == [
        "https://rss.arxiv.org/rss/cs.CL",
        "https://rss.arxiv.org/rss/cs.LG",
        "https://rss.arxiv.org/rss/cs.AI",
    ]
    for feed in feeds:
        assert feed["keywords"]
        assert all(isinstance(keyword, str) and keyword for keyword in feed["keywords"])


def test_arxiv_news_skips_replacements_and_keeps_new_and_cross_lists(
    collector,
) -> None:
    parsed = feedparser.FeedParserDict(
        entries=[
            _entry("https://arxiv.org/abs/2611.00001", "new"),
            _entry("https://arxiv.org/abs/2611.00002", "cross"),
            _entry("https://arxiv.org/abs/2601.00003", "replace"),
            _entry("https://arxiv.org/abs/2601.00004", "replace-cross"),
        ]
    )

    kept = collector._filter_entries(parsed, ["KV cache"])

    assert [entry["link"] for entry in kept] == [
        "https://arxiv.org/abs/2611.00001",
        "https://arxiv.org/abs/2611.00002",
    ]


def test_arxiv_news_treats_recent_hugging_face_papers_as_processed(
    collector, tmp_path: Path
) -> None:
    backend = FilesystemStorageBackend(data_dir=tmp_path)
    yesterday = date.today() - timedelta(days=1)
    old = date.today() - timedelta(days=10)
    backend.write_state(
        "paper_summarizer", f"arxiv_ids-{yesterday.isoformat()}.txt", "2611.00001\n"
    )
    backend.write_state(
        "paper_summarizer", f"arxiv_ids-{old.isoformat()}.txt", "2601.99999\n"
    )

    processed = collector._initially_processed_urls()

    assert processed == {"https://arxiv.org/abs/2611.00001"}


def test_tech_news_starts_without_processed_urls(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.setattr(tech_news_service, "create_client", lambda **kwargs: object())
    monkeypatch.setattr(
        tech_news_service,
        "build_storage_backend",
        lambda env: FilesystemStorageBackend(data_dir=tmp_path),
    )

    assert tech_news_service.TechNews()._initially_processed_urls() == set()


def test_old_entries_are_still_dropped_by_threshold(collector) -> None:
    stale = _entry("https://arxiv.org/abs/2611.00005", "new")
    stale["published_parsed"] = (datetime.now() - timedelta(days=3)).timetuple()

    kept = collector._filter_entries(
        feedparser.FeedParserDict(entries=[stale]), ["KV cache"]
    )

    assert kept == []
