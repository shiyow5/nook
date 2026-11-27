import json
from pathlib import Path

import pytest

import nook.services.tech_news.service as tech_news_service
from nook.services.collector_settings import (
    DEFAULTS_KEY,
    RSS_SERVICES,
    SETTINGS_KEY,
    SETTINGS_SERVICE,
    apply_collector_settings,
    build_defaults,
    load_settings,
)
from nook.services.storage import FilesystemStorageBackend

FEED = {
    "name": "zenn_rl",
    "feed_name_display": "Zenn 強化学習",
    "url": "https://zenn.dev/topics/reinforcementlearning/feed",
    "keywords": ["強化学習"],
}


def _write_settings(backend: FilesystemStorageBackend, payload: dict) -> None:
    backend.write_state(
        SETTINGS_SERVICE, SETTINGS_KEY, json.dumps(payload, ensure_ascii=False)
    )


@pytest.fixture
def backend(tmp_path: Path) -> FilesystemStorageBackend:
    return FilesystemStorageBackend(data_dir=tmp_path)


def test_load_settings_returns_none_without_saved_settings(backend) -> None:
    assert load_settings(backend) is None


def test_load_settings_ignores_broken_settings_instead_of_stopping_collection(
    backend,
) -> None:
    backend.write_state(SETTINGS_SERVICE, SETTINGS_KEY, "{not json")

    assert load_settings(backend) is None


def test_load_settings_rejects_feeds_without_http_url(backend) -> None:
    _write_settings(
        backend,
        {
            "version": 1,
            "rss": {
                "jp_tech_news": {
                    "max_entries_per_feed": 5,
                    "feeds": [{**FEED, "url": "file:///etc/passwd"}],
                }
            },
        },
    )

    assert load_settings(backend) is None


def test_build_defaults_lists_rss_feeds_from_toml() -> None:
    defaults = build_defaults(["hacker_news", "jp_tech_news"])

    assert defaults["collectors"] == ["hacker_news", "jp_tech_news"]
    assert set(defaults["rss"]) == set(RSS_SERVICES)
    jp = defaults["rss"]["jp_tech_news"]
    assert jp["max_entries_per_feed"] == tech_news_service.Config.max_entries_per_feed
    assert {"name", "feed_name_display", "url", "keywords"} <= set(jp["feeds"][0])


def test_apply_skips_disabled_collectors_and_publishes_defaults(backend) -> None:
    _write_settings(
        backend, {"version": 1, "collectors": {"reddit_explorer": {"enabled": False}}}
    )

    names = apply_collector_settings(
        ["hacker_news", "reddit_explorer"],
        backend,
        mode="apply",
        scheduled=["hacker_news", "reddit_explorer"],
    )

    assert names == ["hacker_news"]
    defaults = json.loads(backend.read_state(SETTINGS_SERVICE, DEFAULTS_KEY))
    assert defaults["collectors"] == ["hacker_news", "reddit_explorer"]


def test_publish_mode_keeps_explicitly_requested_collectors(backend) -> None:
    _write_settings(
        backend, {"version": 1, "collectors": {"reddit_explorer": {"enabled": False}}}
    )

    names = apply_collector_settings(
        ["reddit_explorer"], backend, mode="publish", scheduled=["reddit_explorer"]
    )

    assert names == ["reddit_explorer"]


def test_apply_rewrites_settings_so_the_90_day_expiry_does_not_delete_them(
    backend, tmp_path: Path
) -> None:
    _write_settings(backend, {"version": 1, "collectors": {}})
    path = tmp_path / "_state" / SETTINGS_SERVICE / SETTINGS_KEY
    before = path.stat().st_mtime_ns

    import os

    os.utime(path, ns=(before - 10**12, before - 10**12))
    apply_collector_settings(
        ["hacker_news"], backend, mode="apply", scheduled=["hacker_news"]
    )

    assert path.stat().st_mtime_ns > before - 10**12


def test_tech_news_uses_saved_feeds_and_limit(
    monkeypatch: pytest.MonkeyPatch, backend
) -> None:
    from nook.services.jp_tech_news.service import JpTechNews

    _write_settings(
        backend,
        {
            "version": 1,
            "rss": {"jp_tech_news": {"max_entries_per_feed": 3, "feeds": [FEED]}},
        },
    )
    monkeypatch.setattr(tech_news_service, "create_client", lambda **kwargs: object())
    monkeypatch.setattr(tech_news_service, "build_storage_backend", lambda env: backend)

    collector = JpTechNews()

    assert [feed.url for feed in collector._feeds] == [FEED["url"]]
    assert collector._feeds[0].keywords == ["強化学習"]
    assert collector._max_entries_per_feed == 3


def test_tech_news_falls_back_to_toml_for_services_without_settings(
    monkeypatch: pytest.MonkeyPatch, backend
) -> None:
    _write_settings(
        backend,
        {
            "version": 1,
            "rss": {"jp_tech_news": {"max_entries_per_feed": 3, "feeds": [FEED]}},
        },
    )
    monkeypatch.setattr(tech_news_service, "create_client", lambda **kwargs: object())
    monkeypatch.setattr(tech_news_service, "build_storage_backend", lambda env: backend)

    collector = tech_news_service.TechNews()

    assert collector._feeds == tech_news_service.Config.load_feeds("tech_news")
    assert (
        collector._max_entries_per_feed == tech_news_service.Config.max_entries_per_feed
    )


def test_resolve_collector_names_applies_settings_only_when_asked(backend) -> None:
    from nook.deploy.github.run_collectors import resolve_collector_names

    _write_settings(
        backend, {"version": 1, "collectors": {"reddit_explorer": {"enabled": False}}}
    )
    names = ["hacker_news", "reddit_explorer"]

    assert resolve_collector_names(names, {}, lambda env: backend) == names
    assert resolve_collector_names(
        names,
        {
            "NOOK_COLLECTOR_SETTINGS": "apply",
            "NOOK_SCHEDULED_COLLECTORS": "hacker_news,reddit_explorer",
        },
        lambda env: backend,
    ) == ["hacker_news"]
    assert (
        resolve_collector_names(
            names, {"NOOK_COLLECTOR_SETTINGS": "publish"}, lambda env: backend
        )
        == names
    )
    with pytest.raises(ValueError):
        resolve_collector_names(
            names, {"NOOK_COLLECTOR_SETTINGS": "yes"}, lambda env: backend
        )
