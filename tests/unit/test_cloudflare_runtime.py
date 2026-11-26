import tomllib
from pathlib import Path

import pytest

from nook.services.catalog import get_service_definition
from nook.services.paper_summarizer.summary_schema import (
    PaperSummarySections,
    render_paper_summary_markdown,
)
from nook.services.registry import resolve_collector_runner
from nook.services.storage import S3StorageBackend, build_storage_backend
from nook.services.viewer.content import display_label, viewer_service_names


def test_s3_storage_backend_uses_custom_endpoint_for_r2(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import nook.services.storage as storage

    captured: dict[str, object] = {}

    def fake_client(service_name: str, **kwargs: object) -> object:
        captured["service_name"] = service_name
        captured.update(kwargs)
        return object()

    monkeypatch.setattr(storage.boto3, "client", fake_client)

    backend = build_storage_backend(
        {
            "NOOK_STORAGE_BACKEND": "s3",
            "BUCKET_NAME": "nook-data",
            "NOOK_S3_ENDPOINT_URL": "https://example.r2.cloudflarestorage.com",
            "NOOK_S3_REGION": "auto",
        }
    )

    assert isinstance(backend, S3StorageBackend)
    assert captured == {
        "service_name": "s3",
        "endpoint_url": "https://example.r2.cloudflarestorage.com",
        "region_name": "auto",
    }


def test_s3_storage_backend_omits_endpoint_when_not_configured(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import nook.services.storage as storage

    captured: dict[str, object] = {}

    def fake_client(service_name: str, **kwargs: object) -> object:
        captured.update(kwargs)
        return object()

    monkeypatch.setattr(storage.boto3, "client", fake_client)

    build_storage_backend({"NOOK_STORAGE_BACKEND": "s3", "BUCKET_NAME": "nook-data"})

    assert captured == {}


def test_s3_storage_backend_rejects_empty_endpoint_instead_of_falling_back_to_aws() -> (
    None
):
    with pytest.raises(ValueError, match="NOOK_S3_ENDPOINT_URL"):
        build_storage_backend(
            {
                "NOOK_STORAGE_BACKEND": "s3",
                "BUCKET_NAME": "nook-data",
                "NOOK_S3_ENDPOINT_URL": "",
            }
        )


def test_jp_tech_news_is_registered_as_collector() -> None:
    definition = get_service_definition("jp_tech_news")

    assert definition.kind == "collector"
    assert definition.schedule == (0, 54)
    runner = resolve_collector_runner("jp_tech_news")
    assert runner.module_path == "nook.services.jp_tech_news.service"
    assert runner.class_name == "JpTechNews"


def test_jp_tech_news_has_domestic_tab_next_to_news() -> None:
    names = viewer_service_names()

    assert display_label("jp_tech_news") == "国内"
    assert names.index("jp_tech_news") == names.index("tech_news") + 1


def test_jp_tech_news_reads_own_config_and_writes_own_service(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import nook.services.tech_news.service as tech_news_service
    from nook.services.jp_tech_news.service import JpTechNews

    captured: dict[str, object] = {}

    class DummyCollectorStorage:
        def __init__(self, *, service_name: str, backend: object) -> None:
            captured["service_name"] = service_name

    monkeypatch.setattr(tech_news_service, "create_client", lambda **kwargs: object())
    monkeypatch.setattr(tech_news_service, "CollectorStorage", DummyCollectorStorage)
    monkeypatch.setattr(
        tech_news_service, "build_storage_backend", lambda env: object()
    )

    collector = JpTechNews()

    with Path("configs/jp_tech_news/feed.toml").open("rb") as file:
        expected_urls = [feed["url"] for feed in tomllib.load(file)["feeds"]]
    assert captured["service_name"] == "jp_tech_news"
    assert [feed.url for feed in collector._feeds] == expected_urls


def test_jp_tech_news_feed_urls_are_ascii() -> None:
    with Path("configs/jp_tech_news/feed.toml").open("rb") as file:
        feeds = tomllib.load(file)["feeds"]

    assert feeds
    for feed in feeds:
        assert feed["url"].isascii(), feed["url"]


def test_paper_summary_renders_japanese_title_under_heading() -> None:
    markdown = render_paper_summary_markdown(
        title="Attention Is All You Need",
        url="https://arxiv.org/abs/1706.03762",
        summary=PaperSummarySections(title_ja="必要なのはアテンションだけ"),
    )

    lines = markdown.split("\n\n")
    assert lines[0] == "# Attention Is All You Need"
    assert lines[1] == "（必要なのはアテンションだけ）"
    assert lines[2] == "[View Paper](https://arxiv.org/abs/1706.03762)"


@pytest.mark.parametrize("title_ja", ["", "  ", "Attention Is All You Need"])
def test_paper_summary_skips_empty_or_identical_japanese_title(title_ja: str) -> None:
    markdown = render_paper_summary_markdown(
        title="Attention Is All You Need",
        url="https://arxiv.org/abs/1706.03762",
        summary=PaperSummarySections(title_ja=title_ja),
    )

    assert markdown.split("\n\n")[1] == "[View Paper](https://arxiv.org/abs/1706.03762)"


def test_run_collectors_continues_after_failure_and_reports_failed_names() -> None:
    from nook.deploy.github.run_collectors import run_collectors

    calls: list[str] = []

    def fake_runner(service_name: str) -> None:
        calls.append(service_name)
        if service_name == "tech_feed":
            raise RuntimeError("feed down")

    failed = run_collectors(["tech_feed", "tech_news"], runner=fake_runner)

    assert calls == ["tech_feed", "tech_news"]
    assert failed == ["tech_feed"]


def test_parse_collector_names_rejects_unknown_and_non_collector_names() -> None:
    from nook.deploy.github.run_collectors import parse_collector_names

    assert parse_collector_names("tech_news, jp_tech_news ,") == [
        "tech_news",
        "jp_tech_news",
    ]
    with pytest.raises(ValueError, match="viewer"):
        parse_collector_names("viewer")
    with pytest.raises(ValueError, match="unknown"):
        parse_collector_names("unknown")
    with pytest.raises(ValueError, match="at least one"):
        parse_collector_names(" , ")


def test_run_collectors_main_returns_non_zero_when_any_collector_fails(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import nook.deploy.github.run_collectors as module

    monkeypatch.setattr(
        module, "run_collectors", lambda names, runner=None: ["tech_feed"]
    )

    assert module.main(["tech_feed,tech_news"]) == 1
